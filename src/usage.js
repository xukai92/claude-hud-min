// Plan usage (5h / 7d quota) from the Anthropic OAuth usage API.
//
// The statusline runs as a fresh process every ~300ms, so results are cached on
// disk. Before fetching, a process stamps the cache as `pending` — that claim is
// what keeps concurrent sessions from all hitting the API at once.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * @typedef {object} UsageData
 * @property {string | null} planName
 * @property {number | null} fiveHour 0-100, null when unavailable
 * @property {number | null} sevenDay 0-100, null when unavailable
 * @property {Date | null} fiveHourResetAt
 * @property {Date | null} sevenDayResetAt
 * @property {boolean} [stale] Served from cache after a failed refresh
 * @property {boolean} [unavailable] No usable numbers at all
 */

/** @typedef {'ok' | 'pending' | 'fail' | 'rate-limited'} CacheState */

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TIMEOUT_MS = 3000;
const API_TIMEOUT_MS = 15_000;
const USER_AGENT = 'claude-code/2.1';

/** How long a cache entry stays fresh, by the state of the write that made it. */
const TTL_MS = {
  ok: 60_000,
  pending: 20_000, // a fetch is in flight elsewhere; longer than the API timeout would stall recovery
  fail: 15_000,
  'rate-limited': 120_000,
};

const debugEnabled = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';
/** @param {...unknown} args */
const debug = (...args) => {
  if (debugEnabled) console.error('[claude-hud-min:usage]', ...args);
};

/** @param {string} homeDir */
export function getConfigDir(homeDir) {
  const envDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!envDir) return path.join(homeDir, '.claude');
  const expanded = envDir === '~' || envDir.startsWith('~/') ? path.join(homeDir, envDir.slice(1)) : envDir;
  return path.resolve(expanded);
}

/** @param {string} homeDir */
const getCachePath = (homeDir) =>
  path.join(getConfigDir(homeDir), 'plugins', 'claude-hud-min', '.usage-cache.json');

/**
 * A non-Anthropic ANTHROPIC_BASE_URL means the OAuth quota does not apply.
 * @param {NodeJS.ProcessEnv} env
 */
export function isCustomEndpoint(env = process.env) {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim() || env.ANTHROPIC_API_BASE_URL?.trim();
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).origin !== 'https://api.anthropic.com';
  } catch {
    return true;
  }
}

/**
 * @param {string} homeDir
 * @returns {{ data: UsageData | null, ts: number, state: CacheState } | null}
 */
function readCache(homeDir) {
  try {
    const raw = fs.readFileSync(getCachePath(homeDir), 'utf8');
    const cache = JSON.parse(raw);
    if (typeof cache?.ts !== 'number') return null;
    if (cache.data) {
      // JSON round-trips Dates into strings.
      cache.data.fiveHourResetAt = cache.data.fiveHourResetAt ? new Date(cache.data.fiveHourResetAt) : null;
      cache.data.sevenDayResetAt = cache.data.sevenDayResetAt ? new Date(cache.data.sevenDayResetAt) : null;
    }
    return cache;
  } catch {
    return null;
  }
}

/**
 * @param {string} homeDir
 * @param {UsageData | null} data
 * @param {number} ts
 * @param {CacheState} state
 */
function writeCache(homeDir, data, ts, state) {
  try {
    const cachePath = getCachePath(homeDir);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ data, ts, state }), 'utf8');
  } catch (error) {
    debug('cache write failed:', error);
  }
}

/**
 * @param {unknown} raw
 * @param {number} now
 * @returns {{ accessToken: string, subscriptionType: string } | null}
 */
export function parseCredentials(raw, now) {
  const oauth = /** @type {any} */ (raw)?.claudeAiOauth;
  const accessToken = oauth?.accessToken;
  if (!accessToken) return null;

  // expiresAt is a Unix ms timestamp; != null so that 0 counts as expired.
  if (oauth.expiresAt != null && oauth.expiresAt <= now) {
    debug('OAuth token expired');
    return null;
  }

  return { accessToken, subscriptionType: oauth.subscriptionType ?? '' };
}

/**
 * Pre-2.x Claude Code — and every non-macOS install — keeps credentials on disk.
 * @param {string} homeDir
 */
function readCredentialsFile(homeDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(getConfigDir(homeDir), '.credentials.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Claude Code hashes the config dir into the service name for non-default profiles.
 * @param {string} homeDir
 */
export function keychainServiceNames(homeDir) {
  const configDir = getConfigDir(homeDir);
  const names = [KEYCHAIN_SERVICE];
  if (path.resolve(configDir) !== path.resolve(homeDir, '.claude')) {
    const hash = createHash('sha256').update(path.normalize(path.resolve(configDir))).digest('hex').slice(0, 8);
    names.unshift(`${KEYCHAIN_SERVICE}-${hash}`);
  }
  return names;
}

/**
 * macOS stores the credentials in the Keychain rather than on disk.
 * @param {string} homeDir
 * @param {number} now
 */
function readKeychainCredentials(homeDir, now) {
  if (process.platform !== 'darwin') return null;

  const account = (() => {
    try {
      return os.userInfo().username.trim() || null;
    } catch {
      return null;
    }
  })();

  for (const service of keychainServiceNames(homeDir)) {
    for (const args of account
      ? [['-s', service, '-a', account, '-w'], ['-s', service, '-w']]
      : [['-s', service, '-w']]) {
      /** @type {string} */
      let payload;
      try {
        payload = execFileSync('/usr/bin/security', ['find-generic-password', ...args], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: KEYCHAIN_TIMEOUT_MS,
        }).trim();
      } catch (error) {
        // Only the message: the error object carries stdout, i.e. the token.
        debug('keychain lookup failed:', error instanceof Error ? error.message : 'unknown');
        continue;
      }

      if (!payload) continue;

      try {
        const credentials = parseCredentials(JSON.parse(payload), now);
        if (credentials) return credentials;
      } catch {
        // Never log the parse error — it quotes the payload back at you.
        debug('keychain payload was not valid JSON');
      }
    }
  }
  return null;
}

/**
 * The Keychain token wins on macOS: Claude Code 2.x refreshes it there and can
 * leave a stale copy on disk. subscriptionType is display-only, so it may come
 * from whichever source has it.
 * @param {string} homeDir
 * @param {number} now
 * @param {(homeDir: string, now: number) => { accessToken: string, subscriptionType: string } | null} [readKeychain]
 */
function readCredentials(homeDir, now, readKeychain = readKeychainCredentials) {
  const file = readCredentialsFile(homeDir);
  const keychain = readKeychain(homeDir, now);

  if (keychain) {
    if (keychain.subscriptionType) return keychain;
    const fileType = file?.claudeAiOauth?.subscriptionType;
    return { ...keychain, subscriptionType: typeof fileType === 'string' ? fileType.trim() : '' };
  }

  return file ? parseCredentials(file, now) : null;
}

/** @param {string} subscriptionType */
export function getPlanName(subscriptionType) {
  const lower = subscriptionType.toLowerCase();
  if (lower.includes('max')) return 'Max';
  if (lower.includes('pro')) return 'Pro';
  if (lower.includes('team')) return 'Team';
  // API users have no subscription, so no quota to show.
  if (!subscriptionType || lower.includes('api')) return null;
  return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}

/** @param {unknown} value */
function parseUtilization(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value)));
}

/** @param {unknown} value */
function parseDate(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {string} accessToken
 * @returns {Promise<{ data: any, error?: undefined } | { data: null, error: string }>}
 */
function fetchUsageApi(accessToken) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/api/oauth/usage',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': USER_AGENT,
        },
        timeout: API_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            debug('api status', res.statusCode);
            resolve({ data: null, error: res.statusCode === 429 ? 'rate-limited' : `http-${res.statusCode}` });
            return;
          }
          try {
            resolve({ data: JSON.parse(body) });
          } catch {
            resolve({ data: null, error: 'parse' });
          }
        });
      },
    );

    req.on('error', (error) => {
      debug('api error:', error.message);
      resolve({ data: null, error: 'network' });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ data: null, error: 'timeout' });
    });
    req.end();
  });
}

/**
 * @param {object} [deps]
 * @param {() => string} [deps.homeDir]
 * @param {() => number} [deps.now]
 * @param {(accessToken: string) => Promise<{ data: any, error?: string }>} [deps.fetchApi]
 * @param {(homeDir: string, now: number) => { accessToken: string, subscriptionType: string } | null} [deps.readKeychain]
 * @returns {Promise<UsageData | null>}
 */
export async function getUsage(deps = {}) {
  const homeDir = (deps.homeDir ?? os.homedir)();
  const now = (deps.now ?? Date.now)();
  const fetchApi = deps.fetchApi ?? fetchUsageApi;

  if (isCustomEndpoint()) {
    debug('custom API endpoint configured, skipping');
    return null;
  }

  const cache = readCache(homeDir);
  if (cache && now - cache.ts < TTL_MS[cache.state]) {
    return cache.data;
  }

  // Claim the refresh so other statusline processes keep serving the cache.
  writeCache(homeDir, cache?.data ?? null, now, 'pending');

  try {
    const credentials = readCredentials(homeDir, now, deps.readKeychain);
    const planName = credentials ? getPlanName(credentials.subscriptionType) : null;
    if (!credentials || !planName) {
      // API-key or logged-out user: nothing to show, and nothing to retry soon.
      writeCache(homeDir, null, now, 'ok');
      return null;
    }

    const result = await fetchApi(credentials.accessToken);
    if (!result.data) {
      const state = result.error === 'rate-limited' ? 'rate-limited' : 'fail';
      /** @type {UsageData} */
      const data = cache?.data
        ? { ...cache.data, stale: true }
        : {
            planName,
            fiveHour: null,
            sevenDay: null,
            fiveHourResetAt: null,
            sevenDayResetAt: null,
            unavailable: true,
          };
      writeCache(homeDir, data, now, state);
      return data;
    }

    /** @type {UsageData} */
    const data = {
      planName,
      fiveHour: parseUtilization(result.data.five_hour?.utilization),
      sevenDay: parseUtilization(result.data.seven_day?.utilization),
      fiveHourResetAt: parseDate(result.data.five_hour?.resets_at),
      sevenDayResetAt: parseDate(result.data.seven_day?.resets_at),
    };
    writeCache(homeDir, data, now, 'ok');
    return data;
  } catch (error) {
    debug('getUsage failed:', error);
    return cache?.data ?? null;
  }
}
