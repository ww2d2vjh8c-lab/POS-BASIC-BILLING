@echo off
setlocal EnableDelayedExpansion
title Bloom Cafe POS - One-Click Installer
cd /d "%~dp0"

echo ============================================
echo   Bloom Cafe POS - One-Click Installer
echo ============================================
echo.

REM ── 1. Make sure Node.js is installed ────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
  echo [1/4] Node.js not found. Installing Node.js 20 LTS...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo.
    echo ERROR: winget is not available on this PC.
    echo Please install Node.js 20 LTS from https://nodejs.org and run INSTALL.bat again.
    pause
    exit /b 1
  )
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
  REM Pick up the new PATH without needing a new window
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  where node >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Node.js install failed. Install it from https://nodejs.org then run INSTALL.bat again.
    pause
    exit /b 1
  )
) else (
  echo [1/4] Node.js found.
)

REM ── 2. Install dependencies (also builds the database driver) ─────────
echo [2/4] Installing dependencies (first time takes a few minutes)...
call npm ci
if errorlevel 1 (
  echo ERROR: Dependency install failed. Check the internet connection and try again.
  pause
  exit /b 1
)

REM ── 3. Build the Windows installer ────────────────────────────────────
echo [3/4] Building the app...
if exist dist rmdir /s /q dist
call npm run dist:win
if errorlevel 1 (
  echo ERROR: Build failed. See the messages above.
  pause
  exit /b 1
)

REM ── 4. Install it silently (keeps existing sales data) ─────────────────
set "SETUP="
for %%F in ("dist\*Setup*.exe") do set "SETUP=%%~fF"
if not defined SETUP (
  echo ERROR: Installer was not produced in the dist folder.
  pause
  exit /b 1
)
echo [4/4] Installing "%SETUP%" ...
"%SETUP%" /S
if errorlevel 1 (
  echo ERROR: Installation failed.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Done! "Bloom Cafe POS" is on the Desktop.
echo   Your sales data is kept when you reinstall.
echo ============================================
start "" "%LOCALAPPDATA%\Programs\bloom-cafe-pos\Bloom Cafe POS.exe" 2>nul
pause
