@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TOPE Mate - Start Local AI Services

echo [TOPE Mate] This opens two windows: scoring service on 127.0.0.1:3001 and
echo [TOPE Mate] transcription service on 127.0.0.1:3002. Both bind to 127.0.0.1 only,
echo             so nothing is reachable from outside this machine.
echo [TOPE Mate] You can skip this step: the preview launcher next to this file runs
echo             the page offline. Without an API key the report page states the
echo             failure and never invents a transcript or a score.
echo [TOPE Mate] No npm install is needed - both modules have zero dependencies.
echo [TOPE Mate] First run with a key: copy each module's .env.example to .env in that
echo             folder and fill it in. .env is ignored by Git - never commit it.
echo.

rem cmd.exe only survives "start" when the quoted command carries no further quoted
rem arguments, so each service is launched through an explicit "cmd /c call" layer.
rem Writing start "title" "helper.cmd" "arg" "arg" makes the new window print
rem "The filename, directory name, or volume label syntax is incorrect" and exit.
start "TOPE Mate scoring 3001" cmd /c call "%~dp0tools\serve-with-env.cmd" "%~dp0modules\ai-scoring" "Scoring" 3001
start "TOPE Mate transcription 3002" cmd /c call "%~dp0tools\serve-with-env.cmd" "%~dp0modules\speech-transcription" "Transcription" 3002

echo [TOPE Mate] A "listening" line in each window means it started.
echo [TOPE Mate] Check it yourself:  http://127.0.0.1:3001/health  and  http://127.0.0.1:3002/health
echo [TOPE Mate] If a window shows a reason instead, fix that and run this again.
echo [TOPE Mate] To stop: use the stop launcher in this folder, or close those windows.
echo.
pause
