#!/usr/bin/env node
// claude-hud-min — one statusline row: model, context, project, git, plan usage.
//
// Derived from claude-hud (https://github.com/jarrodwatts/claude-hud),
// Copyright (c) 2026 Jarrod Watts, MIT. See NOTICE.

import { getGitStatus } from './git.js';
import { renderLine } from './render.js';
import { readStdin } from './stdin.js';
import { getUsage } from './usage.js';
import { RESET } from './colors.js';

async function main() {
  try {
    const stdin = await readStdin();
    if (!stdin) {
      console.log('[claude-hud-min] Initializing...');
      return;
    }

    const [git, usage] = await Promise.all([getGitStatus(stdin.cwd), getUsage()]);

    console.log(`${RESET}${renderLine({ stdin, git, usage })}`);
  } catch (error) {
    console.log(`[claude-hud-min] Error: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

await main();
