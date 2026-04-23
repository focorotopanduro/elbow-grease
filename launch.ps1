# ELBOW GREASE - smart launcher that auto-rebuilds the release exe
# whenever source has changed, then launches it.
#
# The desktop shortcut points at this script instead of the compiled
# exe, so the user never accidentally runs a stale build after code
# changes.
#
# Flow:
#   1. Script checks src/ + src-tauri/ + related config timestamps.
#   2. If any file is newer than the compiled exe, rebuild via
#      `npm run tauri:build` (release, ~45-105s incremental).
#   3. Launch target/release/elbow-grease.exe.
#
# Why release (not debug):
#   Release builds reuse the existing target/release/ cache from the
#   last build (warm cache). Incremental rebuilds are 45-105s.
#   Debug builds would be faster PER INCREMENT, but target/debug/
#   starts empty (cold cache), so the first debug build compiles
#   500+ Tauri dependencies from scratch - 5-15 minutes of pain.
#   Not worth it when the release cache is already warm.
#
# If you specifically need a shippable release exe (signed, with
# installer), run `build-release.ps1` - this launcher produces the
# same exe but that script adds an explicit "ready to ship" summary.
#
# For fast-iteration dev work (HMR, near-instant frontend reload),
# run `npm run tauri:dev` in a terminal. That skips the compile
# loop entirely for frontend edits.

$ErrorActionPreference = 'Stop'

# Try to force UTF-8 output. In Windows PowerShell 5.1 launched via
# cmd.exe with -WindowStyle Minimized, the console still often falls
# back to the active OEM codepage (usually 437 or 1252), which turns
# UTF-8 em dashes into mojibake. We use ASCII-only strings in the
# banner below so the output is readable regardless.
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 | Out-Null
} catch { }

$root = 'C:\Program Files\ELBOW GREASE'
$exe  = Join-Path $root 'src-tauri\target\release\elbow-grease.exe'
$srcDirs = @(
  (Join-Path $root 'src'),
  (Join-Path $root 'src-tauri\src'),
  (Join-Path $root 'index.html'),
  (Join-Path $root 'vite.config.ts'),
  (Join-Path $root 'package.json'),
  (Join-Path $root 'src-tauri\Cargo.toml'),
  (Join-Path $root 'src-tauri\tauri.conf.json')
)

function Get-NewestSrcMtime {
  $newest = [DateTime]::MinValue
  foreach ($p in $srcDirs) {
    if (-not (Test-Path $p)) { continue }
    $item = Get-Item $p
    if ($item.PSIsContainer) {
      $files = Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\target\\' -and $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\dist\\' }
      foreach ($f in $files) {
        if ($f.LastWriteTime -gt $newest) { $newest = $f.LastWriteTime }
      }
    } else {
      if ($item.LastWriteTime -gt $newest) { $newest = $item.LastWriteTime }
    }
  }
  return $newest
}

# --- Check if rebuild is needed ----------------------------------
$needRebuild = $false
if (-not (Test-Path $exe)) {
  Write-Host 'ELBOW GREASE: no exe found - first build'
  $needRebuild = $true
} else {
  $exeTime = (Get-Item $exe).LastWriteTime
  $srcTime = Get-NewestSrcMtime
  if ($srcTime -gt $exeTime) {
    Write-Host 'ELBOW GREASE: source changed since last build'
    Write-Host ('  newest src: ' + $srcTime.ToString('yyyy-MM-dd HH:mm:ss'))
    Write-Host ('  exe built:  ' + $exeTime.ToString('yyyy-MM-dd HH:mm:ss'))
    $needRebuild = $true
  } else {
    Write-Host 'ELBOW GREASE: exe is current - launching immediately'
  }
}

# --- Rebuild if needed -------------------------------------------
if ($needRebuild) {
  Write-Host ''
  Write-Host '==================================================='
  Write-Host '  Rebuilding ELBOW GREASE (release mode)...'
  Write-Host '  Expected: 45-105 seconds on an incremental build.'
  Write-Host '  First build after a clean: 5-15 minutes (compiles'
  Write-Host '  all Tauri dependencies from scratch one time).'
  Write-Host '  This window closes automatically when done.'
  Write-Host '==================================================='
  Write-Host ''

  Push-Location $root
  try {
    $npm = 'npm.cmd'
    $npmFixed = 'C:\Program Files\nodejs\npm.cmd'
    if (Test-Path $npmFixed) { $npm = $npmFixed }

    & $npm run tauri:build 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'Build returned non-zero exit code. Launching previous exe anyway.'
      Start-Sleep -Seconds 3
    }
  } catch {
    Write-Warning ('Build threw: ' + $_.Exception.Message)
    Write-Warning 'Falling back to previous exe if it exists.'
    Start-Sleep -Seconds 3
  } finally {
    Pop-Location
  }
}

# --- Launch ------------------------------------------------------
if (Test-Path $exe) {
  Write-Host ('ELBOW GREASE: launching ' + $exe)
  Start-Process -FilePath $exe
} else {
  Write-Error 'No exe to launch, and build failed. Check the log above.'
  Start-Sleep -Seconds 10
}
