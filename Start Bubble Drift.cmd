@echo off
rem Double-click this file to run Bubble Drift.
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies for the first run...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

start "Bubble Drift server" cmd /k npm.cmd run dev -- --port 5173 --strictPort
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"
exit /b 0

:fail
echo.
echo Install failed. Check that Node.js is installed, then try again.
pause
exit /b 1
