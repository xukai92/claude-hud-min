import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { getPlanName, getUsage, isCustomEndpoint, keychainServiceNames, parseCredentials } from '../src/usage.js';

delete process.env.CLAUDE_CONFIG_DIR;

/** @param {{ subscriptionType?: string, expiresAt?: number }} [oauth] */
function makeHome(oauth = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-min-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.claude', '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken: 'token-123', subscriptionType: 'max', ...oauth },
    }),
  );
  return home;
}

const API_RESPONSE = {
  five_hour: { utilization: 25.4, resets_at: '2026-01-01T17:00:00Z' },
  seven_day: { utilization: 60, resets_at: '2026-01-05T00:00:00Z' },
};

const cachePath = (home) => path.join(home, '.claude', 'plugins', 'claude-hud-min', '.usage-cache.json');

test('fetches and caches usage', async () => {
  const home = makeHome();
  let calls = 0;
  const deps = {
    homeDir: () => home,
    readKeychain: () => null,
    now: () => 1000,
    fetchApi: async (token) => {
      calls += 1;
      assert.equal(token, 'token-123');
      return { data: API_RESPONSE };
    },
  };

  const first = await getUsage(deps);
  assert.equal(first?.planName, 'Max');
  assert.equal(first?.fiveHour, 25);
  assert.equal(first?.sevenDay, 60);
  assert.equal(first?.fiveHourResetAt?.toISOString(), '2026-01-01T17:00:00.000Z');

  // Within the TTL the API is not touched again, and Dates survive the cache.
  const second = await getUsage({ ...deps, now: () => 30_000 });
  assert.equal(calls, 1);
  assert.equal(second?.fiveHour, 25);
  assert.ok(second?.fiveHourResetAt instanceof Date);

  // Past the TTL it refreshes.
  await getUsage({ ...deps, now: () => 120_000 });
  assert.equal(calls, 2);
});

test('a claimed refresh keeps other processes off the API', async () => {
  const home = makeHome();
  let resolveFetch;
  const pending = new Promise((resolve) => {
    resolveFetch = resolve;
  });

  let calls = 0;
  const deps = {
    homeDir: () => home,
    readKeychain: () => null,
    now: () => 1000,
    fetchApi: async () => {
      calls += 1;
      await pending;
      return { data: API_RESPONSE };
    },
  };

  const inFlight = getUsage(deps);
  await new Promise((resolve) => setImmediate(resolve));

  const concurrent = await getUsage({ ...deps, now: () => 1500 });
  assert.equal(concurrent, null); // nothing cached yet, but no second request
  assert.equal(calls, 1);

  resolveFetch({ data: API_RESPONSE });
  assert.equal((await inFlight)?.fiveHour, 25);
});

test('keeps the last good numbers when a refresh fails', async () => {
  const home = makeHome();
  const deps = {
    homeDir: () => home,
    readKeychain: () => null,
    now: () => 1000,
    fetchApi: async () => ({ data: API_RESPONSE }),
  };
  await getUsage(deps);

  const failed = await getUsage({
    ...deps,
    now: () => 120_000,
    fetchApi: async () => ({ data: null, error: 'network' }),
  });
  assert.equal(failed?.fiveHour, 25);
  assert.equal(failed?.stale, true);
});

test('reports unavailable when a refresh fails with nothing cached', async () => {
  const home = makeHome();
  const result = await getUsage({
    homeDir: () => home,
    readKeychain: () => null,
    now: () => 1000,
    fetchApi: async () => ({ data: null, error: 'timeout' }),
  });
  assert.equal(result?.unavailable, true);
  assert.equal(result?.planName, 'Max');
});

test('backs off longer after a rate limit', async () => {
  const home = makeHome();
  let calls = 0;
  const deps = {
    homeDir: () => home,
    readKeychain: () => null,
    now: () => 1000,
    fetchApi: async () => {
      calls += 1;
      return { data: null, error: 'rate-limited' };
    },
  };

  await getUsage(deps);
  assert.equal(calls, 1);
  await getUsage({ ...deps, now: () => 60_000 }); // a plain failure would have retried by now
  assert.equal(calls, 1);
  await getUsage({ ...deps, now: () => 200_000 });
  assert.equal(calls, 2);
});

test('skips the API for expired credentials and caches the answer', async () => {
  const home = makeHome({ expiresAt: 500 });
  let calls = 0;
  const result = await getUsage({
    homeDir: () => home,
    readKeychain: () => null,
    now: () => 1000,
    fetchApi: async () => {
      calls += 1;
      return { data: API_RESPONSE };
    },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
  assert.equal(JSON.parse(fs.readFileSync(cachePath(home), 'utf8')).data, null);
});

test('skips the API for subscription-less users', async () => {
  const home = makeHome({ subscriptionType: '' });
  const result = await getUsage({
    homeDir: () => home,
    readKeychain: () => null,
    now: () => 1000,
    fetchApi: async () => ({ data: API_RESPONSE }),
  });
  assert.equal(result, null);
});

test('parseCredentials rejects missing and expired tokens', () => {
  assert.equal(parseCredentials({}, 1000), null);
  assert.equal(parseCredentials({ claudeAiOauth: { accessToken: 'a', expiresAt: 999 } }, 1000), null);
  assert.deepEqual(parseCredentials({ claudeAiOauth: { accessToken: 'a', expiresAt: 2000 } }, 1000), {
    accessToken: 'a',
    subscriptionType: '',
  });
});

test('getPlanName maps subscription types', () => {
  assert.equal(getPlanName('max'), 'Max');
  assert.equal(getPlanName('claude_pro'), 'Pro');
  assert.equal(getPlanName('team_member'), 'Team');
  assert.equal(getPlanName('enterprise'), 'Enterprise');
  assert.equal(getPlanName('api'), null);
  assert.equal(getPlanName(''), null);
});

test('isCustomEndpoint only fires for non-Anthropic hosts', () => {
  assert.equal(isCustomEndpoint({}), false);
  assert.equal(isCustomEndpoint({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }), false);
  assert.equal(isCustomEndpoint({ ANTHROPIC_BASE_URL: 'https://proxy.internal' }), true);
  assert.equal(isCustomEndpoint({ ANTHROPIC_BASE_URL: 'not a url' }), true);
});

test('keychainServiceNames adds a hashed name for custom config dirs', () => {
  const home = '/home/k';
  assert.deepEqual(keychainServiceNames(home), ['Claude Code-credentials']);

  process.env.CLAUDE_CONFIG_DIR = '/home/k/.claude-work';
  try {
    const names = keychainServiceNames(home);
    assert.equal(names.length, 2);
    assert.match(names[0], /^Claude Code-credentials-[0-9a-f]{8}$/);
    assert.equal(names[1], 'Claude Code-credentials');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});
