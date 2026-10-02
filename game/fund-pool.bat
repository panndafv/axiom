@echo off
rem Double-click to put 5 test SOL in the reward pool (start.bat must be running).
cd /d "%~dp0"
node scripts/fund-pool.mjs %1
pause
