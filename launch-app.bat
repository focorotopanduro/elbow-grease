@echo off
:: ELBOW GREASE — reliable "launch latest native app" wrapper.
:: Double-click this file (or the desktop shortcut that points at it)
:: to get the freshest build of the native Tauri desktop app.
::
:: Behavior:
::   1. Checks if source is newer than the compiled exe.
::   2. If yes, runs `npm run tauri:build` to produce a fresh exe.
::      (Rust incremental compile is ~30-90s; Vite is ~15s.)
::   3. Launches the native exe from src-tauri\target\release.
::
:: If the build fails, it launches whatever exe exists (stale is
:: better than nothing) and surfaces the error for reporting.
::
:: This is the app-only path. For rapid browser-based iteration
:: with hot module reload, use `ELBOW GREASE.bat` (Vite dev server)
:: or run `npm run tauri:dev` in a terminal.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
