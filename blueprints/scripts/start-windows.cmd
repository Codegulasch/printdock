@echo off
rem PrintDock unter Windows starten – startet nach einem Update oder dem Einspielen einer Sicherung von selbst neu.
cd /d "%~dp0\.."
set PRINTDOCK_RESTART=exit
:loop
node server.js
if %ERRORLEVEL%==75 goto loop
echo PrintDock wurde beendet (Code %ERRORLEVEL%).
pause
