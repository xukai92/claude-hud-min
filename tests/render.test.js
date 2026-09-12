import assert from 'node:assert/strict';
import test from 'node:test';

import { formatResetTime, renderLine } from '../src/render.js';

// The API badge is env-driven; keep it out of the way except where it is tested.
delete process.env.ANTHROPIC_API_KEY;

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
/** @param {number} mins */
const inMinutes = (mins) => new Date(NOW + mins * 60_000);

/** @param {string} line */
const plain = (line) => line.replace(/\x1b\[[0-9;]*m/g, '');

const baseCtx = {
  stdin: { model: { display_name: 'Opus 5' }, cwd: '/home/k/my-project', context_window: { used_percentage: 45 } },
  git: { branch: 'main', isDirty: false, repoPath: '/home/k/my-project' },
  usage: null,
};

test('renders model, context, project and git', () => {
  assert.equal(plain(renderLine(baseCtx, NOW)), 'Opus 5 ██░░░ 45% | my-project (main)');
});

test('marks a dirty working tree', () => {
  const ctx = { ...baseCtx, git: { ...baseCtx.git, isDirty: true } };
  assert.equal(plain(renderLine(ctx, NOW)), 'Opus 5 ██░░░ 45% | my-project (main*)');
});

test('names the main repo when run from a linked worktree', () => {
  const ctx = {
    ...baseCtx,
    stdin: { ...baseCtx.stdin, cwd: '/tmp/wt/feature' },
    git: { branch: 'feature', isDirty: false, repoPath: '/home/k/my-project' },
  };
  assert.equal(plain(renderLine(ctx, NOW)), 'Opus 5 ██░░░ 45% | my-project (feature)');
});

test('falls back to cwd outside a git repo', () => {
  assert.equal(plain(renderLine({ ...baseCtx, git: null }, NOW)), 'Opus 5 ██░░░ 45% | my-project');
});

test('renders the 5h quota with its reset time', () => {
  const ctx = {
    ...baseCtx,
    usage: {
      planName: 'Max',
      fiveHour: 25,
      sevenDay: 10,
      fiveHourResetAt: inMinutes(90),
      sevenDayResetAt: inMinutes(3000),
    },
  };
  assert.equal(
    plain(renderLine(ctx, NOW)),
    'Opus 5 ██░░░ 45% | my-project (main) | Max █░░░░ 25% (1h 30m / 5h)',
  );
});

test('adds the 7d quota only once it is high', () => {
  const usage = {
    planName: 'Max',
    fiveHour: 20,
    sevenDay: 85,
    fiveHourResetAt: inMinutes(60),
    sevenDayResetAt: inMinutes(2880),
  };
  assert.match(plain(renderLine({ ...baseCtx, usage }, NOW)), /85% \(2d \/ 7d\)$/);
  assert.doesNotMatch(plain(renderLine({ ...baseCtx, usage: { ...usage, sevenDay: 79 } }, NOW)), /7d/);
});

test('flags a reached limit', () => {
  const usage = {
    planName: 'Max',
    fiveHour: 100,
    sevenDay: 40,
    fiveHourResetAt: inMinutes(42),
    sevenDayResetAt: null,
  };
  assert.match(plain(renderLine({ ...baseCtx, usage }, NOW)), /⚠ Limit reached \(resets 42m\)$/);
});

test('marks numbers kept from a failed refresh', () => {
  const usage = {
    planName: 'Max',
    fiveHour: 30,
    sevenDay: 5,
    fiveHourResetAt: inMinutes(60),
    sevenDayResetAt: null,
    stale: true,
  };
  assert.match(plain(renderLine({ ...baseCtx, usage }, NOW)), /\(stale\)$/);
});

test('warns when usage is unavailable', () => {
  const usage = {
    planName: 'Max',
    fiveHour: null,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
    unavailable: true,
  };
  assert.match(plain(renderLine({ ...baseCtx, usage }, NOW)), /usage: ⚠$/);
});

test('shows the plan next to the model when the usage section is absent', () => {
  const ctx = {
    ...baseCtx,
    stdin: { ...baseCtx.stdin, model: { display_name: 'Sonnet 5', id: 'claude-sonnet-4-5@20250929' } },
    usage: { planName: 'Max', fiveHour: 10, sevenDay: 1, fiveHourResetAt: null, sevenDayResetAt: null },
  };
  // Vertex is billed outside the plan, so the quota section is dropped.
  assert.equal(plain(renderLine(ctx, NOW)), 'Sonnet 5 | Vertex ██░░░ 45% | my-project (main)');
});

test('badges API-key billing when there is no plan', () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  try {
    assert.equal(plain(renderLine(baseCtx, NOW)), 'Opus 5 | API ██░░░ 45% | my-project (main)');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('formatResetTime covers minutes, hours and days', () => {
  assert.equal(formatResetTime(inMinutes(35), NOW), '35m');
  assert.equal(formatResetTime(inMinutes(60), NOW), '1h');
  assert.equal(formatResetTime(inMinutes(150), NOW), '2h 30m');
  assert.equal(formatResetTime(inMinutes(60 * 27), NOW), '1d 3h');
  assert.equal(formatResetTime(inMinutes(-5), NOW), '');
  assert.equal(formatResetTime(null, NOW), '');
});
