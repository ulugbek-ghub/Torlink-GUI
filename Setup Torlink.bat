@echo off
setlocal
title Torlink Setup
cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Torlink needs Windows 10 or newer with PowerShell.
  pause
  exit /b 1
)

echo.
echo  Torlink GUI - first-time setup
echo  This installs everything Torlink needs. It can take a few minutes.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1" %*
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo Setup failed with exit code %CODE%.
  echo See "%~dp0.runtime\logs\setup.log" for details.
  pause
  exit /b %CODE%
)

exit /b 0
