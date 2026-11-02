// The OpenCode limits chip, split out of my-tabs so layouts with another tab bar
// (herdr-t3) can carry it: the chip shows the worst plan window, a click opens the
// per-plan popover. Data comes from `opencode api experimental.usage.limits`,
// polled once a minute (opencode is an npm shim on Windows, so through cmd.exe).

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, openOverlay, props, theme } from "herdr";

const PLANS = ["free", "go", "zen"];
const PLAN_LABELS = { free: "Free", go: "Go", zen: "Zen" };
const BAR_W = 190;

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

function globalWorst(limits) {
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

function severityColor(cx) {
  const t = theme();
  if (cx?.limited || cx?.percent >= 80) return t.blocked;
  if (cx?.percent >= 50) return t.working;
  return t.done;
}

function relTime(ms) {
  const d = ms - Date.now();
  if (d <= 0) return "now";
  const mins = Math.round(d / 60000);
  if (mins >= 2880) return Math.round(mins / 1440) + "d";
  if (mins >= 120) return Math.round(mins / 60) + "h";
  return mins + "m";
}

export default class OcLimits extends View {
  init(_props, cx) {
    this.limits = null;
    this.worst = null;
    // Opened from the t3-tabs chip: it already polled, so draw what it handed over.
    const given = (props() ?? {}).limits;
    if (given) {
      this.limits = given;
      this.worst = globalWorst(given);
      return;
    }
    cx.timer.every(60000, (cx) => this.refreshLimits(cx));
    this.refreshLimits(cx);
  }

  refreshLimits(cx) {
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

  limitsDialog(t) {
    const ws = this.limits?.workspace;
    const plans = PLANS.map((name) => ({ name, plan: this.limits?.[name] })).filter((p) => p.plan);
    const kids = [
      h_flex().id("oc-head").justify_between().items_center().children([
        div().text_size(14).font_semibold().text_color(t.foreground).child("OpenCode limits"),
        div().text_size(12).text_color(t.muted).child(ws ? ws.name : ""),
      ]),
    ];
    if (!plans.length) {
      kids.push(div().text_size(12).text_color(t.muted).child("No plan data"));
    } else {
      for (const p of plans) kids.push(this.limitsPlan(t, p.name, p.plan));
    }
    kids.push(
      h_flex().id("oc-foot").justify_between().items_center().children([
        ws
          ? div().id("oc-link-console").text_size(12).text_color(t.accent)
              .hover((s) => s.text_color(t.foreground))
              .child("activity console")
              .on_click(() => ws.usageURL && exec("rundll32", ["url.dll,FileProtocolHandler", ws.usageURL]))
          : div(),
        div().id("oc-link-refresh").text_size(12).text_color(t.accent)
          .hover((s) => s.text_color(t.foreground))
          .child("refresh")
          .on_click((_e, cx) => this.refreshLimits(cx)),
      ])
    );
    return v_flex().id("oc-limits-dialog").size_full().p(14).gap(12).bg(t.popover).children(kids);
  }

  limitsPlan(t, name, plan) {
    const worst = planWorst(plan);
    const kids = [
      h_flex().id(`plan-${name}`).justify_between().children([
        div().id(`plan-label-${name}`).text_size(12.5).font_semibold().text_color(t.foreground).child(PLAN_LABELS[name] ?? name),
        worst
          ? div().id(`plan-badge-${name}`).text_size(12).text_color(severityColor(worst))
              .child(worst.limited ? `limited — resets ${relTime(worst.resetsAt)}` : `${Math.round(100 - worst.percent)}% free`)
          : div(),
      ]),
    ];
    kids.push(
      ...windowsOf(plan).map((w) => {
        const c = severityColor(w);
        return h_flex().id(`win-${name}-${w.window}`).gap(10).items_center().children([
          div().id(`win-name-${w.window}`).w(56).text_size(12).text_color(t.muted).child(w.window),
          h_flex().flex_1().h(6).rounded(3).bg(t.hover)
            .child(div().h(6).w(Math.round((w.percent * BAR_W) / 100)).rounded(3).bg(c)),
          div().w(36).text_size(12).text_color(c).child(w.percent + "%"),
          div().w(50).text_size(11).text_color(t.dim).child("↓" + relTime(w.resetsAt)),
        ]);
      })
    );
    return v_flex().id(`plan-${name}-sec`).gap(6).children(kids);
  }

  render() {
    return this.limitsDialog(theme());
  }
}
