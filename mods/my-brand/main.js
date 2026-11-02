// The sidebar's brand (cloned from the shipped workspace-chrome): "Vr3n"
// instead of Herdr's title, with live CPU / RAM / GPU rings below it.
// The values come from stats.vbs, which reads Windows' own performance
// classes once per refresh through WMI (no background process, no setTimeout).

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, window, shared, setShared, layout, exec, appHome } from "herdr";

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

// The rings are lean 30px gauges with thin (~2px) arcs. Arcs are SVG masks,
// one per 5% step; the number stays exact. Metric colors: CPU purple, RAM
// light orange, GPU keeps its theme color. Above 70% the arc blends into a
// light red across the top of the sweep: the base stays whole, and one
// butt-ended slice per 5% step (`seg-*.svg`) layers on top, each mixed a
// step further into the red.
const BUCKET = (v) => Math.max(0, Math.min(100, Math.round(v / 5) * 5));
const arc = (v) => `mods/my-brand/rings/arc-${BUCKET(v)}.svg`;

const RING = 30;          // gauge size, px (was 44); brand block needs 6+26+5+30+6 = 73px
const ABOVE = 70;         // the red blend starts past this
const HOT = "#f87171";    // light red the arc blends into
const CPU_COLOR = "#a78bfa";
const RAM_COLOR = "#fdba74";

// Blend two "#rrggbb" colors; tolerates "#rgb".
const hex6 = (c) => (c.length === 4 ? "#" + [...c.slice(1)].map((ch) => ch + ch).join("") : c);
const mix = (a, b, t) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

const REFRESH_MS = 5000;

export default class MyBrand extends View {
  init(_props, cx) {
    this.stats = { cpu: null, ram: null, gpu: null };
    this.busy = false;
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("cscript", ["//nologo", `${appHome()}/mods/my-brand/stats.vbs`]);
        const [cpu, ram, gpu] = r.stdout.trim().split("|").map(Number);
        const ok = (v) => Number.isFinite(v) && v >= 0 ? v : null;
        this.stats = { cpu: ok(cpu), ram: ok(ram), gpu: ok(gpu) };
      } catch {
        this.stats = { cpu: null, ram: null, gpu: null };
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }

  ring(id, label, value, color) {
    const t = theme();
    const pct = value == null ? null : Math.round(value);
    const tick = pct == null ? "—" : String(pct);
    const tooltip = `${label} ${pct == null ? "not available" : `${pct}%`}`;
    const hot = pct != null && pct > ABOVE;
    const metric = color == null ? null : hex6(color);
    const gauge = div().w(RING).h(RING).flex_none()
      .child(svg("mods/my-brand/rings/track.svg").absolute().top(0).left(0).size(RING).text_color(t.border))
      .child(svg(arc(hot ? ABOVE : (pct ?? 0))).absolute().top(0).left(0).size(RING)
        .text_color(pct == null ? t.dim : metric));
    // Past the threshold the metric-colored base stops at 70% and the slices
    // above it blend metric -> light red, one 5% band at a time.
    if (hot && metric) {
      const to = BUCKET(pct);
      for (let from = ABOVE; from < to; from += 5) {
        const step = (from - ABOVE) / 5;            // 0..5
        const frac = 0.15 + 0.85 * (step / 5);      // eases into full red by 100%
        gauge.child(svg(`mods/my-brand/rings/seg-${from}-${from + 5}.svg`)
          .absolute().top(0).left(0).size(RING).text_color(mix(metric, HOT, frac)));
      }
    }
    return h_flex().id(id).gap(5).items_center().tooltip(tooltip)
      .child(div().text_size(9).text_color(t.dim).child(label))
      .child(gauge
        .child(div().absolute().top(0).left(0).right(0).bottom(0).flex().items_center().justify_center()
          .text_size(9).font_semibold().text_color(pct == null ? t.dim : t.foreground).child(tick)));
  }

  render(cx) {
    const t = theme();
    const collapsed = narrow();
    const s = this.stats;
    return v_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).pt(6).pb(6).gap(5)
      .child(h_flex().w_full().gap(4).items_center()
        .when(window()?.platform === "macos" && !collapsed, el => el.pl(76))
        .when(!collapsed, el => el.child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Vr3n")))
        .when(collapsed, el => el.child(div().flex_1()))
        .when(!collapsed, el => el.child(this.button("search", svg("mods/my-brand/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
        // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
        .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/my-brand/sidebar.svg").size(15), toggleSidebar))))
      .when(!collapsed, el => el.child(h_flex().w_full().justify_between().items_center()
        .child(this.ring("gauge-cpu", "CPU", s.cpu, CPU_COLOR))
        .child(this.ring("gauge-ram", "RAM", s.ram, RAM_COLOR))
        .child(this.ring("gauge-gpu", "GPU", s.gpu, t.done))));
  }
}
