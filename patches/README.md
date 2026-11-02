Copies of files that live in third-party mods (herdr-t3), so a reinstall or
update of those mods can be re-patched from here:

- `t3-tabs-main.js` — has the 3 lines that add the OpenCode chip (import,
  `new LimitsChip(cx)` in `init`, `.child(this.limits.render(t))` before the
  `+` button).
- `t3-tabs-oc-limits.js` — the chip itself, copied in as `mods/t3-tabs/oc-limits.js`.
- `herdr-t3.json` — the installed layout (`brand` block → `my-brand`, 73px).
