# my-herd customizations

## 2026-10-30

- **Terminal background opacity 80%.** Cloned the shipped `main` layout to
  `my-herd` (`layout.clone`, `cloned_from: main 0.1.9`) and set
  `"terminal_opacity": 0.8` on the clone's root in
  `~/.config/herdr-app/layouts/my-herd.json`. The clone switched to shown
  automatically; `herdr-app status` reports no errors; verified with
  `herdr-app shot`. Original `main` untouched (it stays the escape-hatch
  reset target). Mirror of the layout kept at `layouts/my-herd.json`.
- **Made the opacity visible with a root + pane-frame gradient.** First
  attempt showed no visual change: the pane frame sat on the same `background`
  theme color as the terminals themselves ("background" over "canvas"), so
  an 80%-opaque terminal over an identical color is the same color. Added
  `"background": {"gradient": ["#1b2434", "#0d1120"], "angle": 165}` to the
  `my-herd` root and to the version-tab pane frame's `background`, so the
  80% blend has something different to mix against. Verified via pixel
  sampling of `herdr-app shot` (corner 14/18/33 vs pane 23/25/29 vs sidebar
  16/17/20) and `herdr-app status` (`errors: []`).
- **Tmux keybindings ported** (from tmux.conf at
  github.com/Vr3n/tmux). Deltas to defaults in `keys.json`:
  - `alt-shift-h` / `alt-shift-l`: `tab.prev` / `tab.next` (tmux `M-H`/`M-L`
    window switching; took these from default pane swaps).
  - `alt-shift-left` / `alt-shift-right` → `pane.swap:left` / `:right`
    (the swap moves here so nothing is lost).
  - `alt-g` → `terminal.open` with `argv: ["lazygit"]` (tmux `prefix C-y`
    lazygit popup; Herdr has no prefix or popup-argv, so this is a direct
    key opening a lazygit terminal in the current folder).
  - Already-default (kept): `alt-h/j/k/l` pane nav (vim-tmux-navigator,
    asked-and-answered: user chose Alt over Ctrl to spare shells),
    `ctrl-shift-e`/`ctrl-shift-o` as `-`/`%` splits, `ctrl-shift-t`
    (new window), `ctrl-shift-n` (new session), `ctrl-shift-c` (yank).
  - Not portable: the `C-Space` prefix (no prefix concept; keys are direct),
    copy-mode vi keys (`v`/`C-v`/`y` — mouse selection + `ctrl-shift-c`
    is the analog), `send-prefix`, tmux-resurrect (terminals survive
    restarts in Herdr natively). Verified `keys.error` absent, and tested
    the `terminal.open` argv JSON end-to-end (t3 opened, killed).
