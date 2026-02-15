@echo off
setlocal

cd /d "%~dp0"

echo [1/2] Installing dependencies...
call npm install
if errorlevel 1 (
  echo Install failed.
  exit /b 1
)

echo [2/2] Starting dev server with --host...
call npm run dev -- --host

endlocal
