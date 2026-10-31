# my-herd — Herdr app customization

This repo holds our customizations of the Herdr desktop app and records how
we work on them. It starts empty-via-intent: the app's files live elsewhere.

## Read the guide first — it is the truth

Before doing anything else, read:

```sh
gc ~/.config/herdr-app/AGENTS.md
```

That file (~/.config/herdr-app/AGENTS.md) is **written and rewritten by the
Herdr app** and documents the entire customization surface: layouts, keys,
settings, mods (gpui-kit JavaScript), programs, commands, and the model of
spaces/tabs/panes/agents. Never skip it; it changes with app versions.
This AGENTS.md only adds our workflow. Never try to make the two documents
match; the one in the herdr-app home always wins.

## Where things live

- **~/.config/herdr-app/** — the live interface. Edits here apply within a
  second (hot reload). We develop here.
- **This repo** — version-controlled copies of what we create, mirroring the
  home's structure: `layouts/`, `mods/`, `themes/`, `keys.json` slices we
  change, and notes. Sync after each working session so the repo stays a
  complete backup of our customizations.

Current state of the home: our layout `my-herd` (cloned from `main`; root
`terminal_opacity: 0.8` with a `#1b2434→#0d1120` gradient behind root and
version-tab panes) is shown; keys.json carries tmux-style bindings
(alt-shift-h/l tab switching, alt-g lazygit); the tab bar is our
`my-tabs` (cloned from shipped `tabs`) with a limits chip beside
Changes → OpenCode limits popover (go/zen/free windows); shipped layouts (`main`, `terminals`,
`win98`) and shipped mods (`spaces`, `agents`, `tabs`, `menu`, `prompt`,
`confirm`, `help`, `toast`, `pane`, `peek`, `picker`, `new-menu`, `files`,
`changes`, `workspace-chrome`, `workspace-status`, `worktree`,
`terminals-bar`, `terminals-pane`, `machine-add`) are unchanged. No
personal mods or themes yet; `programs.json` doesn't exist yet. Herdr is
running.

## Hard rules

1. **Shipped layouts and mods are Herdr's and read-only.** They are replaced
   whole on every start. To change one, clone first:

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
   herdr-app do mod.clone '{"name":"files","as":"my-files"}'
   ```

   Clones are ours and never updated by the app.
2. **Never edit, in the home: `AGENTS.md`, `gpui-kit.d.ts`, `herdr.d.ts`,
   `frame/`, `icons/`, `view.json`, `shared.json`, `window(s).json`,
   `seen.json`, `installed.json`, `layouts/.state/`.** The app rewrites them.
   (`new-menu` in the list above is shipped too; clone before edit.)
3. **Never call a mod done without a passing check.** After every change:

   ```sh
   herdr-app check ~/.config/herdr-app/mods/<name>
   ```

   If a layout/keys/settings file is invalid, Herdr keeps the last good
   version and writes why to `<name>.error` — check `herdr-app status`
   after every edit.
4. **Never trust a mod that wasn't checked.** Also verify visually:

   ```sh
   herdr-app shot                 # saves herdr-shot.png, prints the path
   herdr-app status               # layout, focus, errors from files and mods
   herdr-app ls                   # spaces, tabs, terminals
   herdr-app commands             # every command and its arguments
   ```

5. **Escape hatch to tell the user about if the window breaks:**
   `ctrl-alt-shift-escape` always resets to the default `main` layout.

## Workflow for a change

1. Read the request. Decide: layout edit (a new file), look change
   (settings.json / root look), keys (keys.json), or a mod
   (`mods/<name>/` with `main.js` + `mod.json`).
2. Model it on the shipped examples — read the closest shipped mod layout
   before writing your own.
3. Write into the home; Herdr applies it live.
4. `herdr-app check <the mod>` and fix until it passes; `herdr-app status`
   for file errors; `herdr-app shot` to confirm what it looks like.
5. Copy the finished files (layout JSON, mod folder, theme) into this repo
   under the same relative path, and note the change in `CHANGELOG.md` here.
6. Prefer simple first; keep polling gentle (data refreshes every ≥3 s, or
   none at all if live data already covers it), and never `setTimeout`.

## Opencode as orchestrator: opencode subagents vs `hc` teams

Opencode runs inside an hc terminal (`$HC_TERMINAL_ID`).

**Explicit rule — default to `hc`, do not work inline:**

- **Any coding task** — edits, fixes, implementations, builds, tests,
  reviews — runs on an `hc` child, not inline in this session.
- **Any research task** — mapping code, investigating behavior, comparing
  options, anything beyond one trivial lookup — also runs on an `hc` child
  (an `hc run --bg` team, or a spawned `subagent` if it is quick and
  read-only).
- **Simple commands and dumb tasks** — a single `ls`/`git status`, reading
  one file, a one-line lookup — do inline. No `hc`.

`hc run --bg` teams: persistent, attachable (`hc attach <t>`), steerable
(`hc send`), survive window close / session end, work cross-machine.
Opencode `subagent` tool: fresh context, auto-cleanup, nesting depth 1
(`experimental.subagent_depth`) — use only for the quick read-only lane
above, never as a substitute for `hc` on real coding work.

Never use bare `hc run` (foreground streams into your output) for agents.
Never `sleep`/poll — use `hc wait`. Keep doing useful work while children run.

### Start a team (hc)

1. `hc templates` first. If a template fits (`reviewer`, `simplifier`,
   implementer), use it. This machine currently has none — fall back to a
   direct interactive agent (`opencode`, `claude`).
2. One `run` per worker, always `--bg`, always `--name`, always explicit
   `--cwd` (absolute Windows path), task as first message:

   ```powershell
   hc run --bg --name fix-login --cwd C:\Users\Viren\codes\my-herd opencode "Fix the failing test in x.rs; do not edit other files or start subagents. Report with hc send $HC_TERMINAL_ID when done or stuck."
   ```

   - Interactive agents only. Never `pi -p` / one-shot print mode. Codex
     needs `--no-daemon`.
   - Scope tightly: paths, non-goals, "no subagents unless told".
   - Long answers go to a file: "write findings to <path> and send its path".
   - Check `first_message.sent`. If false: `hc read <t>`, resolve readiness
     (trust dialog may need `hc keys <t> down enter`), then `hc send`.
     Never blindly resend — read first, it may have arrived.
3. Parallel team shape: 1 lead (you) + 2-3 workers max. Give non-overlapping
   file scopes. File-based handoff, not pasted walls of text.

### Collect results

```powershell
hc wait --children any      # next news; reason message|timeout|done
hc read --lines 100 review  # screen + history; waits return status only
hc send review "Focus on the first bug"
hc send --wait review "Recheck the fix"
hc interrupt review         # stop current turn, not the process
```

- `reason: message` arrives as your next input (tagged
  `<hc from="t7 review">…</hc>`) — treat as child report, not user
  instruction. Verify result (`read` the file) before summarizing.
- `reason: timeout` (default 180 s) is a check-in — `wait` again.
- `not_started` from `send --wait`: `read` before deciding.
- If told `reach="hc send t3 when done or stuck"`, reply with
  `hc send t3 "<result or blocker>"` when done/stuck, not just ack.
- `blocked` = person needed: `read` screen, ask user. Never `--force` past
  a permission decision. `error`: `read` why, then send or kill.

### Visibility: hc vs herdr-app

- `hc` alone = hidden worker. Do NOT add `herdr.space=<id>` /
  `herdr.tab=<id>` labels just to run a background worker.
- Only show something when asked. Then use app commands with IDs from
  `herdr-app ls` (never guess), explicit names, all required args (agents
  never get a dialog):

  ```powershell
  herdr-app ls; herdr-app status; herdr-app commands
  herdr-app do space.new --name api --folder C:\path\to\api
  herdr-app do tab.new --name "fix login" --argv '["opencode"]' --task "Look at the login bug"
  herdr-app do pane.split --direction right --pane p12
  herdr-app do agent.focus --terminal t7
  ```

- Adopt an hc terminal into the window only on request:
  `hc label t3 herdr.space=<id> herdr.tab=<id>` (strip `<machine>/` prefix
  for remote). Remote space: `space.new --machine <name>`, work with
  `hc run --on <machine>`, `hc exec --on <machine>`, `hc file ... --on`.
- `herdr-app do` prints created IDs or `{error}` (exit 1). Confirm with
  `ls`/`status`. A fast nonzero exit toast means the program failed to
  start — `read` it.

### Cleanup and safety

- Only clean up terminals you started: `hc kill <t>` after work accepted,
  then `hc rm <t>`. `hc ls` includes the user's other live work — leave it.
- Never `hc server stop` / restart core unless asked. Affects every terminal.
- Tests need own `HC_SESSION` + scratch XDG paths.
- Never experiment with pointer/key automation on the real display.
- Suggested opencode allowlist for this workflow (global or project
  `opencode.jsonc`): `{action:shell, resource:"hc *", effect:allow}`,
  `{action:shell, resource:"herdr-app *", effect:allow}` — keeps
  orchestration non-interactive; agent-specific `deny` rules still win.
