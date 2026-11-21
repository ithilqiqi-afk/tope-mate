@echo off
chcp 65001 >nul
title TOPE Mate - Stop Local AI Services
setlocal enabledelayedexpansion
set "PIDS="

for %%p in (3001 3002) do (
  for /f "tokens=5" %%n in ('netstat -ano ^| findstr "127.0.0.1:%%p " ^| findstr "LISTENING"') do (
    set "HIT="
    for /f "tokens=1" %%i in ('tasklist /fi "PID eq %%n" /nh') do if /i "%%i"=="node.exe" set "HIT=1"
    if defined HIT set "PIDS=!PIDS! %%n"
  )
)

if not defined PIDS (
  echo [TOPE Mate] Nothing is listening on 127.0.0.1:3001 or 127.0.0.1:3002, so there is
  echo [TOPE Mate] nothing to stop. If those two windows are still open, just close them.
  pause
  exit /b 0
)

echo [TOPE Mate] About to end these Node processes:!PIDS!
echo [TOPE Mate] Only the local scoring/transcription services are affected. Your recordings
echo [TOPE Mate] live in browser memory, they are not written to disk, and no file is deleted.
set "ANS="
set /p ANS=[TOPE Mate] Type Y then Enter to continue, anything else to cancel:
if /i not "!ANS!"=="Y" (
  echo [TOPE Mate] Cancelled. No process was ended.
  pause
  exit /b 0
)

for %%n in (!PIDS!) do taskkill /f /pid %%n >nul 2>nul
echo [TOPE Mate] Stop request sent. The report page will then say the local service is
echo [TOPE Mate] unreachable, which is expected - it will not show a fake score.
pause
endlocal
