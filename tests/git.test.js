import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRepoPath, parseStatus } from '../src/git.js';

test('parseStatus reads branch and clean state', () => {
  assert.deepEqual(parseStatus('## main...origin/main\n'), { branch: 'main', isDirty: false });
});

test('parseStatus marks any change as dirty', () => {
  assert.deepEqual(parseStatus('## main...origin/main\n M src/index.js\n'), { branch: 'main', isDirty: true });
  assert.deepEqual(parseStatus('## main\n?? untracked.txt\n'), { branch: 'main', isDirty: true });
});

test('parseStatus ignores ahead/behind counts', () => {
  assert.equal(parseStatus('## main...origin/main [ahead 2, behind 1]\n')?.branch, 'main');
});

test('parseStatus handles detached HEAD and empty repos', () => {
  assert.equal(parseStatus('## HEAD (no branch)\n')?.branch, 'HEAD');
  assert.equal(parseStatus('## No commits yet on main\n')?.branch, 'main');
  assert.deepEqual(parseStatus('## No commits yet on main\n?? a.txt\n'), { branch: 'main', isDirty: true });
});

test('parseStatus rejects output without a branch header', () => {
  assert.equal(parseStatus(''), null);
  assert.equal(parseStatus('fatal: not a git repository\n'), null);
});

test('parseRepoPath returns the toplevel in a normal checkout', () => {
  assert.equal(parseRepoPath('/home/k/repo\n.git\n', '/home/k/repo'), '/home/k/repo');
  assert.equal(parseRepoPath('/home/k/repo\n../.git\n', '/home/k/repo/src'), '/home/k/repo');
});

test('parseRepoPath resolves a linked worktree back to the main repo', () => {
  assert.equal(
    parseRepoPath('/tmp/wt/feature\n/home/k/repo/.git\n', '/tmp/wt/feature'),
    '/home/k/repo',
  );
});

test('parseRepoPath returns null outside a repo', () => {
  assert.equal(parseRepoPath('', '/tmp'), null);
});
