@echo off
cd /d "%~dp0"
echo Starting Jarvischan local agent...
echo.
npm start
echo.
echo The agent stopped. Press any key to close this window.
pause >nul
