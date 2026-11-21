@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TOPE Mate - Local Preview Server

where python >nul 2>nul
if %errorlevel%==0 (
  echo [TOPE Mate] http://127.0.0.1:5173  -  press Ctrl+C to stop
  start "" "http://127.0.0.1:5173/"
  python -m http.server 5173 --bind 127.0.0.1
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo [TOPE Mate] http://127.0.0.1:5173  -  press Ctrl+C to stop
  start "" "http://127.0.0.1:5173/"
  py -m http.server 5173 --bind 127.0.0.1
  goto :eof
)

echo [TOPE Mate] Python not found. Opening index.html directly in your browser.
echo             This works fine - the site has no build step and no server dependency.
start "" "index.html"
pause
