# my-herd

Our customizations of the [Herdr](https://herdr.app) desktop app: layouts,
mods, keys. The live app reads `~/.config/herdr-app/`; this repo holds copies.

## Install everything from scratch

```sh
git clone https://github.com/Vr3n/vOs && cd vOs
sh install.sh                 # bash, zsh, WSL or git-bash
```

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Either script copies our layouts and mods into the Herdr home, clones the
third-party `herdr-t3` layout (JinJieBeWater/herdr-t3) for its `t3-*` mods and
lays our `patches/` over it, adds the `layout:herdr-t3` keys without touching
the rest of `keys.json`, runs `herdr-app check`, then shows `herdr-t3`.
Start Herdr once before running so the home folder exists.

Layouts: `herdr-t3` (T3 shell with our Vr3n brand and the OpenCode limits chip),
`vr3n-os`, `my-galaxy` (kept as a backup; its `galaxy` mod is not installed).

## Notes

- `~/codes/my-herd/AGENTS.md` — how we work here; read
  `~/.config/herdr-app/AGENTS.md` for the app's own surface.
- `patches/` — copies of files that live inside the third-party `t3-*` mods, so
  an update of those mods can be re-patched.
- `CHANGELOG.md` — one entry per session.
