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
- **OpenCode limits mod (`mods/oc-limits/`).** Top-bar button (128 px block
  right of the tab bar, added to `my-herd.json` as a `tabs-row` wrapper
  holding `tabs` at weight 1 + the block at px 128 — tabs keep full width so
  window controls stay flush right; the row keeps `px: 42` height).
  Data: `opencode api experimental.usage.limits` (discovered via the
  OpenAPI spec; `/limits`, `/provider` are SPA 404s). The CLI wraps the
  payload in `{location, data}` — use `.data`. Executable note: `opencode`
  is an npm `.cmd`/`.ps1` shim on Windows, so spawn
  `cmd.exe /c opencode …`. Renders every plan key present (`free`, `go`,
  `zen`) with `rolling`/`weekly`/`monthly` percent bars, `limited` flag,
  `resetsAt` as relative time; worst clock shown on the button; green
  (<50), working (50–79), blocked (≥80 or limited) from theme colors.
  Button opens a popover: `openOverlay({kind: "popup", at: "pointer",
  width: 320})` — Esc/click-beside closes (user asked for popover, not a
  centered dialog; `at: "pointer"` comes from `herdr.d.ts`). First check
  failed: `props()` is null at `herdr-app check` time — guard with
  `(props() ?? {}).detail`. First layout attempt lost the row's
  `size: {px: 42}`, ballooning the tab bar — restored it. Activity-console
  link opens `workspace.usageURL` via
  `rundll32 url.dll,FileProtocolHandler`. Poll every 60 s (data only).
- **Chip restyle (2026-10-30, follow-up):** user asked the button to look
  like the shipped `Files`/`Changes` buttons. Read `mods/tabs/main.js`
  `panelButton` — `h(26).px(8).gap(5).rounded(6)`, `bg(t.chrome)` (blends
  into the bar until `bg(t.hover)`), 14 px tinted svg icon — and mirrored
  it: the strip now paints `chrome` + `border_b(1, border)` so the tab bar
  continues seamlessly into the block, the chip uses the tabs-mod spec,
  and the icon is `icons/opencode.svg` tinted by severity. Label keeps the
  severity color and `Go <pct>%` text (user approved it).
  User then asked the chip to sit *beside Changes* (before the window
  controls) — impossible while those are drawn inside the shipped `tabs`
  mod. Solution per the guide: `mod.clone {"name":"tabs","as":"my-tabs"}`;
  layout's `tabs` block now points at the clone and the separate
  `oc-limits` block (and mod) were removed. `my-tabs` = tabs clone +
  limits fetch (60 s) + `limitsChip(t)` inserted between the Changes
  panel-button and the window-control buttons, + self-opening details
  dialog (`openOverlay({mod: "my-tabs", props: {detail: true}, kind:
  "popup", at: "pointer", width: 320})`; guarded `(props() ?? {}).detail`
  the same way). `oc-limits` deleted from home and repo; its logic lives
  in `mods/my-tabs/main.js`. Note: `layout.clone`'s sibling `mod.clone`
  rewrote the clone's own asset paths automatically.
- **Notification system (paused 2026-10-30, WIP in repo).** Key finding,
  proven by pixel-checked probe tests: `notify()` is **name-bound to the
  shipped `toast` mod** — neither a clone (`my-toast`, painted pink) nor
  `toast-edited` intercepts it (toast rendered gray `37,39,43`, never
  pink). Docs' "replaceable" is not reachable from a personal mod in this
  build. Architecture instead: shipped toast keeps app events; our surface
  is `mods/my-toast` as a root-level `floating` block (`edge: bottom,
  align: end`) reading a `shared("notifs")` queue; other mods post via
  `setShared`. Implemented: severity chip + glyph, title/body/action rows,
  dismiss, `+N earlier` past 4, per-level TTL (info 5s, success 4s,
  warning 8s, error sticky), hover pauses expiry via
  `placement().hovered`, 1 s sweep writing only on change. Left to do when
  resumed: real posters (limits thresholds, agent events); remove the
  one-time `seed-*` cleanup in `init`. Probe + toast-edited folders
  deleted; status block restored; empty queue collapses float to 0x0.
