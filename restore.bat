@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: restore.bat path\to\backup.sql
  exit /b 1
)
powershell -ExecutionPolicy Bypass -File scripts\restore-database.ps1 -BackupFile "%~1"
if errorlevel 1 (
  echo ERROR: Database restore failed.
  exit /b 1
)
