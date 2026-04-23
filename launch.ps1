# ELBOW GREASE — smart launcher that auto-rebuilds the DEBUG exe
# whenever source has changed, then launches it.
#
# The desktop shortcut points at this script instead of the compiled
# exe, so the user never accidentally runs a stale build after code
# changes. Typical flow:
#
#   1. I (Claude) edit src/ files.
#   2. User double-clicks the shortcut.
#   3. Script notices src/ has files newer than the exe → rebuilds.
#   4. Script launches the fresh exe and exits.
#   5. Next launch, if no src/ changes, the mtime check is the only
#      work done → exe launches instantly.
#
# ─── Debug build vs release build ─────────────────────────────
#
# This launcher uses `tauri build --debug`, NOT `tauri build`.
# The difference is significant:
#
#   • `tauri build`          — full release: LTO, opt-level 3, signed,
#                              installer packaged. 45-105s rebuild.
#                              Use when shipping an exe to a teammate
#                              or customer. Run via `build-release.ps1`.
#
#   • `tauri build --debug`  — debug compile: no LTO, no optimization,
#                              no signing, no installer. 15-30s rebuild.
#                              Binary is larger + slightly slower at
#                              runtime but functionally identical.
#                              Right for "open the app and see my
#                              changes" workflow — this launcher.
#
# The runtime difference is imperceptible for this app's workload
# (UI-bound with a worker thread). The build-time difference is
# ~3-4x — the reason your desktop launch used to feel glacial.
#
# If the rebuild fails, we fall back to launching whatever exe exists
# (stale is better than nothing) and show the build error so the user
# can report it.

$ErrorActionPreference = 'Stop'

# Force UTF-8 on stdout so Rust/Vite's build output (which includes
# box-drawing + emoji) renders cleanly rather than as OEM-codepage
# mojibake. The user saw `â€œ` / `â•` / `â€¢` soup in the banner
# because Windows PowerShell 5.1 defaults to OEM on the console.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = 'C:\Program Files\ELBOW GREASE'
# Debug build output — Cargo splits debug and release into sibling
# directories. `tauri build --debug` writes the exe here.
$exe  = Join-Path $root 'src-tauri\target\debug\elbow-grease.exe'
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

# ── Check if rebuild is needed ────────────────────────────────
$needRebuild = $false
if (-not (Test-Path $exe)) {
  Write-Host 'ELBOW GREASE: no debug exe found — first build'
  $needRebuild = $true
} else {
  $exeTime = (Get-Item $exe).LastWriteTime
  $srcTime = Get-NewestSrcMtime
  if ($srcTime -gt $exeTime) {
    Write-Host ('ELBOW GREASE: source changed since last build')
    Write-Host ('  newest src: ' + $srcTime.ToString('yyyy-MM-dd HH:mm:ss'))
    Write-Host ('  exe built:  ' + $exeTime.ToString('yyyy-MM-dd HH:mm:ss'))
    $needRebuild = $true
  } else {
    Write-Host 'ELBOW GREASE: debug exe is current — launching immediately'
  }
}

# ── Rebuild if needed ─────────────────────────────────────────
if ($needRebuild) {
  Write-Host ''
  # ASCII-only banner so it renders correctly even if the console
  # couldn't be switched to UTF-8 for some reason.
  Write-Host '==================================================='
  Write-Host '  Rebuilding ELBOW GREASE (debug mode)...'
  Write-Host '  Expected: 15-30s (Vite ~10s + Rust debug ~5-20s).'
  Write-Host '  First build after clean: may take up to 2 minutes.'
  Write-Host '  This window closes automatically when done.'
  Write-Host ''
  Write-Host '  If you need a release-optimized exe for shipping,'
  Write-Host '  run `build-release.ps1` instead of this launcher.'
  Write-Host '==================================================='
  Write-Host ''

  Push-Location $root
  try {
    # Prefer explicit npm.cmd path; falls back to PATH lookup.
    $npm = 'npm.cmd'
    $npmFixed = 'C:\Program Files\nodejs\npm.cmd'
    if (Test-Path $npmFixed) { $npm = $npmFixed }

    # tauri:build-dev → `tauri build --debug` (see package.json).
    # Much faster than the release build path that was previously
    # used here. No installer / signing / LTO.
    & $npm run tauri:build-dev 2>&1 | ForEach-Object { Write-Host $_ }
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

# ── Launch ────────────────────────────────────────────────────
if (Test-Path $exe) {
  Write-Host ('ELBOW GREASE: launching ' + $exe)
  Start-Process -FilePath $exe
} else {
  Write-Error 'No exe to launch, and build failed. Check the log above.'
  Start-Sleep -Seconds 10
}
