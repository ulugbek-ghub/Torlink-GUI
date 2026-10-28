@echo off
setlocal
title Stop Torlink
cd /d "%~dp0"

if not exist "scripts\stop-windows.ps1" (
  echo Torlink is incomplete: scripts\stop-windows.ps1 is missing.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-windows.ps1"
if errorlevel 1 (
  echo.
  echo Could not stop every Torlink process.
  pause
  exit /b 1
)

timeout /t 2 /nobreak >nul
exit /b 0
