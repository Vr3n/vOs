import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, openOverlay, closeOverlay, props } from "herdr";

// OpenCode plan tiers, in show order. The limits API returns a block per
// plan this account has (`go` today; `free` / `zen` when they apply).
const PLANS = ["free", "go", "zen"];
const PLAN_LABELS = { free: "Free", go: "Go", zen: "Zen" };
const BAR_W = 190; // px of the detail-dialog fill bar at 100%

function refresh(cx) {
  cx.spawn(async (cx) => {
    try {
      // opencode resolves to npm .cmd/.ps1 shims on Windows: spawn the shim.
      const r = await exec(
        "cmd.exe",
        ["/c", "opencode", "api", "experimental.usage.limits"]
      );
      const j = JSON.parse(String(r.stdout).trim());
      this.data = j.data ?? j;
      this.err = null;
    } catch (e) {
      this.err = String(e);
    }
    cx.notify();
  });
}

function windowsOf(plan) {
  return ["rolling", "weekly", "monthly"]
    .filter((w) => plan && plan[w])
    .map((w) => ({ window: w, ...plan[w] }));
}

function worstOf(plan) {
  const wins = windowsOf(plan);
  if (!wins.length) return null;
  return wins.reduce((acc, w) =>
    (acc && !acc.limited && acc.percent >= w.percent && !(acc.limited && !w.limited)) ? acc : w
  );
}

function color(cx) {
  const t = theme();
  if (cx.limited || cx.percent >= 80) return t.blocked;
  if (cx.percent >= 50) return t.working;
  return t.done;
}

function rel(ms) {
  const d = ms - Date.now();
  if (d <= 0) return "now";
  const mins = Math.round(d / 60000);
  if (mins >= 2880) return Math.round(mins / 1440) + "d";
  if (mins >= 120) return Math.round(mins / 60) + "h";
  return mins + "m";
}

export default class OcLimits extends View {
  init(_props, cx) {
    this.data = null;
    this.err = null;
    // Data polling only (60 s): overkill for the button, right pace on click.
    cx.timer.every(60000, (cx) => refresh.call(this, cx));
    refresh.call(this, cx);
  }

  render(cx) {
    const t = theme();
    if ((props() ?? {}).detail) return this.dialog(t);
    return this.button(t);
  }

  /* Compact top-bar button: the worst clock across every plan present. */
  button(t) {
    const plans = PLANS.map((name) => ({
      name,
      worst: worstOf(this.data ? this.data[name] : null),
    })).filter((p) => p.worst);
    let worst = null;
    let worstPlan = "";
    for (const p of plans) {
      if (!worst || p.worst.percent > worst.percent) {
        worst = p.worst;
        worstPlan = p.name;
      }
    }
    const c = color(worst ?? { percent: 0 });
    const label = worst
      ? `${PLAN_LABELS[worstPlan] ?? worstPlan} ${worst.percent}%`
      : this.err
        ? "limits ?"
        : "limits …";
    /* Chip styled exactly like tabs mod's Files/Changes panel buttons
       (h 26, px 8, gap 5, rounded 6, chrome bg, tinted 14px svg icon);
       the strip paints chrome + border_b so the bar continues seamlessly. */
    return h_flex()
      .id("oc-limits-bar")
      .size_full()
      .items_center()
      .justify_end()
      .pr(6)
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .id("oc-limits-btn")
          .h(26)
          .px(8)
          .gap(5)
          .items_center()
          .rounded(6)
          .text_size(12)
          .bg(t.chrome)
          .hover((s) => s.bg(t.hover))
          .on_click(() =>
            openOverlay({
              mod: "oc-limits",
              props: { detail: true },
              kind: "popup",
              at: "pointer",
              width: 320,
            })
          )
          .child(svg("icons/opencode.svg").size(14).text_color(c))
          .child(div().text_size(12).text_color(c).child(label))
      );
  }

  /* Detail dialog: one section per plan, one row per window. */
  dialog(t) {
    const ws = this.data ? this.data.workspace : null;
    const plans = PLANS.map((name) => ({
      name,
      plan: this.data ? this.data[name] : null,
    })).filter((p) => p.plan);

    const kids = [
      h_flex()
        .id("head")
        .justify_between()
        .items_center()
        .children([
          div().text_size(14).font_semibold().text_color(t.foreground).child("OpenCode limits"),
          div().text_size(12).text_color(t.muted).child(ws ? ws.name : ""),
        ]),
    ];

    if (this.err) {
      kids.push(
        h_flex()
          .id("errrow")
          .items_center()
          .children([
            div().text_size(12).text_color(t.muted).child(this.err.slice(0, 220)),
            this.link(t, "retry", (e, cx) => refresh.call(this, cx)),
          ])
      );
    } else if (!plans.length) {
      kids.push(div().text_size(12).text_color(t.muted).child("No plan data"));
    } else {
      for (const p of plans) kids.push(this.planSection(t, p.name, p.plan));
    }

    kids.push(
      h_flex()
        .id("foot")
        .justify_between()
        .items_center()
        .children([
          ws ? this.link(t, "activity console", () => this.openURL(ws.usageURL)) : div(),
          this.link(t, "refresh", (e, cx) => refresh.call(this, cx)),
        ])
    );

    return v_flex()
      .id("oc-limits-dialog")
      .size_full()
      .p(14)
      .gap(12)
      .bg(t.popover)
      .children(kids);
  }

  planSection(t, name, plan) {
    const worst = worstOf(plan);
    const kids = [
      h_flex()
        .id(`plan-${name}`)
        .justify_between()
        .children([
          div()
            .id(`plan-label-${name}`)
            .text_size(12.5)
            .font_semibold()
            .text_color(t.foreground)
            .child(PLAN_LABELS[name] ?? name),
          worst
            ? div()
                .id(`plan-bad-${name}`)
                .text_size(12)
                .text_color(color(worst))
                .child(
                  worst.limited
                    ? "limited — resets " + rel(worst.resetsAt)
                    : `${Math.round(100 - worst.percent)}% free`
                )
            : div(),
        ]),
    ];
    kids.push(
      ...windowsOf(plan).map((w) => {
        const c = color(w);
        return h_flex()
          .id(`w-${name}-${w.window}`)
          .gap(10)
          .items_center()
          .children([
            div()
              .id(`wn-${w.window}`)
              .w(56)
              .text_size(12)
              .text_color(t.muted)
              .child(w.window),
            h_flex()
              .flex_1()
              .h(6)
              .rounded(3)
              .bg(t.hover)
              .child(div().h(6).w(Math.round((w.percent * BAR_W) / 100)).rounded(3).bg(c)),
            div().w(36).text_size(12).text_color(c).child(w.percent + "%"),
            div().w(52).text_size(11).text_color(t.dim).child("↓" + rel(w.resetsAt)),
          ]);
      })
    );
    return v_flex().id(`plan-${name}-sec`).gap(6).children(kids);
  }

  link(t, label, fn) {
    return div()
      .id("lk-" + label)
      .text_size(12)
      .text_color(t.accent)
      .hover((s) => s.text_color(t.foreground))
      .child(label)
      .on_click(fn);
  }

  openURL(url) {
    if (!url) return;
    exec("rundll32", ["url.dll,FileProtocolHandler", url]);
  }
}
