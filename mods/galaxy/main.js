// Galaxy: ONE canvas, a galaxy per space, parent agents as planets and their
// subagents as moons. Labels float above each node; hovering shows a status
// card; clicking a node points the layout's live-view block at that agent.
// The canvas pans: press and drag anywhere (empty space or a node), and a
// press that barely moves counts as a click.
//
// Data, all read-only:
//   - agents()/terminals(): live planets, live core subagent terminals, status.
//   - the herdr-subagents journal (~/.local/share/opencode/herdr-subagents/):
//     one JSON per opencode session, {id, parentID, title, agent, status, updatedAt}.
//   - `opencode api session.list` (one call per tick): session titles, parentID
//     and token counts. Polled every 9 s; the terminal -> session mapping is
//     refreshed every 20 s via `hc get` records.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, spaces, focused, run, theme, exec, hc, home, setAgentOrder } from "herdr";

const C = {
  space: "#05070e",
  border: "#152238",
  name: "#e9f1ff",
  muted: "#8fa4c8",
  dim: "#5f7395",
  faint: "#3f5170",
  star: "#cfe0ff",
  pop: "#0d1526f5",
  popBorder: "#24395c",
};

const WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle", error: "error" };

// World geometry, in canvas pixels at zoom 1.
const GAP = 520; // between galaxy centers
const GR = 180; // galaxy radius (the halo)
const PLANET_R = 20;
const ORBIT_R = 56;
const MOON_R = 8;
const DRAG_SLOP = 4; // a press that moves less than this is a click

// --- small utilities -------------------------------------------------------

function hash(s) {
  let h = 2166136261;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: a tiny seeded PRNG, so stars stay put while the canvas redraws.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// HSL -> #rrggbb, so agent colors are stable and readable on a dark sky.
function hsl(hue, sat, light) {
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function alpha(color, a) {
  const v = Math.max(0, Math.min(255, Math.round(a * 255)));
  return color.slice(0, 7) + v.toString(16).padStart(2, "0");
}

function cleanTitle(s) {
  return String(s ?? "").replace(/^OC\s*\|\s*/, "").replace(/\s+/g, " ").trim();
}

function fmtTok(n) {
  if (n == null || !isFinite(n)) return null;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

// Everything a session spent: prompt, reply, reasoning and context read.
function totalTok(tok) {
  if (!tok) return null;
  return (tok.input ?? 0) + (tok.output ?? 0) + (tok.reasoning ?? 0) + (tok.cache?.read ?? 0);
}

function palette(seed) {
  const hue = hash(seed) % 360;
  return {
    base: hsl(hue, 0.58, 0.52),
    limb: hsl(hue, 0.6, 0.2),
    lit: hsl(hue, 0.72, 0.74),
    glow: hsl(hue, 0.8, 0.6),
    tag: hsl(hue, 0.65, 0.8),
  };
}

const kidWord = (s) => (s === "error" ? "blocked" : s === "done" ? "done" : s || "working");

export default class Galaxy extends View {
  init(_props, cx) {
    this.sessions = new Map(); // id -> session from session.list (tokens, parentID)
    this.journal = new Map(); // id -> journal node (status heartbeat)
    this.addrSession = {}; // terminal address -> [session ids]
    this.mappedAt = 0;
    this.hover = null;
    this.sel = null;
    this.size = null; // canvas size
    this.pan = { x: 0, y: 0 };
    this.drag = null;
    this.stars = null; // screen-space starfield for the last size
    this.pos = {}; // node key -> {x, y, r, node} in canvas coordinates
    this.galaxies = 1;
    this.pullLease = 0;
    this.mapLease = 0;
    cx.timer.every(9000, (cx) => this.pull(cx));
    cx.timer.every(20000, (cx) => this.map(cx));
    this.pull(cx);
    this.map(cx);
  }

  // --- data ---------------------------------------------------------------

  async readJournal() {
    try {
      const h = String(home()).replace(/\//g, "\\").replace(/\\$/, "");
      const r = await exec("cmd.exe", ["/c", "type", `${h}\\.local\\share\\opencode\\herdr-subagents\\*.json`]);
      const map = new Map();
      for (const line of String(r.stdout).split("\n")) {
        const s = line.trim();
        if (!s.startsWith("{")) continue;
        try {
          const n = JSON.parse(s);
          if (n?.id) map.set(n.id, n);
        } catch {
          /* half-written line; next tick */
        }
      }
      return map;
    } catch {
      return null;
    }
  }

  // One call for every session's tokens, title, parent and times.
  async readSessions() {
    try {
      const r = await exec("cmd.exe", ["/c", "opencode", "api", "session.list"]);
      const out = JSON.parse(String(r.stdout).trim());
      const list = out?.data ?? [];
      return new Map(list.filter((s) => s?.id).map((s) => [s.id, s]));
    } catch {
      return null;
    }
  }

  // Sessions by title: a terminal's live title ("OC | <session title>") names the
  // session it shows. `hc get` records hold only the newest couple, so look the
  // title up in the full session list first, then fall back to the records.
  titleIndex() {
    const map = new Map();
    for (const s of this.sessions.values()) {
      const t = cleanTitle(s.title);
      if (!t) continue;
      const cur = map.get(t);
      if (!cur || (s.time?.updated ?? 0) > (cur.time?.updated ?? 0)) map.set(t, s);
    }
    return map;
  }

  async mapAgents() {
    const next = {};
    const byTitle = this.titleIndex();
    const live = terminals()
      .filter((x) => x.state === "live" && (x.status || x.parent))
      .slice(0, 16);
    for (const a of live) {
      try {
        const g = await hc(["get", a.address]);
        const o = JSON.parse(String(g.stdout ?? "").trim() || "null");
        const title = cleanTitle(o?.title);
        const byName = title ? byTitle.get(title) : null;
        if (byName) {
          next[a.address] = [byName.id];
          continue;
        }
        const recs = o?.records ?? null;
        const ids = recs ? Object.keys(recs) : [];
        const hit = title && recs ? ids.filter((id) => recs[id]?.title === title) : [];
        const pick = hit.length
          ? hit
          : [...ids].sort((x, y) => (this.sessions.get(y)?.time?.updated ?? 0) - (this.sessions.get(x)?.time?.updated ?? 0)).slice(0, 1);
        if (pick.length) next[a.address] = pick;
      } catch {
        /* next tick */
      }
    }
    if (Object.keys(next).length) this.addrSession = next;
  }

  // Sessions, journal and tokens: one gentle pull. A slow call must not block
  // the rest or the mapping below, so each loop keeps its own lease.
  pull(cx) {
    const now = Date.now();
    if (this.pullLease && now - this.pullLease < 12000) return;
    this.pullLease = now;
    cx.spawn(async (cx) => {
      try {
        const journal = await this.readJournal();
        const sessions = await this.readSessions();
        if (journal) this.journal = journal;
        if (sessions) this.sessions = sessions;
        cx.notify();
      } catch {
        /* keep the last good graph */
      }
      if (this.pullLease === now) this.pullLease = 0;
    });
  }

  map(cx) {
    if (!this.sessions.size) return; // wait for the session list first
    const now = Date.now();
    if (this.mapLease && now - this.mapLease < 45000) return;
    this.mapLease = now;
    cx.spawn(async (cx) => {
      try {
        await this.mapAgents();
        cx.notify();
      } catch {
        /* next tick */
      }
      if (this.mapLease === now) this.mapLease = 0;
    });
  }

  planetNode(a, tBy) {
    const term = tBy.get(a.address) ?? {};
    const ids = this.addrSession[a.address] ?? [];
    const sess = ids.map((id) => this.sessions.get(id)).find(Boolean) ?? null;
    const title = cleanTitle(sess?.title) || cleanTitle(a.title) || "";
    const raw = term.name ? String(term.name) : title || a.program?.name || a.address;
    const name = raw.length > 30 ? `${raw.slice(0, 29)}\u2026` : raw;
    const where = [a.space_name, a.tab_name].filter(Boolean).join(" / ");
    const work = title && title !== raw ? title : where;

    const moons = [];
    const taken = new Set();
    // Core subagent terminals (hc run): live children of this planet.
    for (const k of terminals().filter((x) => x.parent === a.address && x.state === "live")) {
      const kAg = agents().find((z) => z.address === k.address) ?? null;
      const kSess = (this.addrSession[k.address] ?? []).map((id) => this.sessions.get(id)).find(Boolean) ?? null;
      if (kSess) taken.add(kSess.id);
      const kTitle = cleanTitle(kSess?.title) || cleanTitle(k.title) || "";
      const kName = k.name ? String(k.name) : kTitle.slice(0, 26) || k.program?.name || k.address;
      moons.push({
        key: `m-${k.address}`,
        kind: "moon",
        address: k.address,
        planet: a.address,
        sessionId: kSess?.id ?? null,
        name: kName.length > 24 ? `${kName.slice(0, 23)}\u2026` : kName,
        work: kTitle && kTitle !== kName ? kTitle : where,
        title: kTitle,
        tokens: totalTok(kSess?.tokens),
        harness: String(kAg?.program?.name ?? k.program?.name ?? "agent"),
        status: kidWord(kAg?.status ?? k.status),
      });
    }

    // Journal/session children: opencode subagent sessions still working.
    const seen = new Set(ids);
    const queue = [...ids];
    const extra = [];
    while (queue.length) {
      const parent = queue.shift();
      for (const s of this.sessions.values()) {
        if (s.parentID !== parent || seen.has(s.id)) continue;
        seen.add(s.id);
        queue.push(s.id);
        if (taken.has(s.id)) continue;
        const j = this.journal.get(s.id);
        if (j?.status !== "working" && j?.status !== "blocked") continue;
        const jt = cleanTitle(s.title) || s.agent || s.id;
        extra.push({
          key: `j-${s.id}`,
          kind: "moon",
          address: null,
          planet: a.address,
          sessionId: s.id,
          name: jt.length > 24 ? `${jt.slice(0, 23)}\u2026` : jt,
          work: String(s.agent ?? "subagent"),
          title: jt,
          tokens: totalTok(s.tokens),
          harness: "opencode",
          status: j.status === "blocked" ? "blocked" : "working",
        });
      }
    }
    extra.sort((x, y) => (this.sessions.get(x.sessionId)?.time?.created ?? 0) - (this.sessions.get(y.sessionId)?.time?.created ?? 0));

    return {
      key: `p-${a.address}`,
      kind: "planet",
      address: a.address,
      sessionId: sess?.id ?? null,
      name,
      work,
      title,
      tokens: totalTok(sess?.tokens),
      harness: String(a.program?.name ?? a.app ?? "agent"),
      status: a.status,
      moons: [...moons, ...extra].slice(0, 6),
    };
  }

  graph() {
    const tBy = new Map(terminals().map((x) => [x.address, x]));
    const roots = agents().filter((a) => {
      const q = tBy.get(a.address);
      return q && !q.parent && q.state === "live";
    });
    return spaces().map((sp) => ({
      space: sp,
      planets: roots.filter((a) => a.space === sp.id).map((a) => this.planetNode(a, tBy)),
    }));
  }

  // --- canvas helpers -----------------------------------------------------

  // Screen-space stars: the sky stays put while the galaxies pan over it.
  starfield() {
    const W = this.size?.width ?? 1240;
    const H = this.size?.height ?? 420;
    const key = `${Math.round(W)}x${Math.round(H)}`;
    if (!this.stars || this.stars.key !== key) {
      const r = rng(hash(key));
      const n = Math.max(40, Math.min(90, Math.round((W * H) / 6000)));
      const list = [];
      for (let i = 0; i < n; i++) {
        const big = r() < 0.07;
        list.push({ x: Math.round(r() * W), y: Math.round(r() * H), s: big ? 2 : 1, a: big ? 0.8 : 0.14 + r() * 0.5 });
      }
      this.stars = { key, list };
    }
    return this.stars.list.map((st) => div().absolute().left(st.x).top(st.y).size(st.s).rounded_full().bg(alpha(C.star, st.a)));
  }

  // A lit sphere out of flat circles: dark limb, body, lit face, specular dot.
  sphere(pal, d, glow = true) {
    const inner = Math.max(3, d - Math.max(2, Math.round(d * 0.09)));
    const kid = [];
    if (glow) {
      kid.push(
        div()
          .absolute()
          .left(-Math.round(d * 0.34))
          .top(-Math.round(d * 0.34))
          .size(Math.round(d * 1.68))
          .rounded_full()
          .bg(alpha(pal.glow, 0.12)),
      );
    }
    kid.push(div().absolute().left(0).top(0).size(d).rounded_full().bg(pal.limb));
    kid.push(div().absolute().left(1).top(0).size(inner).rounded_full().bg(pal.base));
    kid.push(
      div()
        .absolute()
        .left(Math.round(d * 0.14))
        .top(Math.round(d * 0.1))
        .size(Math.round(d * 0.56))
        .rounded_full()
        .bg(alpha(pal.lit, 0.7)),
    );
    kid.push(
      div()
        .absolute()
        .left(Math.round(d * 0.3))
        .top(Math.round(d * 0.2))
        .size(Math.max(2, Math.round(d * 0.13)))
        .rounded_full()
        .bg("#ffffffd9"),
    );
    return v_flex().absolute().left(0).top(0).size(d).children(kid);
  }

  statusRing(t, status, d) {
    const tint = t[status] ?? t.dim;
    if (status === "working") {
      return svg("mods/galaxy/spinner.svg").absolute().left(-10).top(-10).size(d + 20).text_color(tint).spin(2400);
    }
    if (status === "blocked") {
      return div()
        .absolute()
        .left(-7)
        .top(-7)
        .size(d + 14)
        .rounded_full()
        .border(1.5)
        .border_color(tint)
        .loop("opacity", { from: 1, to: 0.3, period: 1200 });
    }
    if (status === "done") {
      return div().absolute().left(-4).top(-4).size(d + 8).rounded_full().border(1).border_color(alpha(tint, 0.6));
    }
    return null;
  }

  metaLine(n) {
    const tok = n.tokens != null ? `${fmtTok(n.tokens)} tok` : this.sessions.size ? "tokens \u2014" : "tokens \u2026";
    return `${tok} \u00b7 ${n.harness}`;
  }

  // A press on a node is a click unless the canvas is being dragged.
  show(node, cx) {
    if (this.drag?.moved || this.ignoreClick) {
      this.ignoreClick = false;
      return;
    }
    this.sel = node.key;
    if (node.address) run("agent.focus", { terminal: node.address });
    else if (node.planet) run("agent.focus", { terminal: node.planet });
    cx.notify();
  }

  hoverIn(key) {
    this.hover = key;
  }

  clampPan(pan) {
    const W = this.size?.width ?? 1240;
    const H = this.size?.height ?? 420;
    const worldW = (Math.max(1, this.galaxies) - 1) * GAP + GR * 2;
    const worldH = GR * 2 + 60;
    const maxX = Math.max(0, (worldW - W) / 2 + 120);
    const maxY = Math.max(40, (worldH - H) / 2 + 120);
    return {
      x: Math.max(-maxX, Math.min(maxX, pan.x)),
      y: Math.max(-maxY, Math.min(maxY, pan.y)),
    };
  }

  nodeElement(node, t, x, y, r, pal, planet) {
    const d = Math.max(8, Math.round(r * 2));
    const selected = this.sel === node.key || (planet && focused()?.agent === node.address);
    const tint = t[node.status] ?? t.dim;
    const kids = [this.sphere(pal, d)];
    const ring = this.statusRing(t, node.status, d);
    if (ring) kids.push(ring);
    if (planet && node.moons.length) {
      kids.push(
        svg("mods/galaxy/orbit.svg")
          .absolute()
          .left(-ORBIT_R)
          .top(-ORBIT_R)
          .size(ORBIT_R * 2)
          .text_color(alpha(pal.glow, 0.5))
          .spin(node.status === "working" ? 9000 : 26000),
      );
    }
    kids.push(div().absolute().left(-Math.round(d * 0.9)).top(-Math.round(d * 0.9)).size(Math.round(d * 2.8)).rounded_full().bg(alpha(tint, 0.05)));
    if (selected) {
      kids.push(div().absolute().left(-8).top(-8).size(d + 16).rounded_full().border(1.5).border_color(alpha(t.accent, 0.85)));
    }
    return div()
      .id(`node-${node.key}`)
      .absolute()
      .left(Math.round(x - r))
      .top(Math.round(y - r))
      .size(d)
      .rounded_full()
      .cursor_pointer()
      .hover((s) => s.bg(alpha(pal.lit, 0.14)))
      .on_hover((on, cx) => {
        if (on) this.hover = node.key;
        else if (this.hover === node.key) this.hover = null;
        cx.notify();
      })
      .on_click((_e, cx) => this.show(node, cx))
      .tooltip(`${WORD[node.status] ?? node.status} \u00b7 ${node.name}`)
      .children(kids);
  }

  labelFor(node, t, x, y, w, above, pal) {
    const top = above ? y : y + 4;
    return v_flex()
      .id(`label-${node.key}`)
      .absolute()
      .left(Math.round(x - w / 2))
      .top(Math.round(top))
      .w(w)
      .items_center()
      .gap(0)
      .cursor_pointer()
      .on_hover((on, cx) => {
        if (on) this.hover = node.key;
        else if (this.hover === node.key) this.hover = null;
        cx.notify();
      })
      .on_click((_e, cx) => this.show(node, cx))
      .child(
        div()
          .max_w(w)
          .truncate()
          .text_size(node.kind === "planet" ? 12.5 : 10)
          .font_semibold()
          .text_color(node.kind === "planet" ? C.name : pal.tag)
          .child(node.name),
      )
      .when(Boolean(node.work), (el) =>
        el.child(div().max_w(w).truncate().text_size(node.kind === "planet" ? 10 : 8.5).text_color(node.kind === "planet" ? C.muted : C.dim).child(node.work)),
      )
      .child(div().max_w(w).truncate().text_size(node.kind === "planet" ? 9.5 : 8.5).text_color(node.kind === "planet" ? C.dim : C.faint).child(this.metaLine(node)));
  }

  popup(t) {
    const key = this.hover;
    const at = key ? this.pos[key] : null;
    if (!at) return null;
    const W = this.size?.width ?? 1240;
    const H = this.size?.height ?? 420;
    const w = 216;
    const h = 106;
    const left = Math.max(8, Math.min(W - w - 8, Math.round(at.x + at.r + 16)));
    const top = Math.max(8, Math.min(H - h - 8, Math.round(at.y - 28)));
    const tint = t[at.node.status] ?? t.dim;
    return v_flex()
      .absolute()
      .left(left)
      .top(top)
      .w(w)
      .h(h)
      .p(10)
      .gap(3)
      .rounded(9)
      .bg(C.pop)
      .border(1)
      .border_color(C.popBorder)
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().size(6).rounded(3).bg(tint))
          .child(div().text_size(10).font_semibold().text_color(tint).child((WORD[at.node.status] ?? at.node.status ?? "").toUpperCase()))
          .child(div().flex_1())
          .child(div().text_size(9.5).text_color(C.dim).child(at.node.harness)),
      )
      .child(div().text_size(11).font_medium().text_color(C.name).truncate().child(at.node.name))
      .child(div().text_size(9.5).text_color(C.muted).truncate().child(at.node.title || at.node.work || "\u2014"))
      .child(
        div()
          .text_size(9)
          .text_color(C.dim)
          .child([at.node.tokens != null ? `${fmtTok(at.node.tokens)} tokens` : this.sessions.size ? "tokens \u2014" : "tokens \u2026", at.node.address ?? ""].filter(Boolean).join(" \u00b7 ")),
      );
  }

  // --- the canvas ---------------------------------------------------------

  drawGalaxy(g, t, ox, oy) {
    const kids = [];
    const id = g.space.id;
    const gx = ox + g.cx;
    const gy = oy;
    const hue = hash(id) % 360;
    const active = g.space.active;

    // halo, nebula and a thin rim
    kids.push(
      div()
        .absolute()
        .left(Math.round(gx - GR * 1.45))
        .top(Math.round(gy - GR * 1.45))
        .size(Math.round(GR * 2.9))
        .rounded_full()
        .bg(alpha(hsl(hue, 0.75, 0.55), 0.04)),
    );
    const nr = rng(hash(`neb-${id}`));
    for (let i = 0; i < 2; i++) {
      const d = Math.round(GR * (0.95 + nr() * 0.5));
      kids.push(
        div()
          .absolute()
          .left(Math.round(gx + (nr() - 0.5) * GR * 0.7 - d / 2))
          .top(Math.round(gy + (nr() - 0.5) * GR * 0.6 - d / 2))
          .size(d)
          .rounded_full()
          .bg(alpha(hsl((hue + 28 + i * 30) % 360, 0.78, 0.55), 0.05)),
      );
    }
    kids.push(
      div()
        .absolute()
        .left(Math.round(gx - GR))
        .top(Math.round(gy - GR))
        .size(GR * 2)
        .rounded_full()
        .border(1)
        .border_color(alpha(hsl(hue, 0.6, 0.6), active ? 0.28 : 0.14)),
    );
    kids.push(
      div()
        .absolute()
        .left(Math.round(gx - GR * 0.66))
        .top(Math.round(gy - GR * 0.66))
        .size(Math.round(GR * 1.32))
        .rounded_full()
        .border(1)
        .border_color(alpha(hsl(hue, 0.6, 0.6), 0.1)),
    );
    kids.push(
      div()
        .absolute()
        .left(Math.round(gx - GR * 0.3))
        .top(Math.round(gy - GR * 0.3))
        .size(Math.round(GR * 0.6))
        .rounded_full()
        .bg(alpha(hsl(hue, 0.8, 0.6), 0.08)),
    );

    // galaxy stars, in world space so they travel with it
    const sr = rng(hash(`stars-${id}`));
    for (let i = 0; i < 14; i++) {
      const a = sr() * Math.PI * 2;
      const rr = Math.sqrt(sr()) * GR * 0.95;
      kids.push(
        div()
          .absolute()
          .left(Math.round(gx + Math.cos(a) * rr))
          .top(Math.round(gy + Math.sin(a) * rr))
          .size(sr() < 0.2 ? 2 : 1)
          .rounded_full()
          .bg(alpha(C.star, 0.25 + sr() * 0.5)),
      );
    }

    // its name, above the halo
    kids.push(
      h_flex()
        .id(`galaxy-${id}`)
        .absolute()
        .left(Math.round(gx - 130))
        .top(Math.round(gy - GR - 24))
        .w(260)
        .h(20)
        .items_center()
        .justify_center()
        .gap(7)
        .cursor_pointer()
        .on_click((_e, cx) => {
          if (this.drag?.moved || this.ignoreClick) {
            this.ignoreClick = false;
            return;
          }
          run("space.select", { id });
          cx.notify();
        })
        .tooltip(`Show ${g.space.name}`)
        .child(div().size(6).rounded(3).bg(g.space.status ? (t[g.space.status] ?? t.dim) : alpha(C.muted, 0.45)))
        .child(
          div()
            .max_w(170)
            .truncate()
            .text_size(11.5)
            .font_medium()
            .text_color(active ? C.name : C.muted)
            .child(g.space.name),
        )
        .child(
          div()
            .text_size(9.5)
            .text_color(C.faint)
            .child(`${g.planets.length} ${g.planets.length === 1 ? "agent" : "agents"}`),
        ),
    );

    if (g.planets.length === 0) {
      kids.push(
        div()
          .absolute()
          .left(Math.round(gx - 80))
          .top(Math.round(gy - 8))
          .w(160)
          .text_size(10.5)
          .text_color(C.faint)
          .child("no agents in this space"),
      );
    }

    const count = g.planets.length;
    g.planets.forEach((p, j) => {
      const ang = ((90 + j * (360 / Math.max(1, count))) * Math.PI) / 180;
      const px = gx + Math.cos(ang) * GR * 0.62;
      const py = gy + Math.sin(ang) * GR * 0.5;
      const pal = palette(p.address ?? p.key);
      this.pos[p.key] = { x: px, y: py, r: PLANET_R, node: p };
      kids.push(this.nodeElement(p, t, px, py, PLANET_R, pal, true));
      kids.push(this.labelFor(p, t, px, py - PLANET_R - 58, 240, true, pal));

      p.moons.forEach((m, k) => {
        const mc = p.moons.length;
        const deg = mc === 1 ? 62 : 16 + (k * 148) / (mc - 1);
        const ma = (deg * Math.PI) / 180;
        const or = ORBIT_R + (k % 2 === 1 ? 12 : 0);
        const mx = px + Math.cos(ma) * or;
        const my = py + Math.sin(ma) * or;
        const mpal = palette(m.sessionId ?? m.address ?? m.key);
        this.pos[m.key] = { x: mx, y: my, r: MOON_R, node: m };
        kids.push(this.nodeElement(m, t, mx, my, MOON_R, mpal, false));
        kids.push(this.labelFor(m, t, mx, my + MOON_R + 5, 108, false, mpal));
      });
    });

    return kids;
  }

  render(cx) {
    const t = theme();
    const galaxies = this.graph();
    const planets = galaxies.flatMap((g) => g.planets);
    const moons = planets.reduce((n, p) => n + p.moons.length, 0);
    setAgentOrder(planets.map((p) => p.address));
    const W = this.size?.width ?? 1240;
    const H = this.size?.height ?? 420;
    this.galaxies = galaxies.length;
    this.pos = {};

    const n = galaxies.length;
    galaxies.forEach((g, i) => {
      g.cx = (i - (n - 1) / 2) * GAP;
    });
    const ox = Math.round(W / 2 + this.pan.x);
    const oy = Math.round(H / 2 + this.pan.y);

    const nodes = [];
    for (const g of galaxies) nodes.push(...this.drawGalaxy(g, t, ox, oy));
    const pop = this.popup(t);

    return v_flex()
      .id("galaxy-root")
      .relative()
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .bg(C.space)
      .text_size(12)
      .on_size_change((size, cx) => {
        if (!this.size || Math.abs(this.size.width - size.width) > 0.5 || Math.abs(this.size.height - size.height) > 0.5) {
          this.size = { width: size.width, height: size.height };
          this.pan = this.clampPan(this.pan);
          cx.notify();
        }
      })
      .on_mouse_down("left", (e, _cx) => {
        this.ignoreClick = false;
        this.drag = { sx: e.position.x, sy: e.position.y, ox: this.pan.x, oy: this.pan.y, moved: false };
      })
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d) return;
        const dx = e.position.x - d.sx;
        const dy = e.position.y - d.sy;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
        d.moved = true;
        this.pan = this.clampPan({ x: d.ox + dx, y: d.oy + dy });
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.drag?.moved) this.ignoreClick = true;
        if (this.drag) {
          this.drag = null;
          cx.notify();
        }
      })
      .on_scroll_wheel((e, cx) => {
        const dx = typeof e.delta?.x === "number" ? e.delta.x : 0;
        const dy = typeof e.delta?.y === "number" ? e.delta.y : 0;
        if (!dx && !dy) return;
        this.pan = this.clampPan({ x: this.pan.x - dx * 40, y: this.pan.y - dy * 40 });
        cx.notify();
      })
      .children(this.starfield())
      .child(
        h_flex()
          .h(28)
          .flex_none()
          .px(12)
          .gap(10)
          .items_center()
          .child(div().text_size(10.5).font_semibold().text_color(C.muted).child("GALAXY"))
          .child(
            div()
              .text_size(10)
              .text_color(C.faint)
              .child(`${n} ${n === 1 ? "galaxy" : "galaxies"} \u00b7 ${planets.length} planets \u00b7 ${moons === 1 ? "1 moon" : `${moons} moons`}`),
          )
          .child(div().flex_1())
          .child(div().flex_none().text_size(10).text_color(C.faint).child("drag to pan \u00b7 click to focus"))
          .child(div().flex_none().text_size(10).text_color(C.faint).child("\u00b7"))
          .child(
            div()
              .id("galaxy-recenter")
              .flex_none()
              .text_size(10)
              .text_color(C.dim)
              .cursor_pointer()
              .hover((s) => s.text_color(C.name))
              .on_click((_e, cx) => {
                if (this.drag?.moved) return;
                this.pan = { x: 0, y: 0 };
                cx.notify();
              })
              .child("recenter"),
          ),
      )
      .children(nodes)
      .child(pop ?? div());
  }
}
