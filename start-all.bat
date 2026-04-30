@echo off
title Adwa Bingo — Start All
color 0A
echo.
echo  ============================================
echo    ADWA BINGO — Starting All Services
echo  ============================================
echo.
echo  Make sure XAMPP MySQL is running first!
echo.

:: ── 0. Setup database ────────────────────────────────────────
echo  [0/3] Setting up database 'bingo'...
node "%~dp0backend\setup-database.js"
if %errorlevel% neq 0 (
  echo.
  echo  ERROR: Database setup failed!
  echo  Make sure XAMPP MySQL is running.
  pause
  exit /b 1
)

:: ── 1. Start Backend ─────────────────────────────────────────
echo.
echo  [1/3] Starting Backend on port 3001...
start "Bingo Backend" cmd /k "cd /d %~dp0backend && node server.js"
timeout /t 3 /nobreak > nul

:: ── 2. Start ngrok tunnel ────────────────────────────────────
echo  [2/3] Starting ngrok tunnel...
start "ngrok Tunnel" cmd /k "ngrok http 3001"
timeout /t 4 /nobreak > nul

:: ── 3. Start Telegram Bot ────────────────────────────────────
echo  [3/3] Starting Telegram Bot...
start "Bingo Bot" cmd /k "cd /d %~dp0bingo-bot && npm start"

echo.
echo  ============================================
echo    All services started!
echo.
echo    Game (local):  http://localhost:3001
echo    ngrok URL:     Check the ngrok window
echo.
echo    Copy the ngrok https URL and update:
echo      bingo-bot\.env  ^> WEB_APP_URL=
echo  ============================================
echo.
pause
