// The canvas: one card per agent, its subagents as rows under the card.
// Hovering a card (or a subagent row) shows that terminal live in a popover;
// clicking it opens the terminal in a window: our bar on top, a grip on the
// right edge, bottom edge and corner. Herdr has no overlay resize call, so a
// size is a close and an open: a grip press hands the drag to the canvas's
// clock, which re-opens the window at the dragged size.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, terminals, run, theme, shared, setShared, props, layout, openOverlay, closeOverlay, settings } from "herdr";

const WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle" };
const CARD_W = 232;
const PV_W = 620;
const PV_H = 340;
const DEF = { w: 1000, h: 660 };
const MIN = { w: 380, h: 240 };

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}
const base = (p) => String(p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
const name = (a) => (a.title || "").replace(/^[^\p{L}\p{N}]+/u, "").trim() || a.program?.name || a.address;
const zoom = () => settings()?.zoom ?? 1;
// Where the app window is: the canvas sits at its origin and fills the rest.
const winSize = () => {
  const s = shared("agent.window.size");
  return s && s.w >= MIN.w && s.h >= MIN.h ? s : DEF;
};
const isFull = () => shared("agent.window.full") === true;

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// The terminal in a window: our bar above it. Same `key` every time, so the
// app keeps the spot it was dropped in across re-opens.
function openTerm(addr, w, h, at) {
  const part = (id, props, size) => ({ id, type: "block", size, content: { mod: "agents-canvas", props: { terminal: addr, ...props } } });
  return openOverlay({
    layout: {
      id: "termwin",
      type: "column",
      gap: 0,
      children: [
        part("bar", { bar: true }, { px: 30 }),
        {
          id: "mid",
          type: "row",
          children: [
            { id: "term", type: "block", size: { weight: 1 }, content: { terminal: addr } },
            part("grip-r", { grip: "right" }, { px: 22 }),
          ],
        },
        {
          id: "foot",
          type: "row",
          size: { px: 18 },
          children: [part("grip-b", { grip: "bottom" }, { weight: 1 }), part("grip-c", { grip: "corner" }, { px: 26 })],
        },
      ],
    },
    kind: "window",
    key: at ? `agent:${addr}:full` : `agent:${addr}`,
    width: w,
    height: h,
    ...(at ? { at } : {}),
  });
}

// The whole app window, from its top-left: a window is sized in pre-zoom px
// but placed in window px, so the size is divided by the zoom.
function openFull(addr) {
  // The whole window: `width` is in pre-zoom px, the place in window px.
  const v = window.viewport_size();
  return openTerm(addr, Math.round(v.width / zoom()), Math.round(v.height / zoom()), { x: 0, y: 0 });
}

export default class Canvas extends View {
  init(_props, cx) {
    this.size = null;
    this.origin = { x: 276, y: 42 }; // until the first pointer move says otherwise
    this.ptr = null;
    this.pv = null; // { addr, id }
    this.hot = null; // the grip the pointer is on
    this.out = 0; // close token
    this.in = 0; // open token
    const p = props() ?? {};
    if (p.bar || p.grip) return; // only the canvas keeps clocks
    for (const k of ["agent.window.hit", "agent.window.err", "agent.window.pos", "agent.window.down", "agent.window.log", "agent.window.vp", "agent.window.app", "agent.window.hot"])
      if (shared(k) != null) setShared(k, null);
    if (typeof shared("agent.window.size") !== "object") setShared("agent.window.size", null);
    cx.timer.every(1000, (cx) => cx.notify());
    cx.timer.every(40, () => this.dragging());
  }

  // --- preview and window -------------------------------------------------

  preview(addr) {
    if (this.pv?.addr === addr) return;
    this.closePreview();
    const s = this.size ?? { width: 1400, height: 800 };
    const p = this.ptr ?? { x: this.origin.x + s.width / 2, y: this.origin.y + 80 };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    const x = clamp(p.x + 26, this.origin.x + 8, this.origin.x + s.width - PV_W - 8);
    const y = clamp(p.y + 18, this.origin.y + 8, this.origin.y + s.height - PV_H - 8);
    const id = openOverlay({
      layout: {
        id: "preview",
        type: "column",
        children: [
          { id: "bar", type: "block", size: { px: 30 }, content: { mod: "peek", props: { terminal: addr } } },
          { id: "term", type: "block", size: { weight: 1 }, content: { terminal: addr } },
        ],
      },
      kind: "popup",
      frame: "none",
      width: PV_W,
      height: PV_H,
      at: { x, y },
    });
    this.pv = { addr, id };
  }

  closePreview() {
    if (this.pv) closeOverlay(this.pv.id);
    this.pv = null;
  }

  // Hover in shows, hover out hides after a short grace so a slide between
  // two rows doesn't flash the popover. The open waits a beat so the pointer
  // position from this same mouse event has landed.
  enter(addr, cx) {
    this.out = 0;
    if (this.pv?.addr === addr) return;
    const token = ++this.in;
    cx.timer.after(90, () => {
      if (this.in === token) this.preview(addr);
    });
  }

  leave(addr, cx) {
    this.in++; // drop a pending open
    const token = ++this.out;
    cx.timer.after(200, () => {
      if (this.out === token && this.pv?.addr === addr) this.closePreview();
    });
  }

  openWin(addr) {
    this.closePreview();
    if (isFull()) return openFull(addr);
    const s = winSize();
    openTerm(addr, s.w, s.h);
  }

  // The press that starts a drag is followed here: the grip it started on is
  // replaced by every re-open, so the clock, not the grip, follows the pointer.
  dragging() {
    const d = shared("agent.window.drag");
    if (!d) return;
    const p = window.mouse_position();
    const now = Date.now();
    const stopped = () => setShared("agent.window.drag", null);
    // A jump this big in one tick is not a drag: the button came up while the
    // pointer was ahead of the edge, and this is the pointer leaving.
    if (Math.abs(p.x - d.px) > 100 || Math.abs(p.y - d.py) > 100) return stopped();
    const w = Math.round(d.edge === "bottom" ? d.bw : Math.max(MIN.w, d.bw + (p.x - d.sx) / zoom()));
    const h = Math.round(d.edge === "right" ? d.bh : Math.max(MIN.h, d.bh + (p.y - d.sy) / zoom()));
    const changed = w !== d.w || h !== d.h;
    const up = shared("agent.window.up");
    if (up) {
      if (changed) {
        setShared("agent.window.size", { w, h });
        openTerm(d.addr, w, h);
      }
      setShared("agent.window.up", null);
      return stopped();
    }
    if (changed) {
      // One re-open per 55ms: a size is a close and an open, and a storm of them
      // makes the window lag the pointer instead of following it.
      if (now - d.last < 55) return;
      setShared("agent.window.size", { w, h });
      setShared("agent.window.drag", { ...d, w, h, px: p.x, py: p.y, t: now, last: now });
      openTerm(d.addr, w, h);
      return;
    }
    if (p.x !== d.px || p.y !== d.py) setShared("agent.window.drag", { ...d, px: p.x, py: p.y, t: now });
    else if (now - d.t > 600) stopped(); // no release reached us; the pointer rested
  }

  // --- the window's bar ---------------------------------------------------

  bar(t) {
    const p = props() ?? {};
    const addr = p.terminal;
    const a = agents().find((x) => x.address === addr);
    const term = terminals().find((x) => x.address === addr);
    const st = a?.status ?? term?.status ?? null;
    const title = a ? name(a) : term?.title || term?.name || addr;
    const pic = icon(a?.program ?? term?.program, 13, t.foreground);
    const canCanvas = Boolean(findNode(layout(), "view")?.children?.some((c) => c.id === "canvas"));
    const btn = (id, label, on) =>
      div()
        .id(id)
        .px(7)
        .py(2)
        .rounded(5)
        .text_size(11)
        .flex_none()
        .text_color(t.muted)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        // A press on a window overlay would drag it; stop that and act on press.
        .on_mouse_down("left", (_e, cx) => {
          cx.stop_propagation(); // a press would otherwise drag the window
          on();
        })
        .child(label);
    return h_flex()
      .id("term-bar")
      .size_full()
      .px(9)
      .gap(7)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .child(this.dot(t, st))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().truncate().font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(st), (el) =>
        el.child(div().text_size(10).flex_none().text_color(t[st] ?? t.dim).child(WORD[st] ?? st)),
      )
      .child(div().flex_1())
      .child(
        btn(
          "win-full",
          svg("mods/workspace-chrome/square.svg").size(12).flex_none().text_color(t.muted),
          () => toggleFull(addr, p.overlay),
        ),
      )
      .when(canCanvas, (el) =>
        el.child(
          btn("win-canvas", "canvas", () => {
            closeOverlay(p.overlay);
            run("layout.select", { stack: "view", child: "canvas" });
          }),
        ),
      )
      .child(btn("win-close", svg("mods/pane/close.svg").size(12).flex_none().text_color(t.muted), () => closeOverlay(p.overlay)));
  }

  // --- grips --------------------------------------------------------------

  // The grips are blocks of their own in the window's layout, so the terminal
  // keeps every pixel inside them. A press records, the release resizes.
  grip(t, edge) {
    return div()
      .id(`grip-${edge}`)
      .size_full()
      .bg(this.hot === edge ? t.border : t.chrome) // painted, or nothing to hit-test
      .on_hover((h, cx) => {
        if ((this.hot === edge) === h) return;
        this.hot = h ? edge : null;
        cx.notify();
      })
      .when(edge !== "bottom", (el) => el.cursor_col_resize())
      .when(edge !== "right", (el) => el.cursor_row_resize())
      // The release lands on whichever grip is under the pointer by then, which
      // is why it is the drag that ends, not the grip that started it.
      .on_mouse_up("left", () => setShared("agent.window.up", Date.now()))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation(); // otherwise the press drags the window
        if (isFull()) return; // a full screen window has nothing to grow into
        const s = winSize();
        setShared("agent.window.drag", {
          addr: props()?.terminal,
          edge,
          sx: e.position.x, // the anchor the whole drag is measured from
          sy: e.position.y,
          bw: s.w,
          bh: s.h,
          w: s.w,
          h: s.h,
          px: e.position.x,
          py: e.position.y,
          t: Date.now(),
          last: 0,
        });
      });
  }

  // --- data ---------------------------------------------------------------

  tree() {
    const all = terminals();
    const parentOf = new Map(all.map((t) => [t.address, t.parent ?? null]));
    const kids = new Map();
    for (const t of all) if (t.parent) kids.set(t.parent, [...(kids.get(t.parent) ?? []), t]);
    const cards = agents().filter((a) => !parentOf.get(a.address));
    return { cards, kids };
  }

  // --- pieces -------------------------------------------------------------

  dot(t, status) {
    return div().size(7).rounded_full().flex_none().bg(t[status] ?? t.dim);
  }

  row(t, { addr, title, status, sub }) {
    const hovering = this.pv?.addr === addr;
    return h_flex()
      .id(`row-${addr}`)
      .w_full()
      .gap(6)
      .items_center()
      .px(6)
      .py(3)
      .rounded(5)
      .when(hovering, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => (on ? this.enter(addr, cx) : this.leave(addr, cx)))
      .on_click((_e, _cx) => this.openWin(addr))
      .child(div().flex_none().text_color(t.dim).child(sub ? "└" : ""))
      .child(this.dot(t, status))
      .child(div().text_size(11).truncate().text_color(t.muted).child(title))
      .child(div().flex_1())
      .child(div().text_size(10).flex_none().text_color(t[status] ?? t.dim).child(WORD[status] ?? status ?? ""));
  }

  card(t, a, kids) {
    const pic = icon(a.program, 14, t.foreground);
    const hovering = this.pv?.addr === a.address;
    const where = [a.space_name, a.tab_name].filter((x) => x && x !== a.address).join(" · ");
    return v_flex()
      .id(`card-${a.address}`)
      .w(CARD_W)
      .min_w(CARD_W)
      .flex_none()
      .rounded(10)
      .overflow_hidden()
      .bg(t.surface)
      .border(1)
      .border_color(hovering || a.focused ? t.accent : t.border)
      .gap(2)
      .p(2)
      .child(
        v_flex()
          .id(`head-${a.address}`)
          .w_full()
          .gap(3)
          .px(7)
          .py(6)
          .rounded(8)
          .hover((s) => s.bg(t.hover))
          .on_hover((on, cx) => (on ? this.enter(a.address, cx) : this.leave(a.address, cx)))
          .on_click((_e, _cx) => this.openWin(a.address))
          .child(
            h_flex()
              .w_full()
              .gap(7)
              .items_center()
              .child(this.dot(t, a.status))
              .when(Boolean(pic), (el) => el.child(pic))
              .child(div().flex_1().text_size(12).font_semibold().truncate().text_color(t.foreground).child(name(a)))
              .child(div().text_size(10).flex_none().text_color(t[a.status] ?? t.dim).child(WORD[a.status] ?? a.status ?? "")),
          )
          .child(
            h_flex()
              .w_full()
              .gap(6)
              .items_center()
              .text_size(10)
              .text_color(t.dim)
              .child(div().flex_1().truncate().child(where || a.address)),
          ),
      )
      .when(kids.length > 0, (el) =>
        el.children(
          kids.map((k) =>
            this.row(t, {
              addr: k.address,
              title: k.title || k.name || k.template || k.address,
              status: agents().find((x) => x.address === k.address)?.status ?? k.status ?? null,
              sub: true,
            }),
          ),
        ),
      );
  }

  render(_cx) {
    const t = theme();
    const p = props() ?? {};
    if (p.bar) return this.bar(t);
    if (p.grip) return this.grip(t, p.grip);
    const { cards, kids } = this.tree();

    return v_flex()
      .id("agents-canvas")
      .size_full()
      .bg(t.canvas)
      .p(16)
      // A press here means the window behind is not being dragged after all.
      .on_mouse_down("left", () => setShared("agent.window.drag", null))
      .on_size_change((size, _cx) => (this.size = size))
      .on_mouse_move((e, _cx) => {
        this.ptr = e.position;
        // No bounds while the element is unpainted, but the pointer's window and
        // local positions give the origin just as well.
        const o =
          e.bounds?.origin ??
          (e.local_position ? { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y } : null);
        if (o) this.origin = { x: o.x, y: o.y };
      })
      .child(
        h_flex()
          .w_full()
          .gap(14)
          .items_start()
          .flex_wrap()
          .when(cards.length === 0, (el) =>
            el.child(div().text_size(12).text_color(t.dim).child("No agents running.")),
          )
          .children(cards.map((a) => this.card(t, a, kids.get(a.address) ?? []))),
      );
  }
}

// The bar's square: the whole window, or back to the size it was.
function toggleFull(addr, overlay) {
  const full = !isFull();
  setShared("agent.window.full", full);
  closeOverlay(overlay);
  const s = winSize();
  if (full) return openFull(addr);
  openTerm(addr, s.w, s.h);
}
