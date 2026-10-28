@echo off
setlocal
title Torlink
cd /d "%~dp0"

if not exist ".runtime\installed" goto setup
if not exist "node_modules\torlnk\dist\cli.cjs" goto setup
if not exist "dist\index.html" goto setup
goto launch

:setup
echo.
echo  Torlink is not set up yet. Running setup first...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1" -NoLaunch
if errorlevel 1 (
  echo.
  echo Setup failed. See ".runtime\logs\setup.log".
  pause
  exit /b 1
)

:launch
echo.
echo  Starting Torlink with a visible log.
echo  Keep this window open while you use Torlink.
echo  Press Ctrl+C or close this window to stop it.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1" -Foreground
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo Torlink stopped with exit code %CODE%.
  echo Check ".runtime\logs\" for details.
  pause
)

exit /b %CODE%
