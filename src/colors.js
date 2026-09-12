// ANSI colors and bars.

export const RESET = '\x1b[0m';

const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BRIGHT_BLUE = '\x1b[94m';
const BRIGHT_MAGENTA = '\x1b[95m';

/**
 * @param {string} text
 * @param {string} color
 */
function colorize(text, color) {
  return `${color}${text}${RESET}`;
}

/** @param {string} text */
export const red = (text) => colorize(text, RED);
/** @param {string} text */
export const yellow = (text) => colorize(text, YELLOW);
/** @param {string} text */
export const magenta = (text) => colorize(text, MAGENTA);
/** @param {string} text */
export const cyan = (text) => colorize(text, CYAN);
/** @param {string} text */
export const dim = (text) => colorize(text, DIM);

/**
 * Context bar color: green under 70%, yellow under 85%, red above.
 * @param {number} percent
 */
export function contextColor(percent) {
  if (percent >= 85) return RED;
  if (percent >= 70) return YELLOW;
  return GREEN;
}

/**
 * Quota bar color: blue under 75%, magenta under 90%, red above.
 * @param {number} percent
 */
export function quotaColor(percent) {
  if (percent >= 90) return RED;
  if (percent >= 75) return BRIGHT_MAGENTA;
  return BRIGHT_BLUE;
}

/**
 * @param {number} percent
 * @param {number} width
 * @param {(percent: number) => string} color
 */
export function bar(percent, width, color) {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  return `${color(safePercent)}${'█'.repeat(filled)}${DIM}${'░'.repeat(safeWidth - filled)}${RESET}`;
}
