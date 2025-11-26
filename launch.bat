@echo off
setlocal
set "ROOT=%~dp0"

start "Travelr Server" cmd /k "pushd ""%ROOT%"" && npm run dev --workspace server"
start "Travelr Client" cmd /k "pushd ""%ROOT%"" && npm run dev --workspace client"

echo.
echo Travelr server and client launch windows started.
echo Close this window if you no longer need it.
exit /b 0
