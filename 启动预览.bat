@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TOPE Mate - Local Preview Server

rem Keep port 5173: the local AI services (3001/3002) only accept this origin.
set PORT=5173

set PY=
where python >nul 2>nul && set PY=python
if not defined PY (
  where py >nul 2>nul && set PY=py
)

if not defined PY goto :fallback

netstat -ano | findstr /R /C:"127.0.0.1:%PORT%.*LISTENING" /C:"0.0.0.0:%PORT%.*LISTENING" >nul
if errorlevel 1 goto :serve

echo.
echo [TOPE Mate] Port %PORT% is already taken by another local web server:
netstat -ano | findstr /R /C:"127.0.0.1:%PORT%.*LISTENING" /C:"0.0.0.0:%PORT%.*LISTENING"
echo.
echo             The last number on each line is the PID. If that server points at a
echo             different folder, http://127.0.0.1:%PORT%/ would show the OLD copy
echo             of this project instead of the one in this directory.
echo.
echo             Fix: close the other black window, or run
echo               taskkill /F /PID ^<pid^>
echo             If that server already serves THIS folder, just open
echo               http://127.0.0.1:%PORT%/ in your browser and skip this script.
echo.
set /p GO=Check again? (Y = re-check the port, anything else = exit):
if /I "%GO%"=="Y" goto :recheck
goto :eof

:recheck
netstat -ano | findstr /R /C:"127.0.0.1:%PORT%.*LISTENING" /C:"0.0.0.0:%PORT%.*LISTENING" >nul
if errorlevel 1 goto :serve
echo [TOPE Mate] Port %PORT% is still busy. Close the other server first.
goto :eof

:serve
echo [TOPE Mate] http://127.0.0.1:%PORT%/  -  press Ctrl+C or close this window to stop
start "" "http://127.0.0.1:%PORT%/"
"%PY%" -m http.server %PORT% --bind 127.0.0.1
goto :eof

:fallback
echo [TOPE Mate] Python not found. Opening index.html directly in your browser.
echo             This works fine for everything except the microphone prompt,
echo             which some browsers block on file:// pages.
start "" "index.html"
pause
