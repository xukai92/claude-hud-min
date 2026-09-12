# claude-hud-min

A one-line statusline for [Claude Code](https://claude.com/claude-code): which
model you are on, how full the context is, where you are, and how much of your
plan's quota is left.

Built on [claude-hud](https://github.com/jarrodwatts/claude-hud) by Jarrod
Watts — this is that plugin cut down to its compact layout. See
[NOTICE](NOTICE) for what is derived from it.

```
Opus 5 (1M) ██░░░ 37% │ claude-hud-min (main*) │ Max █░░░░ 25% (1h 30m / 5h)
└─ model ───┴ context ┘ └ project ─┴ branch ──┘ └ plan ┴ 5h quota ┴ resets in ┘
```

Nothing else. No tool feed, no agent list, no todo progress, no config file.

## What each part means

| Part | Detail |
|---|---|
| **Model** | `display_name` from Claude Code. `(1M context)` is shortened to `(1M)`. |
| **Context** | The same percentage `/context` reports, including the autocompact reserve. Green under 70%, yellow under 85%, red above. |
| **Project** | Current directory. Inside a linked worktree it names the main repo instead. |
| **Branch** | Current branch, with `*` when the tree is dirty (staged, unstaged, or untracked). |
| **Plan usage** | 5-hour quota and time until it resets, for Pro/Max/Team logins. The 7-day quota is appended only once it passes 80%. Blue under 75%, magenta under 90%, red above. |

Quota comes from the same OAuth endpoint the `/usage` command uses, cached on
disk for 60s. It is skipped entirely for API-key, Bedrock, Vertex, and custom
`ANTHROPIC_BASE_URL` setups, which are billed outside a plan — those show the
provider next to the model instead.

## Install

As a plugin:

```
/plugin marketplace add xukai92/claude-hud-min
/plugin install claude-hud-min
/claude-hud-min:setup
```

Or clone it and point your statusline at the entry file — there is no build
step, so this is the whole install:

```bash
git clone https://github.com/xukai92/claude-hud-min ~/src/claude-hud-min
```

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /absolute/path/to/claude-hud-min/src/index.js"
  }
}
```

Requires Node.js 18+ or Bun. `bun` runs the same file and starts faster.

## Relation to claude-hud

This is a stripped rewrite of [claude-hud](https://github.com/jarrodwatts/claude-hud)
for people who only ever used its compact layout. Same data sources, same
colors, same numbers, about a fifth of the code. All the hard-won parts — the
context percentage model, the usage API handling, the thresholds — are its work;
[NOTICE](NOTICE) records which.

Deliberately dropped:

- **Config** — the layout above is the layout. What upstream expresses as
  `lineLayout: compact` with most `display.*` flags off is simply what this does.
- **Transcript parsing** — no tools, agents, todos, session name, or duration,
  so the transcript JSONL is never read.
- **Environment counts** — no CLAUDE.md / rules / MCP / hook tallies.
- **Build step** — plain ESM JavaScript, type-checked from JSDoc via `tsc`, run
  directly. No `dist/`, no release pipeline.
- **Width fitting** — no grapheme-aware truncation or wrapping; the terminal
  wraps the line if it has to.
- **Proxy support** — usage fetches go direct, so `HTTPS_PROXY` is ignored.

Kept because they are load-bearing: the autocompact-aware context fallback for
Claude Code < 2.1.6, macOS Keychain credentials, worktree-aware project naming,
and cross-process caching of the usage API.

## Development

```bash
npm install     # only devDependencies: typescript + @types/node
npm test        # node:test, no runner
npm run check   # typecheck + tests
npm run demo    # render one line from a sample payload
```

## License

MIT — see [LICENSE](LICENSE).

A derivative work of [claude-hud](https://github.com/jarrodwatts/claude-hud),
© 2026 Jarrod Watts, also MIT. Its copyright is carried in LICENSE and the
derivation is itemized in [NOTICE](NOTICE).
