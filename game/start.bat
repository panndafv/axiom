@echo off
rem Double-click to play locally: installs, builds, starts the game server and opens the browser.
rem Keep this window open while you play; close it to stop the server.
cd /d "%~dp0"
title Tydal server

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org, install it, then run this again.
  pause
  exit /b 1
)
node -e "process.exit(+process.versions.node.split('.')[0] >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Your Node.js is too old. Install the LTS version from https://nodejs.org, then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing. This takes a minute the first time...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist .env (
  echo Creating .env with local test settings...
  > .env echo # Local test settings. See .env.example for everything you can set.
  >> .env echo ADMIN_KEY=test
  >> .env echo EARN_GATE=0
)

echo Building the game...
call npm run build
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo  The game opens at http://localhost:8787
echo  Keep this window open while you play. Close it to stop the server.
echo  To put 5 test SOL in the reward pool, double-click fund-pool.bat.
echo.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:8787'"
call npm start
pause
