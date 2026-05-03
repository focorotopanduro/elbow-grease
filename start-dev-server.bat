@echo off
title Beit Hurricane Sim - Dev Server
color 0E

echo.
echo  =========================================================
echo   BEIT HURRICANE SIMULATOR - DEV SERVER
echo  =========================================================
echo.
echo   Starting Vite dev server in:
echo   C:\BEITBUILDING\website
echo.
echo   When the server is ready you'll see something like:
echo     ^>  Local:   http://localhost:5173/
echo.
echo   Open the simulator with the "Beit Sim - Preview"
echo   shortcut on your desktop (or any browser tab pointing
echo   at http://localhost:5173/hurricane-uplift.html).
echo.
echo   To stop the server:  press Ctrl+C, then close this window.
echo  =========================================================
echo.

cd /d "C:\BEITBUILDING\website"

REM If node_modules is missing, run install first so the user isn't
REM stuck with a confusing "Cannot find module" error.
if not exist "node_modules\vite" (
    echo  node_modules not found - running npm install first...
    call npm install
    echo.
)

REM Hand off to npm. This blocks until the server stops (Ctrl+C).
call npm run dev

REM If we land here the server has stopped. Hold the window open so
REM the artist can read any final output before everything closes.
echo.
echo  =========================================================
echo   Server stopped. You can close this window.
echo  =========================================================
pause
