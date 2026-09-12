import assert from 'node:assert/strict';
import test from 'node:test';

import { getContextPercent, getModelName, getProviderLabel, getTotalTokens } from '../src/stdin.js';

test('getContextPercent prefers the percentage Claude Code reports', () => {
  assert.equal(getContextPercent({ context_window: { used_percentage: 37.4, context_window_size: 200000 } }), 37);
  assert.equal(getContextPercent({ context_window: { used_percentage: 250 } }), 100);
});

test('getContextPercent falls back to tokens plus an autocompact reserve', () => {
  const stdin = {
    context_window: { context_window_size: 200000, current_usage: { input_tokens: 100000 } },
  };
  // 50% raw usage plus the full 16.5% reserve.
  assert.equal(getContextPercent(stdin), 67);
});

test('getContextPercent applies no reserve just after a clear', () => {
  const stdin = {
    context_window: { context_window_size: 200000, current_usage: { input_tokens: 8000 } },
  };
  assert.equal(getContextPercent(stdin), 4);
});

test('getContextPercent is 0 without a context window', () => {
  assert.equal(getContextPercent({}), 0);
});

test('getTotalTokens sums input and cache tokens', () => {
  const usage = { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 20 };
  assert.equal(getTotalTokens({ context_window: { current_usage: usage } }), 35);
});

test('getModelName shortens the 1M context suffix', () => {
  assert.equal(getModelName({ model: { display_name: 'Opus 5 (1M context)' } }), 'Opus 5 (1M)');
  assert.equal(getModelName({ model: { display_name: 'Opus 5' } }), 'Opus 5');
});

test('getModelName falls back to the model id', () => {
  assert.equal(getModelName({ model: { id: 'claude-opus-5' } }), 'claude-opus-5');
  assert.equal(getModelName({}), 'Unknown');
});

test('getProviderLabel detects Bedrock and Vertex', () => {
  assert.equal(getProviderLabel({ model: { id: 'us.anthropic.claude-sonnet-4-5-v1:0' } }), 'Bedrock');
  assert.equal(getProviderLabel({ model: { id: 'claude-sonnet-4-5@20250929' } }), 'Vertex');
  assert.equal(getProviderLabel({ model: { id: 'claude-opus-5' } }), null);
});
