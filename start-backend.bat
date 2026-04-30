@echo off
title Adwa Bingo — Backend Server
color 0A
echo.
echo  ============================================
echo    ADWA BINGO - Backend Server
echo  ============================================
echo.
echo  [1] XAMPP MySQL ይሰራ እንደሆነ ያረጋግጡ!
echo.
echo  [2] Backend እየጀምር ነው...
echo.

cd /d "%~dp0backend"
node server.js

echo.
echo  Backend ቆሟል. ለማስጀመር ማንኛውንም ቁልፍ ይጫኑ...
pause > nul
start "" "%~f0"
