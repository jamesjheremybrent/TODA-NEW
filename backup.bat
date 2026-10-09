@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File scripts\backup-database.ps1
if errorlevel 1 (
  echo ERROR: Database backup failed.
  exit /b 1
)
