@echo off
::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
:: The long line of colons above is deliberate - keep it as line 2.
:: UPDATE.bat from version 1.2.x keeps reading *this* file after its
:: "git pull" replaced it, resuming at about byte 119. Any part of that
:: line is a harmless label, so it simply carries on with the steps below.
setlocal EnableExtensions DisableDelayedExpansion
title Bloom Cafe POS - Update
set "LOG=nul"

rem ==========================================================================
rem  Bloom Cafe POS - update to the latest version (double-click this file)
rem
rem   1. Downloads the latest version from GitHub (git fetch + fast-forward).
rem      Files changed by hand in this folder are kept aside with git stash.
rem   2. Runs INSTALL.bat, which backs up the data, rebuilds and reinstalls.
rem
rem  Sales, menu and settings in %APPDATA%\bloom-cafe-pos are kept.
rem  Git output is written to update.log next to this file.
rem ==========================================================================

rem Run from a copy in %TEMP%: the update may replace this very file, and
rem Windows would then carry on reading the new file from the middle.
if /i "%~1"=="--from-temp" goto main
set "UPDATER=%TEMP%\BloomCafePOS-UPDATE.bat"
copy /y "%~f0" "%UPDATER%" >nul 2>&1
if errorlevel 1 goto main
"%UPDATER%" --from-temp "%~dp0"

:main
set "REPO=%~dp0"
if /i "%~1"=="--from-temp" set "REPO=%~2"
if not "%REPO:~-1%"=="\" set "REPO=%REPO%\"
cd /d "%REPO%"
if errorlevel 1 goto err_folder
set "LOG=%REPO%update.log"
> "%LOG%" echo Bloom Cafe POS update log - %DATE% %TIME%
>>"%LOG%" echo Folder: %REPO%

echo ============================================
echo   Bloom Cafe POS - Update
echo ============================================
echo.

where git >nul 2>nul
if errorlevel 1 goto err_no_git
git rev-parse --is-inside-work-tree >>"%LOG%" 2>&1
if errorlevel 1 goto err_not_clone

echo [1/2] Downloading the latest version from GitHub...
>>"%LOG%" echo ===== git fetch =====
git fetch --prune >>"%LOG%" 2>&1
if errorlevel 1 goto err_fetch

set "DIRTY="
for /f "delims=" %%L in ('git status --porcelain 2^>nul') do set "DIRTY=1"
if not defined DIRTY goto merge
echo       Some files in this folder were changed by hand - keeping them aside
echo       first. A technician can get them back with: git stash list
>>"%LOG%" echo ===== git status / stash =====
git status --short >>"%LOG%" 2>&1
git stash push --include-untracked -m "UPDATE.bat auto-save %DATE% %TIME%" >>"%LOG%" 2>&1
if errorlevel 1 goto err_stash

:merge
set "OLD_COMMIT="
set "NEW_COMMIT="
for /f "delims=" %%C in ('git rev-parse --short HEAD 2^>nul') do set "OLD_COMMIT=%%C"
>>"%LOG%" echo ===== git merge --ff-only @{u} =====
git merge --ff-only @{u} >>"%LOG%" 2>&1
if errorlevel 1 goto err_merge
for /f "delims=" %%C in ('git rev-parse --short HEAD 2^>nul') do set "NEW_COMMIT=%%C"
if "%OLD_COMMIT%"=="%NEW_COMMIT%" goto up_to_date
echo       Downloaded the new version (%OLD_COMMIT% to %NEW_COMMIT%).
goto install
:up_to_date
echo       Already the latest version - reinstalling it to be safe.

:install
>>"%LOG%" echo Updated %OLD_COMMIT% to %NEW_COMMIT%. Running INSTALL.bat
echo [2/2] Installing it...
echo.
call "%REPO%INSTALL.bat"
exit /b %ERRORLEVEL%


:err_folder
echo   ERROR: could not open the folder %REPO%
goto fail

:err_no_git
echo   ERROR: Git is not installed on this PC.
echo   Install Git for Windows from https://git-scm.com and try again,
echo   or download the newest installer from the GitHub Releases page.
goto fail

:err_not_clone
echo   ERROR: this folder was not downloaded with git clone, so it cannot
echo   update itself. Download the newest Bloom-Cafe-POS-Setup .exe from the
echo   GitHub Releases page instead (your data is kept).
goto fail

:err_fetch
echo   ERROR: could not download the update from GitHub.
echo   Check the internet connection and try again. Nothing was changed.
goto fail

:err_stash
echo   ERROR: could not keep the changed files aside. Nothing was changed.
goto fail

:err_merge
echo   ERROR: this copy has its own changes that cannot be updated
echo   automatically. Nothing was changed. Please contact support and
echo   send them the update.log file from this folder.
goto fail

:fail
echo.
echo   Details: %LOG%
>>"%LOG%" echo FAILED: %DATE% %TIME%
pause
exit /b 1
