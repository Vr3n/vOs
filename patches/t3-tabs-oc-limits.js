// OpenCode limits chip, drawn inside the t3 tab bar before the "+" button.
// Data: `opencode api experimental.usage.limits`, once a minute (opencode is an
// npm shim on Windows, so through cmd.exe). The click opens the my-oc-limits popover.
// Kept in its own file so a t3-tabs update only needs this file plus one call site.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, openOverlay, theme } from "herdr";

const PLAN_LABELS = { free: "Free", go: "Go", zen: "Zen" };

function windowsOf(plan) {
  return ["rolling", "weekly", "monthly"]
    .filter((w) => plan && plan[w])
    .map((w) => ({ window: w, ...plan[w] }));
}

function planWorst(plan) {
  const wins = windowsOf(plan);
  if (!wins.length) return null;
  return wins.reduce((acc, w) =>
    ((w.limited || w.percent > acc.percent) && !(acc.limited && !w.limited)) ? w : acc
  );
}

export function globalWorst(limits) {
  let out = null;
  for (const [name, plan] of Object.entries(limits ?? {})) {
    if (!PLAN_LABELS[name]) continue;
    const w = planWorst(plan);
    if (w && (!out || w.percent > out.percent || (w.limited && !out.limited))) {
      out = { ...w, planLabel: PLAN_LABELS[name] };
    }
  }
  return out;
}

export function severityColor(cx) {
  const t = theme();
  if (cx?.limited || cx?.percent >= 80) return t.blocked;
  if (cx?.percent >= 50) return t.working;
  return t.done;
}

export class LimitsChip {
  constructor(cx) {
    this.limits = null;
    this.worst = null;
    cx.timer.every(60000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("cmd.exe", ["/c", "opencode", "api", "experimental.usage.limits"]);
        this.limits = (JSON.parse(String(r.stdout).trim())).data ?? null;
        this.worst = globalWorst(this.limits);
      } catch {
        this.limits = null;
        this.worst = null;
      }
      cx.notify();
    });
  }

  render(t) {
    const worst = this.worst;
    const c = severityColor(worst);
    return h_flex()
      .id("oc-limits-btn")
      .h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).text_color(c)
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() =>
        openOverlay({ mod: "my-oc-limits", props: { detail: true, limits: this.limits }, kind: "popup", at: "pointer", width: 320 })
      )
      .child(svg("icons/opencode.svg").size(14).text_color(c))
      .child(div().flex_none().child(worst ? `${worst.planLabel} ${worst.percent}%` : "…"));
  }
}
