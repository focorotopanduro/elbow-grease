@echo off
:: ELBOW GREASE — RELEASE-mode build wrapper.
:: Produces a shippable production exe + installer.
:: For daily-iteration launches, use launch-app.bat instead (much faster).

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-release.ps1"
pause
