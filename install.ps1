# Puts this repo's Herdr setup into the live app home (~/.config/herdr-app).
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1
# Then pick the layout: herdr-app do layout.switch '{"name":"herdr-t3"}'
#
# - copies our layouts and mods, skipping `galaxy` (backup only)
# - clones the third-party herdr-t3 layout + mods, then applies patches/
# - adds our two keys to keys.json, leaving every other key alone
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path -ErrorAction SilentlyContinue
if (-not $here) { $here = (Get-Location).Path }
$app = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config\herdr-app' }
$t3 = if ($env:HERDR_T3_REPO) { $env:HERDR_T3_REPO } else { 'https://github.com/JinJieBeWater/herdr-t3' }

if (-not (Test-Path $app)) { throw "No Herdr home at $app - start Herdr once first." }

New-Item -ItemType Directory -Force -Path (Join-Path $app 'layouts'), (Join-Path $app 'mods') | Out-Null
Copy-Item (Join-Path $here 'layouts\*') (Join-Path $app 'layouts') -Recurse -Force

Get-ChildItem (Join-Path $here 'mods') -Directory |
  Where-Object { $_.Name -ne 'galaxy' } |
  ForEach-Object {
    $dest = Join-Path $app ('mods\' + $_.Name)
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Copy-Item $_.FullName $dest -Recurse
    Remove-Item (Join-Path $dest 'gpui-kit.d.ts'), (Join-Path $dest 'jsconfig.json') -Force -ErrorAction SilentlyContinue
  }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('herdr-t3-' + [guid]::NewGuid().ToString('N'))
try {
  # git writes progress to stderr, which Stop turns into a terminating error.
  $ErrorActionPreference = 'Continue'
  git clone --depth 1 $t3 $tmp 2>&1 | Out-Null
  $cloneFailed = $LASTEXITCODE -ne 0
  $ErrorActionPreference = 'Stop'
  if ($cloneFailed) { throw "Could not clone $t3" }
  Copy-Item (Join-Path $tmp 'layouts\herdr-t3.json'), (Join-Path $tmp 'layouts\herdr-t3.svg') (Join-Path $app 'layouts') -Force
  Get-ChildItem (Join-Path $tmp 'mods') -Directory |
    Where-Object { $_.Name -like 't3-*' } |
    ForEach-Object {
      $dest = Join-Path $app ('mods\' + $_.Name)
      if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
      Copy-Item $_.FullName $dest -Recurse
    }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# Our changes on top of the third-party mods: my-brand in the brand bar, the
# OpenCode limits chip inside the t3 tab bar.
Copy-Item (Join-Path $here 'patches\herdr-t3.json') (Join-Path $app 'layouts\herdr-t3.json') -Force
Copy-Item (Join-Path $here 'patches\t3-tabs-main.js') (Join-Path $app 'mods\t3-tabs\main.js') -Force
Copy-Item (Join-Path $here 'patches\t3-tabs-oc-limits.js') (Join-Path $app 'mods\t3-tabs\oc-limits.js') -Force

# Add our keys; cmd-shift-b is deliberately absent (it stays layout.toggle:sidebar).
$keysPath = Join-Path $app 'keys.json'
$keys = if (Test-Path $keysPath) { Get-Content $keysPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
$ours = [pscustomobject]@{ 'cmd-shift-a' = 't3-tabs.view'; 'cmd-shift-s' = 't3-focus.settle' }
$keys | Add-Member -NotePropertyName 'layout:herdr-t3' -NotePropertyValue $ours -Force
# WriteAllText, not Set-Content: PowerShell 5.1's utf8 adds a BOM the app can't parse.
[System.IO.File]::WriteAllText($keysPath, ($keys | ConvertTo-Json -Depth 10))

$herdr = Get-Command herdr-app -ErrorAction SilentlyContinue
if ($herdr) {
  # Same for herdr-app: its output is progress, not a failure unless the exit code says so.
  $ErrorActionPreference = 'Continue'
  foreach ($name in 'my-brand', 'my-oc-limits', 'agents-canvas', 't3-tabs', 't3-chrome', 't3-spaces', 't3-agents', 't3-focus', 't3-pane', 't3-new-menu') {
    & $herdr.Source check (Join-Path $app ('mods\' + $name))
    if ($LASTEXITCODE -ne 0) { Write-Warning "check failed: $name" }
  }
  & $herdr.Source do layout.switch --name herdr-t3 | Out-Null
  $ErrorActionPreference = 'Stop'
  Write-Host 'Showing herdr-t3.'
} else {
  Write-Host 'herdr-app not on PATH - open Herdr and pick the herdr-t3 layout.'
}
