// Parse the JSON Claude Code writes to the statusline's stdin.

/**
 * @typedef {object} StdinData
 * @property {string} [cwd]
 * @property {{ id?: string, display_name?: string }} [model]
 * @property {{
 *   context_window_size?: number,
 *   used_percentage?: number | null,
 *   current_usage?: {
 *     input_tokens?: number,
 *     cache_creation_input_tokens?: number,
 *     cache_read_input_tokens?: number,
 *   } | null,
 * }} [context_window]
 */

// Share of the context window Claude Code reserves for autocompact. Only used as a
// fallback for Claude Code < 2.1.6, which did not report used_percentage.
const AUTOCOMPACT_BUFFER_PERCENT = 0.165;

/** @returns {Promise<StdinData | null>} */
export async function readStdin() {
  if (process.stdin.isTTY) {
    return null;
  }

  /** @type {string[]} */
  const chunks = [];

  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      chunks.push(/** @type {string} */ (chunk));
    }
    const raw = chunks.join('');
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {StdinData} stdin */
export function getTotalTokens(stdin) {
  const usage = stdin.context_window?.current_usage;
  return (
    (usage?.input_tokens ?? 0) +
    (usage?.cache_creation_input_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0)
  );
}

/**
 * Context percentage as Claude Code's own /context reports it.
 * Claude Code 2.1.6+ sends used_percentage directly; older versions get a
 * fallback that approximates the autocompact reserve.
 * @param {StdinData} stdin
 */
export function getContextPercent(stdin) {
  const native = stdin.context_window?.used_percentage;
  if (typeof native === 'number' && !Number.isNaN(native)) {
    return Math.min(100, Math.max(0, Math.round(native)));
  }

  const size = stdin.context_window?.context_window_size;
  if (!size || size <= 0) {
    return 0;
  }

  const totalTokens = getTotalTokens(stdin);

  // Scale the buffer by raw usage: none at <=5% (e.g. right after /clear),
  // full at >=50%. Autocompact does not kick in at very low usage.
  const rawRatio = totalTokens / size;
  const scale = Math.min(1, Math.max(0, (rawRatio - 0.05) / (0.5 - 0.05)));
  const buffer = size * AUTOCOMPACT_BUFFER_PERCENT * scale;

  return Math.min(100, Math.round(((totalTokens + buffer) / size) * 100));
}

/** @param {StdinData} stdin */
export function getModelName(stdin) {
  const displayName = stdin.model?.display_name?.trim();
  if (displayName) {
    // "Opus 5 (1M context)" is too wide for one line; "Opus 5 (1M)" says the same.
    return displayName.replace(/\s*\(1M context\)$/, ' (1M)');
  }
  return stdin.model?.id?.trim() || 'Unknown';
}

/**
 * Non-Anthropic-billed providers. When set, usage quota does not apply and the
 * provider name is shown instead of a plan name.
 * @param {StdinData} stdin
 * @returns {string | null}
 */
export function getProviderLabel(stdin) {
  const modelId = stdin.model?.id ?? '';
  if (modelId.toLowerCase().includes('anthropic.claude-')) {
    return 'Bedrock';
  }
  const vertexEnv = process.env.CLAUDE_CODE_USE_VERTEX;
  // Vertex model ids carry an @date suffix, e.g. claude-sonnet-4-5@20250929
  if (modelId.includes('@') || vertexEnv === '1' || vertexEnv === 'true') {
    return 'Vertex';
  }
  return null;
}
