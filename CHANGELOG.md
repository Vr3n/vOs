# my-herd customizations

## 2026-11-02 (one-command install)

- **`install.sh` / `install.ps1` + `README.md`**: clone the repo and run one
  command to get the exact live setup back. Both scripts copy `layouts/` and
  every personal mod (`galaxy` is a backup only and is skipped), clone
  `JinJieBeWater/herdr-t3` for the `t3-*` mods, lay `patches/` over them,
  add the `layout:herdr-t3` keys to `keys.json` without touching the rest,
  `herdr-app check` the installed mods, then show `herdr-t3`.
- Two Windows/PowerShell traps cost a round: `Set-Content -Encoding utf8` in
  PS 5.1 writes a BOM the app cannot parse (`keys.json was not applied:
  expected value at line 1 column 1`) — `[System.IO.File]::WriteAllText`
  instead; and `$ErrorActionPreference = 'Stop'` turns `git clone`'s stderr
  progress into a terminating error, so native calls run under `Continue`.
  `herdr-app do layout.switch --name herdr-t3` also beats passing JSON
  through PowerShell's native-argument quoting.
- Verified both paths against the live home: `errors: []`, and the shot shows
  the Vr3n brand, the rings and the chip left of `+`.

## 2026-11-02 (herdr-t3 installed, with our brand and the limits chip)

- **Third-party layout `herdr-t3` (JinJieBeWater/herdr-t3) installed** into
  `~/.config/herdr-app` per the app's install recipe: `layouts/herdr-t3.json`
  + `.svg`, and mods `t3-chrome`, `t3-spaces`, `t3-agents`, `t3-focus`,
  `t3-tabs`, `t3-pane`, `t3-new-menu` (all `herdr-app check` pass). It runs
  read-only `git status`/`rev-parse` in space folders and `hc machine ls`,
  `hc label`; no network. Its `keys.json` was merged under
  `layout:herdr-t3` as `cmd-shift-a` / `cmd-shift-s` only — its
  `cmd-shift-b` was left out because we already use that key for
  `layout.toggle:sidebar`.
- **Our `my-brand` replaced its brand bar.** `brand` block → `mod my-brand`
  at 73 px (its rings need 6+26+5+30+6). The T3 brand bar's spaces/focus
  toggle button went with it; the T3 keys still switch the list.
- **OpenCode limits chip moved into the T3 tab bar** (left of the `+`
  button), as `mods/t3-tabs/oc-limits.js` plus three lines in `t3-tabs`'
  `main.js`. `my-oc-limits` is now only the popover: it renders from the
  `limits` the chip hands to `openOverlay`, so only one mod polls
  `opencode api experimental.usage.limits` (once a minute).
- `patches/` holds copies of the files that live inside third-party mods
  (`t3-tabs/main.js`, `t3-tabs/oc-limits.js`) and our installed
  `herdr-t3.json`, so a reinstall of those mods can be re-patched from here.

## 2026-10-31 (galaxy out of the live home; my-herd → vr3n-os)

- **The galaxy canvas left the live home (memory).** Deleted `mods/galaxy/` and
  `layouts/my-galaxy.json` (and its now-orphan preview `layouts/my-galaxy.svg`)
  from `~/.config/herdr-app` — the canvas was too heavy to keep running
  alongside everything else. **Repo copies are kept as a backup**
  (`mods/galaxy/`, `layouts/my-galaxy.json`, `layouts/my-galaxy.svg`); nothing
  else changed. No layout references the mod any more, so
  `herdr-app status` reports `errors: []`. `layouts/.state/` was not touched
  (the app keeps its own entry for the deleted layout's clicks).
- **The galaxy block was also in the shown layout; removed, and the layout is
  now `vr3n-os`.** `my-herd.json` had grown an extra root column (id
  `b860ebef…`, 320 px) holding `mod galaxy`, which is why the mod was still
  active after the folder went. That block is gone; everything else is intact:
  brand → `my-brand` (88 px, the Vr3n title + CPU/RAM/GPU rings), `my-tabs`,
  the spaces/`my-agents` sidebar, the hidden Files/Changes panel, the status
  bar, root gradient `#1b2434 → #0d1120`, `terminal_opacity: 0.8`, the
  `my-toast` float. There is no layout rename command, so the rename followed
  the file pattern: wrote `layouts/vr3n-os.json` with the cleaned tree,
  switched the window to it, then deleted `layouts/my-herd.json`. Repo mirrors
  it — `layouts/vr3n-os.json` added, `layouts/my-herd.json` removed.
- Verified: `herdr-app status` → layout `vr3n-os`, `errors: []`; `herdr-app
  check` passes on the referenced mods we own; `herdr-app shot` shows the Vr3n
  brand with no canvas block.

## 2026-10-31 (galaxy canvas)

- **New `galaxy` mod + `my-galaxy` layout: agents as a galaxy canvas.** Cloned
  the shipped `main` layout (`layout.clone`) and rebuilt the tree: sidebar
  (spaces + `my-agents`, unchanged widths) on the left, our `my-tabs` bar on
  top, then a 50/50 column - `galaxy` on top, a live `{ "agent": "focused" }`
  terminal view below - with the hidden Files/Changes panel and the status bar
  kept so `my-tabs`' panel buttons still work. Look matches `my-herd` (root
  gradient `#1b2434 -> #0d1120`, `terminal_opacity: 0.8`, custom preview
  `layouts/my-galaxy.svg`).
- **The canvas is one pannable viewport** (`mods/galaxy/`): all spaces render
  side by side at world coordinates; press-drag pans (a press moving <4 px is
  still a click; wheel also pans; a `recenter` chip resets). Each space is a
  galaxy: halo rings, seeded star field, nebula blobs, and its name floating
  above. Parent agents are planets (layered circles for a lit-sphere look,
  stable hue from a hash of the terminal address), subagents are moons on a
  spinning orbit ring. Every node has a floating label: name, what it is
  working on, `tokens · harness`.
- **Data**: `agents()`/`terminals()` for the live graph and status; the
  herdr-subagents journal for opencode subagent liveness; one
  `opencode api session.list` call per 9 s for session titles, `parentID` and
  token counts (`input+output+reasoning+cache.read`). Terminal -> session
  mapping matches the live `OC | <title>` title against the session list
  (`hc get` records only hold the newest two sessions, so they are a
  fallback), refreshed every 20 s. Hover shows a status card (status, harness,
  name, title, tokens, address); clicking a planet or moon runs
  `agent.focus { terminal }` so the bottom block shows that agent's terminal.
- Verified: `herdr-app check` passes, `herdr-app status` `errors: []`, shots of
  three galaxies, two planets, two moons with live tokens; `agent.focus t15`
  retargeted the live block. Tokens are `…` until the first session list lands
  and `-` for agents with no opencode session (e.g. claude/codex).

## 2026-10-31 (Vr3n brand with CPU/RAM/GPU rings)

- **Sidebar brand is now "Vr3n" plus live CPU/RAM/GPU rings
  (`mods/my-brand/`, cloned from shipped `workspace-chrome`).** The top-left
  title text is `Vr3n`; below it one row of three ring gauges spans the
  sidebar's full width, each with its `CPU` / `RAM` / `GPU` label beside the
  ring and a hover tooltip. Values refresh every 5 s from `stats.vbs`, a
  one-shot `cscript` read of Windows' own performance classes (no background
  process, no `setTimeout`): `Win32_PerfFormattedData_PerfOS_Processor`
  (`_Total`), `Win32_OperatingSystem` visible/free memory, and the busiest
  3D `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine` engine. A
  value that can't be read shows `-` on an empty ring. Arcs are tinted SVG
  masks in 5% steps (`rings/`); the number stays exact. The `vr3n-os`
  `brand` block points at the clone (88 px tall before the v3 restyle, 46
  originally).
- **Rings restyled (v3): sleek 30 px gauges, metric colors, >70 % red
  blend.** Downsized 44 → 30 px with thin strokes (track + arc SVGs
  regenerated at `stroke-width: 2.4` in the 36 viewBox → ~2 px on screen;
  ~2.3 px per 5 % band), exact numbers still centered inside. Metric
  colors: CPU purple `#a78bfa`, RAM light orange `#fdba74`, GPU keeps its
  theme color (`t.done`). Above 70 % the arc blends into light red
  `#f87171` across the top of the sweep - the metric-colored base arc
  stops at its 70 % bucket and one butt-capped slice per 5 % step
  (`rings/seg-70..100.svg`, generated with the same top-clockwise math as
  the bucket arcs) layers over, each mixed metric→red by
  `0.15 + 0.85·(step/5)` in `main.js`'s `mix()`, so the tint ramps in
  smoothly and stays mild on warm colors (RAM's orange barely shifts;
  CPU's purple gains a red tip as the value climbs). Live CPU 95 / RAM 83
  already showed both cases; a forced 96/82/74 pass verified the full
  ramp, then the real data path was restored (final shot confirms). The
  `brand` block shrinks 88 → 74 px in both `layouts/vr3n-os.json` copies
  (6 pt + 26 title + 5 gap + 30 rings + 6 pb). Data source unchanged.
  `check` passes, `status` `errors: []`; shots of normal, forced and
  final states, all pixel-zoomed.

## 2026-10-31 (explicit hc orchestration rule)

- **AGENTS.md: `hc` default is now an explicit rule, not a heuristic.** Any
  coding task (edits, fixes, builds, tests, reviews) and any research task
  (beyond one trivial lookup) must run on an `hc` child — a `hc run --bg`
  team or a quick read-only `subagent` — not inline. Simple commands and
  dumb tasks (single `ls`/`git status`, one-file reads, one-line lookups)
  stay inline. The opencode `subagent` tool is demoted to the quick
  read-only lane only.

## 2026-10-30 (subagent journal plugin)

- **Proper subagent detection: `herdr-subagents` opencode plugin.** Replaces
  the `session.list` guessing (stale index, ghost sessions, no live status)
  with ground truth from the server event bus. The plugin
  (`~/.config/opencode/plugins/herdr-subagents.js`, mirrored at
  `plugins/herdr-subagents.js` in this repo) keeps one single-line JSON file
  per session under `~/.local/share/opencode/herdr-subagents/` with
  `{id, parentID, title, agent, status, updatedAt}`. Shapes verified against
  the SDK types and a live SSE capture: `session.created` already carries
  id + parentID + title + agent; status/idle/execution/permission events
  carry liveness; heartbeats throttle to 1/s; `session.deleted` removes the
  file. One file per session so concurrent servers never clobber each other.
- **`my-agents` reads the journal.** `readJournal()` pulls all node files in
  one `type *.json`; the tree is built parent→child from real edges, live =
  working/blocked on a <2 min heartbeat (dead servers go stale and vanish).
  Falls back to `session.list` when the journal is absent. Status, urgency,
  fold counts and the detail pane all flow from the same nodes. Verified:
  a probe subagent journaled `{title, agent, parentID}` at birth and flipped
  to idle on completion; `check` passes, `status` clean.
- **Heads-up: restart your opencode TUIs.** The plugin loads at server
  start, so running TUIs (old servers) don't report until restarted; until
  then the sidebar keeps using the `session.list` fallback. `opencode
  reload` activates it on the background service immediately.

## 2026-10-30 (oc active-only)

- **Sidebar shows only active subagents (`mods/my-agents/`).** Back to a
  live-only tree: finished child sessions are filtered out of `ocKids`, so
  the tree never implies activity that ended. Verified: zero live sessions
  in `session.list`, sidebar clean, no rows anywhere. `check` passes,
  `status` clean.

## 2026-10-30 (oc finished greyed)

- **Finished subagents visible but greyed (`mods/my-agents/`).** Reverted
  the live-only filter: all child sessions render again, finished ones with
  a dimmed label + idle dot, running ones with a foreground label +
  working spinner — active work stands out at a glance while past work
  stays reachable. Shot confirms greyed rows with idle dots under both
  parents. `check` passes, `status` clean.

## 2026-10-30 (oc live-only)

- **Sidebar shows only live subagents (`mods/my-agents/`).** Finished
  OpenCode child sessions used to linger as idle rows under a running
  parent. `ocKids` now filters to sessions without an `outcome`, so only
  running subagents appear (fold counts and urgency follow automatically;
  hc child terminals were already live-only). Shot confirms: the fm-analyzer
  agent lists exactly its 4 running round-3 subagents, finished ones gone.

## 2026-10-30 (oc live icons)

- **Subagent running/done icons were frozen (`mods/my-agents/`).** The
  refresh-skipping signature only hashed session *ids*, so when a subagent
  started or finished (outcome set, no new sessions) the fresh `session.list`
  data was discarded and icons never updated. The signature now covers
  `[id, outcome, title]` per child, so status transitions redraw within a
  poll tick. Verified live: spawned a recon subagent, its row appeared with
  the working spinner while `outcome` was null and the finished sibling
  shows the idle dot. `check` passes, `status` clean.

## 2026-10-30 (oc chat tail fixed)

- **Detail pane now opens on the latest message (`mods/my-agents/`).**
  Turn-merging + tool output previews (below) made the tail taller than the
  viewport, exposing that `scroll_to_bottom()` in the fetch callback never
  pinned (call landed before the list mounted). Fix: the render branch calls
  `scroll_to_bottom()` on every render while `ocFollow` is true, so the pane
  is bottom-pinned from first paint and tracks live output; the body wheel
  handler clears `ocFollow` (with a `↓ latest` header chip to jump back).
  Text rendering hardened too: `TextView.markdown` is wrapped in try/catch
  with a plain-text fallback, so odd transcript bytes can't silently drop
  the tail item. Shot proves it: fresh pane opens on the final "Done…"
  message with Deliverables/action-items markdown; the pre-fix pane beside
  it correctly shows the `↓ latest` chip instead.
- **Chat look, agent-style.** Consecutive assistant messages merge into one
  turn (single dot + name + time header, prose and tool cards in order);
  user prompts are right-weighted `raised` rounded-10 bubbles with a
  right-aligned `you · time` caption; every tool card now shows a 300-char
  output preview under its header row, so you can see what the subagent
  actually did without opening anything else.
- Also synced the earlier sidebar poll-lease fix (30 s timestamp leases on
  `ocRefreshing`/`ocFetching` instead of stuck booleans) into the repo.

## 2026-10-30 (oc chat tail)

- **Chat-style transcript with follow-tail (`mods/my-agents/`).** The detail
  pane's message list is now GPUI's measured `list()` (variable heights OK)
  with a `VirtualListScrollHandle` + `track_scroll` and a paired
  `Scrollbar.vertical`, instead of a plain scroll flex. After each successful
  export the pane keys the tail (last id + count + content size) and calls
  `scroll_to_bottom()` only when the tail moved — first load lands on the
  latest message, live sessions track new output, and manual refreshes with
  no change keep your scroll position. Messages render chat-like: user
  prompts are right-weighted bubbles (gutter + `raised` rounded-10 block,
  right-aligned `you · time` caption), agent turns are full-width with an
  accent dot + semibold name + dim time, tool calls sit in an inset `raised`
  rounded-8 group. Renderer creates no handlers/state (forbidden inside
  `list()` renderers), empty messages return an empty div. `list`/`Scrollbar`
  come from `gpui-kit`, the scroll handle from `gpui-base`.
- **Poll leases, not latches.** `ocFetching` had the same stuck-flag hazard
  as the sidebar guard: a hung `exec`/`hc` (no timeout option) would freeze
  the pane's polling forever. Both guards are now 30 s timestamp leases —
  a stale run's slot is taken over and only the lease owner clears it.
- Verified: `check` passes, `status` `errors: []`, shot of a live pane shows
  bottom-pinned chat transcript (dot + name + time headers, inset tool
  groups). Test pane closed; `main.js` synced home==repo.

## 2026-10-30 (oc detail restyle + smart poll)

- **Restyled the `ocDetail` transcript pane (`mods/my-agents/`).** Header is
  now a native panel header (`chrome` bg, `border_b`): status glyph +
  semibold truncated title + dim second line (agent · model · N messages ·
  live/ago), refresh as a `my-tabs` panelButton-style chip (`h 26, px 8,
  gap 5, rounded 6, chrome→hover`), not a bare accent link. User prompts sit
  in a raised rounded block, agent text flows plainly with muted names and
  dim timestamps; tool calls are compact `h 22` rows (status-tinted glyph,
  muted name, truncated input summary, right-aligned status word) with
  consecutive calls grouped at tight gaps; `reasoning` parts are skipped;
  summaries prefer url/path/command keys over format flags. Caps unchanged
  (last 30 messages, ~3000-char parts). Ids stable (`ocdetail`,
  `ocdetail-head`, `ocdetail-msgs`, `ocmsgwrap-…`, `octool-…`).
- **Smarter detail polling.** The 3 s tick now runs cheap `opencode api
  session.get --param sessionID=<id>` and compares `time.updated`; the full
  `session export` runs only on first load, on change, or on manual refresh
  (still via `cmd.exe /c`, npm-shim workaround). A tick is skipped while a
  fetch is in flight; failures keep the last good transcript with a dim
  note. Sidebar `session.list` poll kept at 8 s with a run-dedupe guard.
- Verified: `herdr-app check` passes, `status` `errors: []`, shot of a live
  pane on a finished 22-message session shows the native header, raised
  prompt block, URL-bearing tool rows, no `[reasoning]` noise; test pane
  closed afterwards. Home layout file unchanged.

## 2026-10-30 (opencode subagents)

- **OpenCode subagents in the sidebar (`mods/my-agents/`).** Cloned the
  shipped `agents` mod (`mod.clone`, `cloned_from: agents 0.1.9`) and added
  an OpenCode child-session tree under each main agent row: the mod maps
  each agent terminal to its opencode session id (`hc get` records), polls
  `opencode api session.list` every 8 s (via `cmd.exe /c`, same shim
  workaround as `my-tabs`), groups sessions by `parentID`, and renders
  depth-first `└`/`├` tree rows (`◈` marker, title, working spinner while
  `outcome` is unset, idle dot when done). Parent urgency/fold counts
  include the OpenCode kids, clicks focus the parent pane, tooltip shows
  `agent · session-id`. The `my-herd` sidebar `agents` block now points at
  `my-agents`. Verified: `herdr-app check` passes, `herdr-app status`
  `errors: []`, `herdr-app shot` shows session-title rows (e.g. FM26
  decode/chart tasks) under their parents. Shipped `agents` untouched.
- **Per-agent subagent mapping (fix).** The sidebar mixed every session's
  subagents under every agent: `hc get` records accumulate *all* sessions a
  terminal ever hosted (e.g. t2/t7 both listed two sessions), and the mod
  used every id. Now `refreshOC` resolves each terminal to its *current*
  session only — exact match of the live terminal title (`OC | <session
  title>`) against record titles, falling back to most-recently-updated,
  re-resolved each tick so session switches follow, dead terminals pruned,
  and redraws only on real change (signature compare; failures keep last
  good state instead of wiping the tree). Shot confirms: the my-herd agent
  shows only the restyle subagent, the fm-analyzer agent only its three
  chart subagents. (Also survived a transient "window did not answer"
  during hot reload — recovered on its own, `errors: []`.)
- **Click a subagent row → transcript pane.** The row click now runs
  `pane.split {direction: right, mod: my-agents, props: {ocDetail}}` so the
  subagent's work opens as a real tab pane beside the agent (per request,
  not a popup). The detail copy fetches `opencode session export <id>`
  (message list API isn't exposed as an `opencode api` operation; export
  has the full transcript: user/assistant `text` + `content` tool parts),
  repolls every 4 s, and renders the last 30 non-empty messages as
  markdown with tool-call rows (`✓/✗/◌` + name + input summary) under a
  header (title, agent · model · message count, refresh link). `TextView`
  comes from `gpui-base`, not `gpui-kit` (check caught this). Verified
  end-to-end: opened a pane on a finished chart-test session, shot shows
  prompt markdown + assistant reply + `read` tool rows, then closed the
  pane; `check` passes, `status` clean.
- **Removed the stale `herdr` TUI-multiplexer skill.** Deleted
  `~/.agents/skills/herdr` (installed from `herdrdev/herdr`,
  "terminal multiplexer ... Requires HERDR_ENV=1") and its
  `.skill-lock.json` entry — it described the old TUI, not the Herdr
  desktop app, and sent opencode looking for a `herdr` binary/session
  that doesn't exist here. `hc --skill` / `herdr-app --skill` remain the
  live manuals.

## 2026-10-30 (orchestration)

- **Opencode orchestration rules in `AGENTS.md`.** Researched opencode V2
  (agents/subagents, permissions, tools) + `hc --skill` + `herdr-app --skill`
  on this machine (`hc templates`: none, `hc ls`: t1/t2 live). Added section
  "Opencode as orchestrator": opencode `subagent` for quick read-only work
  vs `hc run --bg --name --cwd` teams for implementers/parallel/persistent/
  cross-machine work; `first_message.sent` check, `wait --children`,
  `send`/`read`/`interrupt`, file-based handoff, hidden-by-default workers
  vs `herdr-app do` only when asked, adopt via `herdr.space/tab` labels,
  cleanup-only-own + never `server stop`, suggested `hc *`/`herdr-app *`
  shell allowlist.

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
