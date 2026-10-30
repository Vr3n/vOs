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
