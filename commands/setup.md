---
description: Configure claude-hud-min as your statusline
allowed-tools: Bash, Read, Edit, Write
---

Set up `claude-hud-min` as the user's statusline. There is nothing to build and
nothing to configure — this only writes `statusLine` into settings.

## Step 1: Locate the plugin

The plugin may be installed through the plugin cache or cloned manually. Check
the cache first (highest installed version wins):

```bash
ls -d "$HOME"/.claude/plugins/cache/claude-hud-min/claude-hud-min/*/ 2>/dev/null \
  | sort -V | tail -1
```

If that is empty, ask the user where they cloned the repo (or look for an
obvious clone, e.g. `~/src/claude-hud-min`). The entry point is
`<plugin dir>/src/index.js`.

## Step 2: Find a runtime

```bash
command -v bun || command -v node
```

Both run `src/index.js` as-is. If neither exists, stop and tell the user to
install Node.js 18+ or Bun.

## Step 3: Build the command

- **Installed via the plugin cache** — resolve the version at runtime so
  updates need no re-setup:

  ```
  bash -c 'dir=$(ls -d "$HOME"/.claude/plugins/cache/claude-hud-min/claude-hud-min/*/ 2>/dev/null | sort -V | tail -1); exec "{RUNTIME}" "${dir}src/index.js"'
  ```

- **Cloned manually** — point straight at the clone:

  ```
  {RUNTIME} /absolute/path/to/claude-hud-min/src/index.js
  ```

## Step 4: Test it

Pipe a sample payload through the command and confirm it prints one line:

```bash
echo '{"model":{"display_name":"Opus 5"},"context_window":{"used_percentage":45},"cwd":"'$PWD'"}' | {COMMAND}
```

Do not write settings if this errors.

## Step 5: Write settings

Merge into `~/.claude/settings.json` (on Windows, `%USERPROFILE%\.claude\settings.json`),
preserving every existing key:

```json
{
  "statusLine": {
    "type": "command",
    "command": "{COMMAND}"
  }
}
```

If the file has invalid JSON, report it and do not overwrite. Tell the user the
statusline appears below the input box, and that plan usage only shows for
subscription (Pro/Max/Team) logins.
