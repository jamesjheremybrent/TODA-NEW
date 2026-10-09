@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "%ROOT%\.env" (
	echo ERROR: root .env is missing.
	echo Configure the root .env file with the local MySQL and session settings first.
	pause
	exit /b 1
)

where node >nul 2>&1 || (echo ERROR: Node.js is not on PATH.& pause& exit /b 1)
if not exist "%ROOT%\dist\index.html" (
	echo ERROR: The production build is missing.
	echo Run setup-toda.bat first.
	pause
	exit /b 1
)

echo Starting MySQL service...
net start MySQL80 >nul 2>&1
if errorlevel 1 net start MySQL >nul 2>&1
if errorlevel 1 echo WARNING: Could not start MySQL automatically. Check the service name and permissions.

echo Starting TODA at http://localhost:5000...
start "TODA Control Panel" cmd /k "cd /d ""%ROOT%"" && node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5000"