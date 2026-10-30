import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, spaces, panes, run, openOverlay, props, theme, window, shared, layout, settings } from "herdr";

// OpenCode limits chip: data + helpers (plan tiers the account has).
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


function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(props, cx) {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.limits = null;
    this.worst = null;
    // OpenCode limits: gentle data polling, chip redraws on cx.notify().
    cx.timer.every(60000, (cx) => this.refreshLimits(cx));
    this.refreshLimits(cx);
  }

  refreshLimits(cx) {
    cx.spawn(async (cx) => {
      // opencode is an npm .cmd/.ps1 shim on Windows: spawn through the shim.
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

  limitsChip(t) {
    const worst = this.worst;
    const c = severityColor(worst);
    const stop = (_e, cx) => cx.stop_propagation();
    return h_flex()
      .id("oc-limits-btn")
      .h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(t.chrome).text_color(c)
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", stop)
      .on_click(() =>
        openOverlay({ mod: "my-tabs", props: { detail: true }, kind: "popup", at: "pointer", width: 320 })
      )
      .child(svg("icons/opencode.svg").size(14).text_color(c))
      .child(worst ? `${worst.planLabel} ${worst.percent}%` : "…");
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

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    if ((props() ?? {}).detail) return this.limitsDialog(t);
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }))
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(this.limitsChip(t))
      .when(window()?.buttons, el => el.child(button("minimize", "−", () => run("window.minimize")))
        .child(button("maximize", "□", () => run("window.maximize")))
        .child(button("close-window", svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
