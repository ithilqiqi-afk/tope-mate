@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
rem Starts one local TOPE Mate service (scoring or transcription) from its module folder.
rem If that folder has a .env file, its variables are loaded first (.env stays out of Git).
rem Usage: serve-with-env.cmd <module folder> <label> <default port>
rem Keep this file ASCII with CRLF endings: cmd.exe re-reads a batch by byte offset, and
rem UTF-8 text or LF endings make it print "The filename, directory name, or volume label
rem syntax is incorrect" instead of running anything.

set "LABEL=%~2"
set "PORT=%~3"
set "TARGET=%~f1"

if not defined LABEL set "LABEL=TOPE Mate service"
if not defined PORT goto :no_args

if not exist "%TARGET%\" goto :no_folder
cd /d "%TARGET%" || goto :no_folder

where node >nul 2>nul
if errorlevel 1 goto :no_node
for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"

if not exist "src\http-server.mjs" goto :no_entry

set "ENVBAT="
if exist ".env" call :load_env || goto :env_failed

if not defined PORT set "PORT=%~3"

set "PORTBUSY="
netstat -ano | findstr /R /C:"127.0.0.1:%PORT%.*LISTENING" >nul
if not errorlevel 1 set "PORTBUSY=1"

set "KEYSTATE=not set - the service answers with a clear error instead of made-up results"
if defined OPENAI_API_KEY set "KEYSTATE=configured"
if defined BAILIAN_API_KEY set "KEYSTATE=configured"
if defined DASHSCOPE_API_KEY set "KEYSTATE=configured"

echo [TOPE Mate] !LABEL!  folder: !CD!
echo [TOPE Mate] !LABEL!  node:    !NODEVER!
echo [TOPE Mate] !LABEL!  port:    http://127.0.0.1:!PORT!  ^(loopback only, close this window to stop^)
if defined PORTBUSY (
  echo [TOPE Mate] !LABEL!  NOTE: something already listens on 127.0.0.1:!PORT! - these PIDs hold it:
  netstat -ano | findstr /R /C:"127.0.0.1:%PORT%.*LISTENING"
  echo [TOPE Mate] !LABEL!  If this service then reports EADDRINUSE, stop the older one first:
  echo                    "stop AI backend" launcher, or  taskkill /F /PID ^<pid^>
)
echo [TOPE Mate] !LABEL!  API key: !KEYSTATE!
echo [TOPE Mate] !LABEL!  logs keep method, path, status and byte count only - never your audio.
echo.

rem The modules have zero npm dependencies, so node runs the same entry point that
rem "npm run serve" would run - no registry access, no extra shell layer.
node src\http-server.mjs
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo [TOPE Mate] !LABEL! exited with code %RC%. Common causes:
  echo             - the port is already taken ^(see the NOTE above^);
  echo             - the folder was moved or the repository is incomplete;
  echo             - a typo in .env ^(a quoted value must not contain an unbalanced quote^).
) else (
  echo [TOPE Mate] !LABEL! stopped normally.
)
pause
endlocal
exit /b %RC%

:load_env
set "ENVBAT=%TEMP%\tope-mate-env-%RANDOM%.cmd"
node "%~dp0env-lines.mjs" ".env" "%ENVBAT%"
if errorlevel 1 exit /b 1
if not exist "%ENVBAT%" exit /b 1
call "%ENVBAT%"
del "%ENVBAT%" >nul 2>nul
set "ENVBAT="
exit /b 0

:no_args
echo [TOPE Mate] Service cannot start - the default port argument is missing.
echo             Correct use: serve-with-env.cmd ^<module folder^> ^<label^> ^<port^>
pause
endlocal
exit /b 1

:no_folder
echo [TOPE Mate] Service cannot start - module folder not found:
echo             %TARGET%
echo             Run this launcher from inside the repository, or restore the modules folder.
pause
endlocal
exit /b 1

:no_node
echo [TOPE Mate] Service cannot start - node.exe was not found on PATH.
echo             The web page itself needs no Node.js; only transcription and AI scoring do.
echo             Install a Node.js LTS build, then run this launcher again.
echo             Check with:  node -v
pause
endlocal
exit /b 1

:no_entry
echo [TOPE Mate] Service cannot start - src\http-server.mjs is missing in:
echo             %CD%
echo             The repository looks incomplete. Re-clone it or restore the modules folder.
pause
endlocal
exit /b 1

:env_failed
echo [TOPE Mate] Service cannot start - .env in %CD% could not be read.
echo             Fix: rename .env temporarily to skip it, or compare it with .env.example.
echo             Only KEY=VALUE lines are accepted; no value is ever printed here.
pause
endlocal
exit /b 1
