// The canvas: one card per agent, its subagents as rows under the card.
// Hovering a card (or a subagent row) shows that terminal live in a popover.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, terminals, run, theme, openOverlay, closeOverlay } from "herdr";

const WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle" };
const CARD_W = 232;
const PV_W = 620;
const PV_H = 340;

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}
const base = (p) => String(p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
const name = (a) => (a.title || "").replace(/^[^\p{L}\p{N}]+/u, "").trim() || a.program?.name || a.address;

export default class Canvas extends View {
  init(_props, cx) {
    this.size = null;
    this.origin = { x: 276, y: 42 }; // until the first pointer move says otherwise
    this.ptr = null;
    this.pv = null; // { addr, id }
    this.out = 0; // close token
    this.in = 0; // open token
    cx.timer.every(1000, (cx) => cx.notify());
  }

  // --- preview ------------------------------------------------------------

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

  row(t, { addr, title, status, program, sub }) {
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
      .on_click((_e, _cx) => {
        run("agent.focus", { terminal: addr });
        this.closePreview();
      })
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
          .on_click((_e, _cx) => {
            run("agent.focus", { terminal: a.address });
            run("layout.select", { stack: "view", child: "agent" });
            this.closePreview();
          })
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
      .when(kids.length > 0, (el) => el.children(kids.map((k) => this.row(t, {
        addr: k.address,
        title: k.title || k.name || k.template || k.address,
        status: agents().find((x) => x.address === k.address)?.status ?? k.status ?? null,
        sub: true,
      }))));
  }

  render(_cx) {
    const t = theme();
    const { cards, kids } = this.tree();
    return v_flex()
      .id("agents-canvas")
      .size_full()
      .bg(t.canvas)
      .p(16)
      .on_size_change((size, _cx) => (this.size = size))
      .on_mouse_move((e, _cx) => {
        this.ptr = e.position;
        const o = e.bounds?.origin;
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
