// Our notification center — a floating stack over the window's bottom-right
// corner. The shipped `toast` mod keeps drawing app-posted notifications
// (notify()); our richer surface serves posts from our own mods, which put
// them on the shared `notifs` bus:
//
//   setShared("notifs", [{ id, level, title, body, action?, ttl?, postedAt }, ...])
//
// Fields: level info|success|warning|error, action {label, name, args} runs
// when the card is clicked, ttl ms to auto-dismiss (0/undefined uses the
// level default; errors stay), postedAt Date.now() at post time. Newest first.
// Hovering the stack pauses expiry (Apple's "keep open while hovered").

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { shared, setShared, run, theme, placement } from "herdr";

// Level defaults (ms): matches HIG advice — short for low priority, longer
// for urgent-but-transient, none for errors until the person acts.
const TTL = { info: 5000, success: 4000, warning: 8000 };
const SEV = { info: "accent", success: "done", warning: "working", error: "blocked" };
const GLYPH = { info: "i", success: "✓", warning: "!", error: "!" };
const MAX_SHOWN = 4;
const CARD_W = 340;

export default class NotifyStack extends View {
  init(_props, cx) {
    // Slow data check only: expiry sweep. Hover state decides, so activity
    // on the stack itself never costs a redraw.
    cx.timer.every(1000, (cx) => this.sweep(cx));

    // One-time cleanup of the temporary test seed (paused work, 2026-10-30):
    // drop any fake `seed-*` notes so nothing misleading stays on screen.
    if (!globalThis.__notifSeedCleared) {
      globalThis.__notifSeedCleared = true;
      const q = shared("notifs");
      if (Array.isArray(q) && q.some((n) => String(n?.id).startsWith("seed-"))) {
        setShared(
          "notifs",
          q.filter((n) => !String(n?.id).startsWith("seed-"))
        );
      }
    }
  }

  // Auto-dismiss per level unless hovered. Only writes shared state when
  // something actually expired.
  sweep(_cx) {
    const q = shared("notifs");
    if (!Array.isArray(q) || !q.length) return;
    if (placement()?.hovered) return; // pointer on the stack: keep everything
    const now = Date.now();
    const keep = q.filter((n) => {
      const ttl = Number(n.ttl ?? TTL[n?.level] ?? 0);
      return !ttl || now - n.postedAt < ttl;
    });
    if (keep.length !== q.length) setShared("notifs", keep);
  }

  dismiss(id) {
    const q = (shared("notifs") ?? []).filter((n) => n.id !== id);
    setShared("notifs", q);
  }

  activate(n) {
    if (n?.action?.name) run(n.action.name, n.action.args ?? {});
    this.dismiss(n.id);
  }

  render(cx) {
    const q = shared("notifs");
    if (!Array.isArray(q) || !q.length) return div();
    const t = theme();
    const shown = q.slice(0, MAX_SHOWN);
    const more = q.length - shown.length;

    return v_flex()
      .id("notifs-root")
      .w(CARD_W)
      .gap(6)
      .children([
        ...shown.map((n) => this.card(t, n)),
        more > 0 ? this.more(t, more) : div(),
      ]);
  }

  card(t, n) {
    const sev = SEV[n.level] ?? "accent";
    const c = t[sev];
    const stop = (_e, cx) => cx.stop_propagation();
    return h_flex()
      .id(`note-${n.id}`)
      .items_center()
      .gap(10)
      .p(11)
      .rounded(10)
      .bg(t.popover)
      .border(1)
      .border_color(t.border)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.activate(n))
      .children([
        // Severity chip: tinted circle, glyph in the level color.
        div()
          .id(`note-${n.id}-chip`)
          .size(28)
          .rounded(14)
          .flex_none()
          .items_center()
          .justify_center()
          .bg(c + "22")
          .child(
            n.icon
              ? image(n.icon).w(15).h(15)
              : div().id(`note-${n.id}-glyph`).text_size(14).font_semibold().text_color(c).child(GLYPH[n.level] ?? "i")
          ),
        v_flex()
          .flex_1()
          .gap(3)
          .children([
            div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(n.title ?? ""),
            n.body
              ? div().truncate().text_size(12).text_color(t.muted).child(n.body)
              : div(),
            n.action?.name
              ? div()
                  .id(`note-${n.id}-action`)
                  .text_size(12)
                  .font_semibold()
                  .text_color(t.accent)
                  .child(n.action.label ?? n.action.name)
              : div(),
          ]),
        div()
          .id(`note-${n.id}-close`)
          .size(22)
          .flex_none()
          .items_center()
          .justify_center()
          .rounded(6)
          .text_size(12)
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click(() => this.dismiss(n.id))
          .child("✕"),
      ]);
  }

  more(t, count) {
    return h_flex()
      .id("notifs-more")
      .justify_center()
      .py(3)
      .rounded(8)
      .text_size(11)
      .text_color(t.dim)
      .child(`+${count} earlier`);
  }
}
