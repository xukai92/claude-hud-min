import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));

/** @param {string} input */
async function run(input) {
  const child = execFileAsync('node', [entry], {
    encoding: 'utf8',
    // A non-Anthropic base URL keeps the run offline: no credentials, no API call.
    env: { ...process.env, ANTHROPIC_BASE_URL: 'https://offline.invalid' },
  });
  child.child.stdin?.end(input);
  const { stdout } = await child;
  return stdout.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
}

test('renders a line for a real repository', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-min-repo-'));
  await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'file.txt'), 'hi');

  const line = await run(
    JSON.stringify({
      model: { display_name: 'Opus 5 (1M context)' },
      context_window: { used_percentage: 45 },
      cwd: repo,
    }),
  );

  assert.match(line, /^Opus 5 \(1M\) ██░░░ 45% \| .+ \(main\*\)$/);
});

test('prints a placeholder for empty input', async () => {
  assert.equal(await run(''), '[claude-hud-min] Initializing...');
});

test('survives malformed input', async () => {
  assert.equal(await run('{not json'), '[claude-hud-min] Initializing...');
});
