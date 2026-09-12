# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A statusline command for Claude Code. Claude Code pipes a JSON payload to
`src/index.js` roughly every 300ms and prints whatever it writes to stdout.
This prints exactly one line.

Plain ESM JavaScript, type-checked through JSDoc annotations. There is no build
step and no `dist/` — the file Claude Code runs is the file in git. Keep it that
way; it is the main thing separating this from upstream claude-hud.

## Layout

```
src/
├── index.js    entry: read stdin, fetch git + usage in parallel, print
├── stdin.js    parse Claude Code's payload (model, context percentage)
├── git.js      branch + dirty, in two git calls
├── usage.js    OAuth plan quota, credentials, disk cache
├── render.js   compose the line
└── colors.js   ANSI helpers, bars
```

## Commands

```bash
npm run setup   # typescript + @types/node — needs --include=dev, see below
npm test        # node:test
npm run check   # tsc --noEmit plus tests — run before committing
npm run demo    # render one line from a sample payload
```

`.npmrc` sets `omit=dev` so that the `npm install` the plugin installer runs in
the plugin cache installs nothing: the package has no runtime dependencies and
an installed copy should stay that way. Keep it that way — adding a runtime
dependency means every installed version carries a `node_modules` tree.

## Things worth knowing

- **Context percentage.** Claude Code 2.1.6+ sends `used_percentage`; prefer it
  so the HUD agrees with `/context`. The token-based fallback exists only for
  older versions and approximates the autocompact reserve.
- **Usage caching.** The statusline is a fresh process every render, so the
  cache lives in `<config dir>/plugins/claude-hud-min/.usage-cache.json`. Before
  fetching, a process stamps the cache `pending`; that claim is what stops
  concurrent sessions from stampeding the API. Never remove it without putting
  something equivalent in its place.
- **Credentials.** macOS keeps them in the Keychain, everything else in
  `.credentials.json`. Keychain wins when both exist — the on-disk copy can be
  stale. `getUsage` takes a `readKeychain` dependency so tests never shell out
  to `security`.
- **Latency budget.** Anything added here runs on every render. Prefer no I/O;
  if I/O is unavoidable, cache it on disk like usage does.
- **Scope.** Requests to add tool/agent/todo/config-count lines belong upstream
  in claude-hud, not here.
