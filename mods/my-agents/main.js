// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.

import { View, div, image, svg, list } from "gpui-kit";
import { v_flex, h_flex, TextView, Scrollbar, VirtualListScrollHandle } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, exec, hc, home } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return tab.name === prog && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    if (props()?.ocDetail) {
      // Detail pane copy: transcript of one OpenCode subagent session.
      this.ocDetailId = props().ocDetail;
      this.ocDetail = null;
      this.ocDetailError = null;
      this.ocDetailUpdated = null;
      this.ocFetching = 0;
      this.ocScroll = VirtualListScrollHandle.new();
      this.ocFollow = true;
      cx.timer.every(3000, (cx) => this.refreshDetail(cx));
      this.refreshDetail(cx, true);
      return;
    }
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    cx.timer.every(30000, (cx) => cx.notify());
    // OpenCode subagents: child sessions (parentID) of each agent's session,
    // shown as tree rows under the main agent. Data-only polling.
    this.addrSession = {};
    this.ocByParent = new Map();
    this.ocSig = null;
    cx.timer.every(8000, (cx) => this.refreshOC(cx));
    this.refreshOC(cx);
  }

  // Proper subagent graph: the herdr-subagents opencode plugin maintains one
  // tiny JSON file per session (<home>/.local/share/opencode/herdr-subagents/)
  // with {id, parentID, title, agent, status, updatedAt} straight from the
  // server event bus (session.created already carries id, parentID, title and
  // agent; status/idle/execution events carry liveness). A node counts as
  // live while its status is working/blocked on a fresh heartbeat (<2 min);
  // stale working nodes belong to dead servers. Falls back to `session.list`
  // when the journal is missing (servers predating the plugin).
  nodeLive(s) {
    if (s.updatedAt != null) {
      return (s.status === "working" || s.status === "blocked") && (Date.now() - s.updatedAt < 120000);
    }
    return !s.outcome;
  }

  nodeStatus(s) {
    if (s.status === "blocked") return "blocked";
    if (s.status === "working") return "working";
    if (s.status === "idle" || s.outcome) return "idle";
    return "working";
  }

  nodeUpdated(s) {
    return s?.updatedAt ?? s?.time?.updated ?? 0;
  }

  async readJournal() {
    try {
      const h = String(home()).replace(/\//g, "\\").replace(/\\$/, "");
      const r = await exec("cmd.exe", ["/c", "type", `${h}\\.local\\share\\opencode\\herdr-subagents\\*.json`]);
      const map = new Map();
      for (const line of String(r.stdout).split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const n = JSON.parse(t);
          if (n?.id) map.set(n.id, n);
        } catch { /* partial line; next tick */ }
      }
      return map;
    } catch {
      return null;
    }
  }

  // Maps agent terminal address -> its CURRENT opencode session id (via hc get
  // records), then groups the journal (or session.list) graph by parentID.
  // A terminal's records accumulate every session it ever hosted, so with
  // several candidates pick the one matching the terminal's live title
  // ("OC | <session title>"); else the most recently updated.
  refreshOC(cx) {
    // Lease, not a latch: exec/hc have no timeout, so a hung fetch must not
    // freeze polling forever. A run older than 30s is presumed dead and its
    // slot is taken over; a late straggler only clears its own lease.
    const now = Date.now();
    if (this.ocRefreshing && now - this.ocRefreshing < 30000) return;
    this.ocRefreshing = now;
    cx.spawn(async (cx) => {
      try {
        const journal = await this.readJournal();
        let sessions;
        if (journal && journal.size) {
          sessions = [...journal.values()];
        } else {
          const r = await exec("cmd.exe", ["/c", "opencode", "api", "session.list"]);
          sessions = JSON.parse(String(r.stdout).trim()).data ?? [];
        }
        const byId = new Map(sessions.map((s) => [s.id, s]));
        const byParent = new Map();
        for (const s of sessions) {
          if (!s?.parentID) continue;
          if (!byParent.has(s.parentID)) byParent.set(s.parentID, []);
          byParent.get(s.parentID).push(s);
        }
        for (const kids of byParent.values()) kids.sort((x, y) => (this.nodeUpdated(x) - this.nodeUpdated(y)));
        const addrSession = {};
        for (const a of agents()) {
          try {
            const g = await hc(["get", a.address]);
            const raw = String(g.stdout ?? "").trim();
            const o = raw ? JSON.parse(raw) : null;
            const recs = o?.records ?? o?.data?.records ?? null;
            let ids = recs ? Object.keys(recs) : [];
            if (ids.length > 1) {
              const termTitle = String(o?.title ?? "").replace(/^OC\s*\|\s*/, "");
              const hit = termTitle ? ids.filter((id) => recs[id]?.title === termTitle) : [];
              if (hit.length) ids = hit;
              else ids = [...ids].sort((x, y) => (this.nodeUpdated(byId.get(y)) - this.nodeUpdated(byId.get(x)))).slice(0, 1);
            }
            if (ids.length) addrSession[a.address] = ids;
          } catch { /* keep polling next round */ }
        }
        // Dead terminals drop out by themselves; only redraw on real change —
        // including status/title changes so running/done icons stay live.
        const sig = JSON.stringify([addrSession, [...byParent].map(([k, v]) => [k, v.map((s) => [s.id, this.nodeStatus(s), s.title ?? ""])])]);
        if (sig !== this.ocSig) {
          this.addrSession = addrSession;
          this.ocByParent = byParent;
          this.ocSig = sig;
          cx.notify();
        }
      } catch {
        /* keep last good state */
      }
      if (this.ocRefreshing === now) this.ocRefreshing = 0;
    });
  }

  // Depth-first OpenCode child sessions for an agent address, with tree lines.
  // Only live nodes are shown, so the tree never implies activity that
  // already ended. Liveness comes from the journal (status + heartbeat),
  // falling back to outcome when the journal is missing.
  ocKids(addr, lead = []) {
    const sessIds = this.addrSession[addr] ?? [];
    const out = [];
    const kidsOf = (pid) => (this.ocByParent.get(pid) ?? []).filter((s) => this.nodeLive(s));
    const walk = (pid, prefix) => {
      const kids = kidsOf(pid);
      kids.forEach((sess, i) => {
        const last = i === kids.length - 1;
        const lines = [...prefix, last ? "└" : "├"];
        out.push({ sess, lines, live: true, status: this.nodeStatus(sess) });
        walk(sess.id, [...prefix, last ? "" : "│"]);
      });
    };
    sessIds.forEach((sid, si) => {
      const kids = kidsOf(sid);
      kids.forEach((sess, i) => {
        const last = i === kids.length - 1;
        // When several sessions share one terminal, restart lines per session.
        const lines = sessIds.length > 1 ? [...lead, last ? "└" : "├"] : [...lead, last ? "└" : "├"];
        out.push({ sess, lines, live: true, status: this.nodeStatus(sess) });
        walk(sess.id, [...lead, last ? "" : "│"]);
      });
    });
    return out;
  }

  ocRow(t, o, shown, compact, parentAddr) {
    const sess = o.sess;
    const st = o.status ?? (o.live ? "working" : "idle");
    const label = sess.title || sess.agent || sess.id;
    return h_flex()
      .id(`ocsub-${sess.id}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .hover((s) => s.bg(t.hover))
      .tooltip(`${sess.agent ?? "subagent"} · ${sess.id}`)
      .on_click(() => run("pane.split", { direction: "right", mod: "my-agents", props: { ocDetail: sess.id } }))
      .children(o.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .child(div().mr(8).text_size(12.5).text_color(t.muted).child("◈"))
      .child(div().flex_1().truncate().text_color(st === "working" ? t.foreground : t.muted).child(label))
      .child(this.status(t, { status: st }, compact));
  }

  // Detail pane: cheap change check (`session.get` vs `time.updated`) on a 3 s
  // tick; the full `session export` runs only on first load, when `updated`
  // moved, or on manual refresh. Never two fetches at once; failures keep the
  // last good transcript and note it dimly until the next tick.
  refreshDetail(cx, force = false) {
    // Lease, not a latch (see refreshOC): a hung exec must not freeze the pane.
    const now = Date.now();
    if (this.ocFetching && now - this.ocFetching < 30000) return;
    this.ocFetching = now;
    cx.spawn(async (cx) => {
      try {
        let updated = null;
        try {
          const g = await exec("cmd.exe", ["/c", "opencode", "api", "session.get", "--param", `sessionID=${this.ocDetailId}`]);
          updated = JSON.parse(String(g.stdout).trim()).data?.time?.updated ?? null;
        } catch { /* fall through to a full fetch */ }
        const stale = updated === null && !this.ocDetail;
        if (force || stale || updated === null || updated !== this.ocDetailUpdated) {
          try {
            const r = await exec("cmd.exe", ["/c", "opencode", "session", "export", this.ocDetailId]);
            this.ocDetail = JSON.parse(String(r.stdout).trim());
            this.ocDetailUpdated = this.ocDetail?.info?.time?.updated ?? updated;
            this.ocDetailError = null;
          } catch (e) {
            if (!this.ocDetail) this.ocDetailError = String(e?.message ?? e).slice(0, 200);
            else this.ocDetailNote = "refresh failed — showing last good transcript";
          }
        } else {
          this.ocDetailNote = null;
        }
      } catch (e) {
        if (!this.ocDetail) this.ocDetailError = String(e?.message ?? e).slice(0, 200);
      }
      if (this.ocFetching === now) this.ocFetching = 0;
      cx.notify();
    });
  }

  // One transcript message, chat-style. User prompts are bubbles pushed right
  // behind a gutter; agent turns flow full width with a name header and tool
  // calls grouped in an inset block. No handlers in here: this runs inside
  // list()'s renderer, where clicks and retained state are refused.
  ocMessage(t, msgs, index) {
    const m = msgs[index];
    const when = m.time?.completed ?? m.time?.created;
    const clock = when ? new Date(when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const mine = m.type === "user";
    const trunc = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
    const kids = [];
    const pushText = (key, text) => {
      // TextView.markdown can choke on odd transcript bytes; fall back to
      // plain text rather than dropping the message (a failed item would
      // silently move the visible tail).
      try {
        kids.push(TextView.markdown(key, trunc(text, 3000)));
      } catch {
        kids.push(div().text_size(12.5).text_color(t.foreground).child(trunc(text, 3000)));
      }
    };
    // Prefer the most informative string for the summary: a command, path or
    // URL beats a format flag or id.
    const toolSummary = (p) => {
      const input = p.state?.input ?? p.input ?? {};
      const pick = ["command", "cmd", "url", "path", "file", "filepath", "query", "pattern", "text", "prompt", "question", "id"]
        .map((k) => input[k]).find((v) => typeof v === "string" && v.trim());
      const first = pick ?? Object.values(input).find((v) => typeof v === "string") ?? "";
      return trunc(String(first).split("\n")[0], 140) || (p.name ?? "tool");
    };
    const toolOutput = (p) => trunc((p.state?.content ?? []).map((c) => c.text ?? "").join("\n").trim(), 300);
    const toolCard = (p, n) => {
      const summary = toolSummary(p);
      const st = p.state?.status;
      const glyph = st === "completed" ? "✓" : st === "failed" ? "✗" : "◌";
      const color = st === "completed" ? t.dim : st === "failed" ? t.blocked : t.working;
      const out = toolOutput(p);
      return v_flex().id(`octool-${m.id}-${n}`).flex_none()
        .child(h_flex().h(22).gap(7).items_center().px(8)
          .child(div().w(14).flex_none().text_size(11.5).text_color(color).child(glyph))
          .child(div().flex_none().text_size(12).font_medium().text_color(t.muted).child(p.name ?? "tool"))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(summary))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(st ?? "")))
        .when(Boolean(out), (el) => el.child(div().pl(29).pr(8).pb(4).text_size(11.5).text_color(t.dim).child(out)));
    };
    let group = [];
    let cardN = 0;
    const flush = (inset) => {
      if (group.length) kids.push(v_flex().id(`octoolgroup-${m.id}-${kids.length}`).gap(2)
        .when(inset, (el) => el.rounded(8).bg(t.raised).px(4).py(4))
        .children(group));
      group = [];
    };
    if (m.text) pushText(`ocmsg-${m.id}`, m.text);
    for (const p of m.content ?? []) {
      if (p.type === "text" && p.text) { flush(true); pushText(`ocpart-${m.id}-${p.text.length}`, p.text); }
      else if (p.type === "tool") group.push(toolCard(p, cardN++));
      else if (p.type && p.type !== "reasoning") { flush(true); kids.push(div().text_size(12).text_color(t.dim).child(`[${p.type}]`)); }
    }
    flush(true);
    if (!kids.length) return div();
    const prev = index > 0 ? msgs[index - 1] : null;
    if (mine) {
      return h_flex().id(`ocmsgwrap-${m.id}`).w_full().gap(8).py(2)
        .child(div().w(24).flex_none())
        .child(v_flex().flex_1().min_w(0).gap(4).rounded(10).bg(t.raised).px(12).py(8)
          .child(div().text_right().text_size(11).text_color(t.dim).child(["you", clock].filter(Boolean).join(" · ")))
          .children(kids));
    }
    // Consecutive assistant messages merge into one turn: no repeat header.
    const who = m.agent ?? m.type ?? "agent";
    let row = v_flex().id(`ocmsgwrap-${m.id}`).w_full().gap(4).pb(2);
    if (!prev || prev.type === "user") {
      row = row.pt(2).child(h_flex().gap(6).items_center()
        .child(div().size(7).flex_none().rounded(4).bg(t.accent))
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child(who))
        .when(Boolean(clock), (el) => el.child(div().text_size(11).text_color(t.dim).child(clock))));
    }
    return row.children(kids);
  }

  ocDetailPane(t) {
    const info = this.ocDetail?.info;
    const all = this.ocDetail?.messages ?? [];
    const msgs = all.filter((m) => m.text || (m.content ?? []).length).slice(-30);
    const live = info && !info.outcome;
    const updated = info?.time?.updated;
    const ago = updated ? duration(Date.now() - updated) + " ago" : null;
    const sub = info
      ? [info.agent, info.model?.id, `${all.length} messages`, live ? "live" : ago].filter(Boolean).join(" · ")
      : "loading…";
    return v_flex().id("ocdetail").size_full().min_h(0).bg(t.canvas)
      .child(h_flex().id("ocdetail-head").flex_none().gap(8).items_center().px(12).py(10).bg(t.chrome).border_b(1).border_color(t.border)
        .child(this.status(t, { status: live ? "working" : "idle" }))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().text_size(13).font_semibold().text_color(t.foreground).child(info?.title ?? this.ocDetailId))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(sub)))
        .child(h_flex().id("ocdetail-refresh").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
          .text_size(12).bg(t.chrome).text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Refresh transcript")
          .on_click((_e, cx) => this.refreshDetail(cx, true))
          .child("refresh"))
        .when(!this.ocFollow, () => h_flex().id("ocdetail-latest").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
          .text_size(12).text_color(t.accent)
          .hover((s) => s.text_color(t.foreground))
          .tooltip("Jump to the latest message")
          .on_click((_e, cx) => {
            this.ocFollow = true;
            try { this.ocScroll.scroll_to_bottom(); } catch { /* not mounted yet */ }
            cx.notify();
          })
          .child("↓ latest")))
      .when(this.ocDetailError, () => div().px(12).py(8).text_size(12).text_color(t.blocked).child(this.ocDetailError))
      .when(!this.ocDetail && !this.ocDetailError, () => div().px(12).py(8).text_size(12).text_color(t.dim).child("Loading transcript…"))
      .when(this.ocDetailNote && !this.ocDetailError, () => div().px(12).pt(6).text_size(11).text_color(t.dim).child(this.ocDetailNote))
      .child(v_flex().id("ocdetail-body").flex_1().min_h(0).relative().px(12)
        .on_scroll_wheel((_e, cx) => {
          // The user took the wheel: stop following until they jump back.
          if (this.ocFollow) { this.ocFollow = false; cx.notify(); }
        })
        .child(list("ocdetail-list", msgs.length,
          (i) => msgs[i].id ?? `oc-${i}`,
          (index) => this.ocMessage(t, msgs, index)).track_scroll(this.ocScroll))
        .child(Scrollbar.vertical("ocdetail-list").absolute().inset_0()));
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  setPins(pins) {
    this.pins = pins;
    localStorage.setItem("pins", JSON.stringify(pins));
  }

  // Drops pins of agents that ended. Only for machines the list has heard from:
  // right after a start, or while a machine connects, its agents aren't listed yet.
  prunePins(all) {
    const machine = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");
    const heard = new Set(all.map((k) => machine(k.address)));
    const live = new Set(all.filter((k) => k.state === "live").map((k) => k.address));
    const kept = this.pins.filter((p) => !heard.has(machine(p)) || live.has(p));
    if (kept.length !== this.pins.length) this.setPins(kept);
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.ocDetail) {
      // Pin to the latest message while following; a render-time call holds
      // even when the list first mounts after a fetch lands.
      if (this.ocFollow) { try { this.ocScroll.scroll_to_bottom(); } catch { /* not mounted yet */ } }
      return this.ocDetailPane(t);
    }
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0), ...this.ocKids(a.address).map((o) => RANK[o.status ?? "working"] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    this.prunePins(all);
    const pinned = this.pins.map((p) => list.find((a) => a.address === p)).filter(Boolean);
    const rest = list.filter((a) => !this.pins.includes(a.address));
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const ocs = collapsed ? [] : this.ocKids(a.address);
      const ocLike = ocs.map((o) => ({ t: { address: o.sess.id, status: o.status ?? "working" }, lines: o.lines }));
      const r = row(a, i, [...subs, ...ocLike]);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority)), ...ocs.map((o) => this.ocRow(t, o, shown, byPriority, a.address))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    const tabs = spaces().flatMap(s => s.tabs);
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      return tab ? title(tab, lead(tab)) : a.title || a.program?.name || "";
    };
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = this.pins.includes(a.address);
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.setPins(isPinned ? this.pins.filter((p) => p !== a.address) : [...this.pins, a.address]);
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().flex_none().max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "my-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .child(
        h_flex()
          .h(28)
          .px(12)
          .items_center()
          .justify_end()
          .when(collapsed, (el) => el.justify_center().px(0))
          .child(
            div()
              .id("collapse")
              .text_size(13)
              .text_color(t.dim)
              .hover((s) => s.text_color(t.foreground))
              .on_click(toggleSidebar)
              .child(collapsed ? "»" : ""),
          ),
      );
  }
}
