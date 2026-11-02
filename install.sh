#!/bin/sh
# Puts this repo's Herdr setup into the live app home (~/.config/herdr-app).
# Usage: sh install.sh          macOS / Linux / WSL / git-bash
#        zsh install.sh
# Then pick the layout: herdr-app do layout.switch --name herdr-t3
#
# - copies our layouts and mods, skipping `galaxy` (backup only)
# - clones the third-party herdr-t3 layout + mods, then applies patches/
# - adds our two keys to keys.json, leaving every other key alone
# Env: HERDR_APP_HOME (default ~/.config/herdr-app), HERDR_T3_REPO
set -eu

here=$(cd "$(dirname "$0")" && pwd)
app=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
t3=${HERDR_T3_REPO:-https://github.com/JinJieBeWater/herdr-t3}

[ -d "$app" ] || { echo "No Herdr home at $app - start Herdr once first." >&2; exit 1; }

mkdir -p "$app/layouts" "$app/mods"
cp "$here"/layouts/*.json "$here"/layouts/*.svg "$app/layouts/"

for dir in "$here"/mods/*/; do
  name=$(basename "$dir")
  [ "$name" = galaxy ] && continue
  rm -rf "${app:?}/mods/$name"
  cp -r "$dir" "$app/mods/$name"
  rm -f "$app/mods/$name/gpui-kit.d.ts" "$app/mods/$name/jsconfig.json"
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
git clone --depth 1 "$t3" "$tmp/t3" >/dev/null 2>&1 ||
  { echo "Could not clone $t3" >&2; exit 1; }
cp "$tmp/t3/layouts/herdr-t3.json" "$tmp/t3/layouts/herdr-t3.svg" "$app/layouts/"
for dir in "$tmp"/t3/mods/t3-*/; do
  name=$(basename "$dir")
  rm -rf "${app:?}/mods/$name"
  cp -r "$dir" "$app/mods/$name"
done

# Our changes on top of the third-party mods: my-brand in the brand bar, the
# OpenCode limits chip inside the t3 tab bar.
cp "$here/patches/herdr-t3.json" "$app/layouts/herdr-t3.json"
cp "$here/patches/t3-tabs-main.js" "$app/mods/t3-tabs/main.js"
cp "$here/patches/t3-tabs-oc-limits.js" "$app/mods/t3-tabs/oc-limits.js"

# Add our keys; cmd-shift-b is deliberately absent (it stays layout.toggle:sidebar).
node -e '
const fs = require("fs"), p = process.argv[1];
const keys = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
keys["layout:herdr-t3"] = { "cmd-shift-a": "t3-tabs.view", "cmd-shift-s": "t3-focus.settle" };
fs.writeFileSync(p, JSON.stringify(keys, null, 2));
' "$app/keys.json"

if command -v herdr-app >/dev/null 2>&1; then
  for name in my-brand my-oc-limits agents-canvas t3-tabs t3-chrome t3-spaces t3-agents t3-focus t3-pane t3-new-menu; do
    herdr-app check "$app/mods/$name" || echo "check failed: $name" >&2
  done
  herdr-app do layout.switch --name herdr-t3 >/dev/null && echo "Showing herdr-t3."
else
  echo "herdr-app not on PATH - open Herdr and pick the herdr-t3 layout."
fi
