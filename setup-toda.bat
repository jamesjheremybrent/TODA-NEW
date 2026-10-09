@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

where node >nul 2>&1 || (
	echo ERROR: Node.js is not installed or is not on PATH.
	echo Install the current Node.js LTS release, then run this file again.
	pause
	exit /b 1
)

where pnpm >nul 2>&1 || (
	echo ERROR: pnpm is not installed or is not on PATH.
	echo Install pnpm, then run this file again.
	pause
	exit /b 1
)

if not exist "%ROOT%\.env" (
	if not exist "%ROOT%\.env.example" (
		echo ERROR: .env.example is missing.
		pause
		exit /b 1
	)
	copy /y "%ROOT%\.env.example" "%ROOT%\.env" >nul
	echo A local .env file was created from .env.example.
	echo Enter the client's MySQL password and a unique SESSION_SECRET now.
	notepad "%ROOT%\.env"
	pause
)

echo Starting MySQL service...
net start MySQL80 >nul 2>&1
if errorlevel 1 net start MySQL >nul 2>&1
if errorlevel 1 echo WARNING: MySQL could not be started automatically. Start it manually, then continue.

if not exist "%ROOT%\node_modules" (
	echo Installing application dependencies...
	call pnpm install
	if errorlevel 1 (
		echo ERROR: Dependency installation failed.
		pause
		exit /b 1
	)
)

echo Applying database migrations...
call pnpm db:migrate
if errorlevel 1 (
	echo ERROR: Database migration failed. Confirm MySQL and .env settings.
	pause
	exit /b 1
)

echo Migrating legacy driver photos, if any...
call pnpm photos:migrate
if errorlevel 1 echo WARNING: Photo migration was not completed. The application can still start.

echo Building the local application...
call pnpm build
if errorlevel 1 (
	echo ERROR: Frontend build failed.
	pause
	exit /b 1
)

echo.
echo Setup complete. Use start-toda.bat whenever the client wants to open TODA.
pause
