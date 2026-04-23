# ELBOW GREASE — RELEASE-mode build.
#
# Produces a production-optimized, signing-ready exe + installer at
# `src-tauri\target\release\elbow-grease.exe`. Use this ONLY when you
# need a binary to ship to a teammate, customer, or for release tags.
#
# For the day-to-day "open the app and see my changes" workflow, use
# `launch-app.bat` instead — it builds a debug exe in 15-30s vs this
# script's 45-105s.
#
# Why release mode takes ~3-4x longer:
#   • Full LLVM optimization (opt-level 3)
#   • Link-Time Optimization (LTO) — whole-program analysis
#   • Code signing hooks enabled
#   • Installer / MSI bundling in tauri.conf.json
#   • Vite production minification + tree-shaking at max aggression
#
# None of those matter for local iteration. They ALL matter for a
# binary you're distributing.

$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = 'C:\Program Files\ELBOW GREASE'
$exe  = Join-Path $root 'src-tauri\target\release\elbow-grease.exe'

Write-Host '==================================================='
Write-Host '  Building ELBOW GREASE — RELEASE mode'
Write-Host '  Expected: 45-105s (full LTO + optimization).'
Write-Host '  Output: src-tauri\target\release\elbow-grease.exe'
Write-Host ''
Write-Host '  If you just want to run the app locally with your'
Write-Host '  latest changes, close this and run launch-app.bat'
Write-Host '  instead (3-4x faster).'
Write-Host '==================================================='
Write-Host ''

Push-Location $root
try {
  $npm = 'npm.cmd'
  $npmFixed = 'C:\Program Files\nodejs\npm.cmd'
  if (Test-Path $npmFixed) { $npm = $npmFixed }

  & $npm run tauri:build 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) {
    Write-Error 'Release build FAILED. See log above.'
    Start-Sleep -Seconds 10
    exit 1
  }
} catch {
  Write-Error ('Release build threw: ' + $_.Exception.Message)
  Start-Sleep -Seconds 10
  exit 1
} finally {
  Pop-Location
}

if (Test-Path $exe) {
  Write-Host ''
  Write-Host ('Release exe at: ' + $exe)
  $size = (Get-Item $exe).Length / 1MB
  Write-Host ('Size: {0:N2} MB' -f $size)
  Write-Host ''
  Write-Host 'Ready to ship. This window will close in 10 seconds.'
  Start-Sleep -Seconds 10
} else {
  Write-Error 'Build succeeded but no exe found at expected path.'
  Start-Sleep -Seconds 10
}
