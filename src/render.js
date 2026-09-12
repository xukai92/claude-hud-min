// Build the single statusline row.

import { bar, contextColor, cyan, dim, magenta, quotaColor, red, RESET, yellow } from './colors.js';
import { getContextPercent, getModelName, getProviderLabel } from './stdin.js';

const BAR_WIDTH = 5;
/** Only surface the 7-day quota once it is the one worth worrying about. */
const SEVEN_DAY_THRESHOLD = 80;

/**
 * @typedef {object} RenderContext
 * @property {import('./stdin.js').StdinData} stdin
 * @property {import('./git.js').GitStatus | null} git
 * @property {import('./usage.js').UsageData | null} usage
 */

/**
 * Time until a quota window resets, e.g. "4h 48m", "35m", "2d 3h".
 * @param {Date | null} resetAt
 * @param {number} now
 */
export function formatResetTime(resetAt, now = Date.now()) {
  if (!resetAt) return '';
  const diffMs = resetAt.getTime() - now;
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** @param {number | null} percent */
function formatPercent(percent) {
  if (percent === null) return dim('--');
  return `${quotaColor(percent)}${percent}%${RESET}`;
}

/**
 * @param {string} label
 * @param {number | null} percent
 * @param {Date | null} resetAt
 * @param {string} window
 * @param {number} now
 */
function quotaPart(label, percent, resetAt, window, now) {
  const reset = formatResetTime(resetAt, now);
  const value = `${label}${bar(percent ?? 0, BAR_WIDTH, quotaColor)} ${formatPercent(percent)}`;
  return reset ? `${value} (${reset} / ${window})` : value;
}

/**
 * @param {import('./usage.js').UsageData} usage
 * @param {number} now
 */
function renderUsage(usage, now) {
  if (usage.unavailable) {
    return `${yellow('usage: ⚠')}`;
  }

  if (usage.fiveHour === 100 || usage.sevenDay === 100) {
    const resetAt = usage.fiveHour === 100 ? usage.fiveHourResetAt : usage.sevenDayResetAt;
    const reset = formatResetTime(resetAt, now);
    return red(`⚠ Limit reached${reset ? ` (resets ${reset})` : ''}`);
  }

  const plan = usage.planName ? `${usage.planName} ` : '';
  let part = quotaPart(plan, usage.fiveHour, usage.fiveHourResetAt, '5h', now);

  if (usage.sevenDay !== null && usage.sevenDay >= SEVEN_DAY_THRESHOLD) {
    part += ` | ${quotaPart('', usage.sevenDay, usage.sevenDayResetAt, '7d', now)}`;
  }

  // Last known numbers, kept on screen while the API is unreachable.
  return usage.stale ? `${part} ${dim('(stale)')}` : part;
}

/**
 * @param {RenderContext} ctx
 * @param {number} [now]
 */
export function renderLine(ctx, now = Date.now()) {
  const percent = getContextPercent(ctx.stdin);
  const provider = getProviderLabel(ctx.stdin);
  const usage = provider ? null : ctx.usage;
  const usageShows = Boolean(usage?.planName);

  // The plan name normally lives in the usage section. Fall back to showing it
  // next to the model when that section will not render.
  const billing = provider ?? usage?.planName ?? (process.env.ANTHROPIC_API_KEY ? red('API') : null);
  const model = getModelName(ctx.stdin);
  const modelDisplay = !usageShows && billing ? `${model} | ${billing}` : model;

  const parts = [
    `${cyan(modelDisplay)} ${bar(percent, BAR_WIDTH, contextColor)} ${contextColor(percent)}${percent}%${RESET}`,
  ];

  const projectPath = ctx.git?.repoPath ?? ctx.stdin.cwd;
  const project = projectPath ? (projectPath.split(/[/\\]/).filter(Boolean).pop() ?? '/') : null;
  const branch = ctx.git ? `${ctx.git.branch}${ctx.git.isDirty ? '*' : ''}` : null;

  if (project && branch) {
    parts.push(`${yellow(project)} ${magenta('(')}${cyan(branch)}${magenta(')')}`);
  } else if (project) {
    parts.push(yellow(project));
  }

  if (usage) {
    parts.push(renderUsage(usage, now));
  }

  return parts.join(' | ');
}
