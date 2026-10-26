@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Bloom Cafe POS - One-Click Installer
cd /d "%~dp0"

rem ==========================================================================
rem  Bloom Cafe POS - one-click installer (double-click this file)
rem
rem   1. Makes sure Node.js is installed (installs Node.js 22 with winget)
rem   2. Downloads the app's building blocks            (npm ci)
rem   3. Builds the Windows installer                    (npm run dist:win)
rem   4. Closes the running app, backs up the data, installs silently
rem   5. Checks the new version really is installed, then opens it
rem
rem  Sales, menu and settings live in %APPDATA%\bloom-cafe-pos. The installer
rem  never deletes that folder (not on update, not on uninstall).
rem  Everything that happens is written to install.log next to this file.
rem
rem  Options:  INSTALL.bat /nopause   - do not wait for a key press at the end
rem ==========================================================================

set "APP_EXE=Bloom Cafe POS.exe"
rem Registry id that electron-builder derives from appId "com.bloomcafe.pos".
set "APP_GUID=3186cf90-cde4-54e2-a777-cb2654a587ae"
set "NODE_MIN=20"
set "LOG=%~dp0install.log"
set "STEPLOG=%TEMP%\bloom-cafe-pos-install-step.log"
set "NOPAUSE="
if /i "%~1"=="/nopause" set "NOPAUSE=1"

if exist "%LOG%" move /y "%LOG%" "%~dp0install.previous.log" >nul 2>&1
> "%LOG%" echo Bloom Cafe POS install log
>>"%LOG%" echo Started : %DATE% %TIME%
>>"%LOG%" echo Folder  : %CD%
>>"%LOG%" echo User    : %USERNAME%
>>"%LOG%" ver
where git >nul 2>nul && git log -1 --format="Commit  : %%h %%cd %%s" --date=short >>"%LOG%" 2>&1

call :say "============================================"
call :say "  Bloom Cafe POS - One-Click Installer"
call :say "============================================"
call :say ""

rem --------------------------------------------------------------------------
rem  1. Node.js
rem --------------------------------------------------------------------------
call :say "[1/5] Checking Node.js..."
call :node_version
if %NODE_MAJOR% GEQ %NODE_MIN% goto node_ok

if not "%NODE_MAJOR%"=="0" goto node_too_old
call :say "      Node.js is not installed - installing Node.js 22 (a few minutes)..."
goto node_install
:node_too_old
call :say "      Node.js %NODE_MAJOR% is too old - installing Node.js 22 (a few minutes)..."
:node_install
where winget >nul 2>nul
if errorlevel 1 goto err_no_winget
call :say "      If Windows asks for permission, please click Yes."
>>"%LOG%" echo ===== winget install OpenJS.NodeJS.22 =====
winget install -e --id OpenJS.NodeJS.22 --accept-package-agreements --accept-source-agreements --silent >>"%LOG%" 2>&1
call :refresh_node_path
call :node_version
if %NODE_MAJOR% GEQ %NODE_MIN% goto node_ok
>>"%LOG%" echo ===== winget install OpenJS.NodeJS.LTS (fallback) =====
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent >>"%LOG%" 2>&1
call :refresh_node_path
call :node_version
if %NODE_MAJOR% GEQ %NODE_MIN% goto node_ok
goto err_node

:node_ok
set "NODE_VER="
set "NPM_VER="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
for /f "delims=" %%v in ('npm -v 2^>nul') do set "NPM_VER=%%v"
call :say "      Node.js %NODE_VER% found."
>>"%LOG%" echo node %NODE_VER% / npm %NPM_VER%

set "APP_VERSION="
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "APP_VERSION=%%v"
if not defined APP_VERSION goto err_package_json
>>"%LOG%" echo App version to install: %APP_VERSION%

rem --------------------------------------------------------------------------
rem  2. Dependencies (also builds the database driver for the app)
rem --------------------------------------------------------------------------
call :say "[2/5] Downloading the app's building blocks..."
call :say "      The first time this takes 5-10 minutes. Please do not close this window."
>>"%LOG%" echo ===== npm ci =====
call npm ci --no-audit --no-fund >"%STEPLOG%" 2>&1
set "RC=%ERRORLEVEL%"
type "%STEPLOG%" >>"%LOG%"
if "%RC%"=="0" goto deps_ok
call :explain_error
call :say "      Trying once more in 15 seconds..."
ping -n 16 127.0.0.1 >nul
>>"%LOG%" echo ===== npm ci (retry) =====
call npm ci --no-audit --no-fund >"%STEPLOG%" 2>&1
set "RC=%ERRORLEVEL%"
type "%STEPLOG%" >>"%LOG%"
if not "%RC%"=="0" goto err_deps
:deps_ok

rem --------------------------------------------------------------------------
rem  3. Build the Windows installer
rem --------------------------------------------------------------------------
call :say "[3/5] Building Bloom Cafe POS %APP_VERSION% (a few minutes)..."
if exist "dist" rmdir /s /q "dist" >>"%LOG%" 2>&1
>>"%LOG%" echo ===== npm run dist:win =====
call npm run dist:win >"%STEPLOG%" 2>&1
set "RC=%ERRORLEVEL%"
type "%STEPLOG%" >>"%LOG%"
if "%RC%"=="0" goto build_ok
call :explain_error
call :say "      Trying once more in 15 seconds..."
ping -n 16 127.0.0.1 >nul
if exist "dist" rmdir /s /q "dist" >>"%LOG%" 2>&1
>>"%LOG%" echo ===== npm run dist:win (retry) =====
call npm run dist:win >"%STEPLOG%" 2>&1
set "RC=%ERRORLEVEL%"
type "%STEPLOG%" >>"%LOG%"
if not "%RC%"=="0" goto err_build
:build_ok
set "SETUP="
for %%F in ("dist\Bloom-Cafe-POS-Setup-*.exe" "dist\*Setup*.exe") do if not defined SETUP set "SETUP=%%~fF"
if not defined SETUP goto err_no_setup
>>"%LOG%" echo Installer built: %SETUP%

rem --------------------------------------------------------------------------
rem  4. Close the running app, back up the data, install silently
rem --------------------------------------------------------------------------
call :say "[4/5] Installing Bloom Cafe POS %APP_VERSION%..."
call :close_app
if not exist "%~dp0BACKUP-DATA.bat" goto backup_missing
call :say "      Backing up your sales data first..."
call "%~dp0BACKUP-DATA.bat" /auto "%LOG%"
if errorlevel 1 goto backup_failed
goto run_setup
:backup_missing
>>"%LOG%" echo BACKUP-DATA.bat not found - skipping the backup.
goto run_setup
:backup_failed
call :say "      WARNING: the backup did not finish - details are in install.log."
call :say "      Your data is still safe: installing never deletes it."
choice /C YN /N /M "      Continue installing anyway? [Y/N] "
if errorlevel 2 goto err_cancelled
:run_setup
call :say "      If Windows asks for permission, please click Yes."
>>"%LOG%" echo ===== "%SETUP%" /S =====
start "" /wait "%SETUP%" /S
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo Installer exit code: %RC%
if not "%RC%"=="0" goto err_install

rem --------------------------------------------------------------------------
rem  5. Check the new version is installed, then open it
rem --------------------------------------------------------------------------
call :find_installed
if not defined INSTALLED_EXE goto err_not_found
>>"%LOG%" echo Installed exe: %INSTALLED_EXE%
call :installed_version
>>"%LOG%" echo Installed version (registry): %INSTALLED_VERSION%
if not defined INSTALLED_VERSION goto version_unknown
if not "%INSTALLED_VERSION%"=="%APP_VERSION%" goto err_version
goto launch
:version_unknown
>>"%LOG%" echo WARNING: could not read the installed version from the registry.
:launch
call :say "[5/5] Opening Bloom Cafe POS..."
start "" /D "%INSTALLED_DIR%" "%INSTALLED_EXE%"

call :say ""
call :say "============================================"
call :say "  Done! Bloom Cafe POS %APP_VERSION% is installed."
call :say ""
call :say "  Open it any time with the Bloom Cafe POS"
call :say "  icon on the Desktop or in the Start menu."
call :say ""
call :say "  Your sales, menu and settings were kept."
call :say "============================================"
call :say ""
>>"%LOG%" echo Finished OK: %DATE% %TIME%
del "%STEPLOG%" >nul 2>&1
call :finish_pause
exit /b 0


rem ==========================================================================
rem  Errors
rem ==========================================================================
:err_no_winget
call :fail "Node.js is missing and winget is not available on this PC." "Install Node.js 22 LTS from https://nodejs.org, then double-click INSTALL.bat again."
exit /b 1

:err_node
call :fail "Node.js could not be installed automatically." "Install Node.js 22 LTS from https://nodejs.org, then double-click INSTALL.bat again."
exit /b 1

:err_package_json
call :fail "package.json could not be read." "Make sure this is the complete POS-BASIC-BILLING folder, then try again."
exit /b 1

:err_deps
call :explain_error
call :fail "the app's building blocks could not be downloaded." "Check the internet connection, restart the laptop if it keeps failing, then double-click INSTALL.bat again."
exit /b 1

:err_build
call :explain_error
call :fail "the app could not be built." "Check the internet connection, then double-click INSTALL.bat again."
exit /b 1

:err_no_setup
call :fail "the installer was not created in the dist folder." "Double-click INSTALL.bat again."
exit /b 1

:err_cancelled
call :fail "installation cancelled." "Nothing was changed. Double-click INSTALL.bat when you are ready."
exit /b 1

:err_install
call :fail "the installer stopped with error code %RC%." "Close Bloom Cafe POS if it is open, then double-click INSTALL.bat again."
exit /b 1

:err_not_found
call :fail "Bloom Cafe POS was not found after installing." "Double-click INSTALL.bat again. If Windows asks for permission, click Yes."
exit /b 1

:err_version
call :fail "version %APP_VERSION% was not installed - version %INSTALLED_VERSION% is still there." "Double-click INSTALL.bat again. If Windows asks for permission, click Yes."
exit /b 1


rem ==========================================================================
rem  Helpers
rem ==========================================================================

rem Print a line on screen and in install.log.
:say
echo(%~1
>>"%LOG%" echo(%~1
exit /b 0

rem Show an error box with what went wrong (%1) and what to do (%2).
:fail
call :say ""
call :say "============================================"
call :say "  INSTALL FAILED: %~1"
call :say "============================================"
call :say "  %~2"
call :say ""
call :say "  Details are in this file:"
call :say "  %LOG%"
call :say "  If it keeps failing, send that file to support."
call :say ""
>>"%LOG%" echo FAILED: %DATE% %TIME%
call :finish_pause
exit /b 1

:finish_pause
if defined NOPAUSE exit /b 0
pause
exit /b 0

rem Sets NODE_MAJOR to the installed Node.js major version, or 0 when missing.
:node_version
set "NODE_MAJOR=0"
where node >nul 2>nul
if errorlevel 1 exit /b 0
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)" 2^>nul') do set "NODE_MAJOR=%%v"
exit /b 0

rem Pick up a freshly installed Node.js without opening a new window.
:refresh_node_path
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
exit /b 0

rem Print a plain-language reason for the last failed step (from STEPLOG).
:explain_error
findstr /i /c:"ENOTFOUND" /c:"ETIMEDOUT" /c:"ECONNRESET" /c:"ECONNREFUSED" /c:"EAI_AGAIN" /c:"getaddrinfo" /c:"socket hang up" /c:"certificate" "%STEPLOG%" >nul 2>&1
if not errorlevel 1 call :say "      Problem: the internet connection dropped or is blocked." & exit /b 0
findstr /i /c:"EPERM" /c:"EBUSY" /c:"EACCES" /c:"operation not permitted" /c:"resource busy or locked" "%STEPLOG%" >nul 2>&1
if not errorlevel 1 call :say "      Problem: a file is locked by another program - often antivirus. Restarting the laptop usually fixes it." & exit /b 0
findstr /i /c:"ENOSPC" /c:"no space left" "%STEPLOG%" >nul 2>&1
if not errorlevel 1 call :say "      Problem: the disk is full. Free up at least 2 GB and try again." & exit /b 0
findstr /i /c:"can only install packages when your package.json and package-lock.json" "%STEPLOG%" >nul 2>&1
if not errorlevel 1 call :say "      Problem: the project files are out of sync. Please contact support." & exit /b 0
call :say "      See install.log for the details."
exit /b 0

rem True (errorlevel 0) when Bloom Cafe POS is running for this user.
:is_app_running
tasklist /FI "IMAGENAME eq %APP_EXE%" /FO CSV /NH 2>nul | find /i "%APP_EXE%" >nul
exit /b %ERRORLEVEL%

rem Close Bloom Cafe POS politely (it saves and closes its database), force it if needed.
:close_app
call :is_app_running
if errorlevel 1 exit /b 0
call :say "      Closing Bloom Cafe POS so it can be updated (open tables are saved)..."
>>"%LOG%" echo ===== taskkill (graceful) =====
taskkill /IM "%APP_EXE%" >>"%LOG%" 2>&1
set /a CLOSE_TRIES=0
:close_app_wait
ping -n 2 127.0.0.1 >nul
call :is_app_running
if errorlevel 1 exit /b 0
set /a CLOSE_TRIES+=1
if %CLOSE_TRIES% LSS 15 goto close_app_wait
>>"%LOG%" echo ===== taskkill /F (app did not close in 15 s) =====
taskkill /F /T /IM "%APP_EXE%" >>"%LOG%" 2>&1
ping -n 3 127.0.0.1 >nul
exit /b 0

rem Sets INSTALLED_DIR / INSTALLED_EXE. Uses the location the installer recorded
rem in the registry (per-user first, then all-users), then the usual folders.
:find_installed
set "INSTALLED_DIR="
set "INSTALLED_EXE="
call :reg_read HKCU "Software\%APP_GUID%" InstallLocation INSTALLED_DIR
if defined INSTALLED_DIR if exist "%INSTALLED_DIR%\%APP_EXE%" goto found_installed
set "INSTALLED_DIR="
call :reg_read HKLM "Software\%APP_GUID%" InstallLocation INSTALLED_DIR
if defined INSTALLED_DIR if exist "%INSTALLED_DIR%\%APP_EXE%" goto found_installed
set "INSTALLED_DIR="
for %%D in ("%LOCALAPPDATA%\Programs\Bloom Cafe POS" "%ProgramFiles%\Bloom Cafe POS" "%LOCALAPPDATA%\Programs\bloom-cafe-pos") do if not defined INSTALLED_DIR if exist "%%~D\%APP_EXE%" set "INSTALLED_DIR=%%~D"
if not defined INSTALLED_DIR exit /b 0
:found_installed
set "INSTALLED_EXE=%INSTALLED_DIR%\%APP_EXE%"
exit /b 0

rem Sets INSTALLED_VERSION from the Add/Remove Programs entry.
:installed_version
set "INSTALLED_VERSION="
call :reg_read HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\%APP_GUID%" DisplayVersion INSTALLED_VERSION
if defined INSTALLED_VERSION exit /b 0
call :reg_read HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\%APP_GUID%" DisplayVersion INSTALLED_VERSION
exit /b 0

rem reg_read ROOT KEY VALUE VARIABLE - copies a REG_SZ value into VARIABLE.
:reg_read
for /f "tokens=2,*" %%A in ('reg query "%~1\%~2" /v "%~3" /reg:64 2^>nul ^| find /i "REG_SZ"') do set "%~4=%%B"
exit /b 0
