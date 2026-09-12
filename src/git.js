// Branch and dirty state, in two git calls.

import { execFile } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * @typedef {object} GitStatus
 * @property {string} branch
 * @property {boolean} isDirty
 * @property {string | null} repoPath Main repo root, even when cwd is a linked worktree.
 */

/**
 * @param {string} cwd
 * @param {string[]} args
 */
async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 1000, encoding: 'utf8' });
  return stdout;
}

/**
 * Parse `git status --porcelain -b` output.
 * The first line is `## branch...upstream [ahead 1]`; any other line means dirty.
 * @param {string} stdout
 * @returns {{ branch: string, isDirty: boolean } | null}
 */
export function parseStatus(stdout) {
  const lines = stdout.split('\n');
  const header = lines[0] ?? '';
  if (!header.startsWith('## ')) {
    return null;
  }

  let rest = header.slice(3);
  // A repo with no commits reads `## No commits yet on main`.
  const NO_COMMITS = 'No commits yet on ';
  if (rest.startsWith(NO_COMMITS)) {
    rest = rest.slice(NO_COMMITS.length);
  }
  // Detached HEAD reads `## HEAD (no branch)`.
  const branch = rest.startsWith('HEAD (no branch)')
    ? 'HEAD'
    : rest.split('...')[0].split(' ')[0];
  if (!branch) {
    return null;
  }

  return { branch, isDirty: lines.slice(1).some((line) => line.trim().length > 0) };
}

/**
 * Main repo root for a linked worktree. In the main worktree git reports a
 * common dir relative to cwd, so an absolute one that differs from the current
 * toplevel means we are inside a worktree and should name the parent repo.
 * @param {string} stdout Output of `git rev-parse --show-toplevel --git-common-dir`
 * @param {string} cwd
 * @returns {string | null}
 */
export function parseRepoPath(stdout, cwd) {
  const [toplevel, commonDir] = stdout.split('\n').map((line) => line.trim());
  if (!toplevel) {
    return null;
  }
  if (!commonDir || !isAbsolute(commonDir)) {
    return toplevel;
  }

  const mainRepo = dirname(resolve(cwd, commonDir));
  return mainRepo === toplevel ? toplevel : mainRepo;
}

/**
 * @param {string} [cwd]
 * @returns {Promise<GitStatus | null>}
 */
export async function getGitStatus(cwd) {
  if (!cwd) return null;

  const [statusOut, repoOut] = await Promise.all([
    git(cwd, ['--no-optional-locks', 'status', '--porcelain', '-b']).catch(() => null),
    git(cwd, ['rev-parse', '--show-toplevel', '--git-common-dir']).catch(() => null),
  ]);

  if (statusOut === null) return null;

  const status = parseStatus(statusOut);
  if (!status) return null;

  return { ...status, repoPath: repoOut ? parseRepoPath(repoOut, cwd) : null };
}
