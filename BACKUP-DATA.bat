@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Bloom Cafe POS - Back up data

rem ==========================================================================
rem  Bloom Cafe POS - copy all sales data to a dated folder on the Desktop.
rem
rem  Double-click:              asks before closing the app, then opens the
rem                             backup folder when it is done.
rem  BACKUP-DATA.bat /auto LOG  used by INSTALL.bat: no questions, no pause,
rem                             also writes to the given log file.
rem
rem  The app keeps its data in %APPDATA%\bloom-cafe-pos (database, menu,
rem  settings, its own daily backups and logs). Browser caches are skipped.
rem  Backups are never deleted automatically.
rem
rem  To restore a backup: close Bloom Cafe POS, then copy everything inside
rem  the backup's "bloom-cafe-pos" folder back into %APPDATA%\bloom-cafe-pos.
rem ==========================================================================

set "APP_EXE=Bloom Cafe POS.exe"
set "AUTO="
if /i "%~1"=="/auto" set "AUTO=1"
set "LOG=%~2"
if not defined LOG set "LOG=nul"

rem Data folders: Electron's userData comes from package.json "name".
set "HAS_DATA="
if exist "%APPDATA%\bloom-cafe-pos\" set "HAS_DATA=1"
if exist "%APPDATA%\Bloom Cafe POS\" set "HAS_DATA=1"
if defined HAS_DATA goto have_data
call :say "      No Bloom Cafe POS data on this PC yet - nothing to back up."
goto done_ok

:have_data
if defined AUTO goto copy
call :say "============================================"
call :say "  Bloom Cafe POS - Back up data"
call :say "============================================"
call :say ""
call :is_app_running
if errorlevel 1 goto copy
call :say "Bloom Cafe POS is open. For a complete backup it should be closed."
call :say "Open tables are saved and come back when you open it again."
choice /C YN /N /M "Close Bloom Cafe POS now? [Y/N] "
if errorlevel 2 goto copy
call :close_app

:copy
set "DESKTOP="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')" 2^>nul`) do set "DESKTOP=%%P"
if not defined DESKTOP set "DESKTOP=%USERPROFILE%\Desktop"
set "STAMP="
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss" 2^>nul`) do set "STAMP=%%T"
if not defined STAMP set "STAMP=backup-%RANDOM%%RANDOM%"
set "DEST=%DESKTOP%\Bloom Cafe POS Backups\%STAMP%"

call :say "      Saving a copy of your data to:"
call :say "      %DEST%"
mkdir "%DEST%" >nul 2>&1
if not exist "%DEST%\" goto err_dest

set "COPY_FAILED="
call :copy_folder "%APPDATA%\bloom-cafe-pos" "%DEST%\bloom-cafe-pos"
call :copy_folder "%APPDATA%\Bloom Cafe POS" "%DEST%\Bloom Cafe POS"
if defined COPY_FAILED goto err_copy
if exist "%APPDATA%\bloom-cafe-pos\bloom-cafe.db" if not exist "%DEST%\bloom-cafe-pos\bloom-cafe.db" goto err_copy

> "%DEST%\HOW-TO-RESTORE.txt" echo Bloom Cafe POS backup made %DATE% %TIME% on %COMPUTERNAME%.
>>"%DEST%\HOW-TO-RESTORE.txt" echo.
>>"%DEST%\HOW-TO-RESTORE.txt" echo To restore it:
>>"%DEST%\HOW-TO-RESTORE.txt" echo   1. Close Bloom Cafe POS.
>>"%DEST%\HOW-TO-RESTORE.txt" echo   2. Press Windows+R, type %%APPDATA%%\bloom-cafe-pos and press Enter.
>>"%DEST%\HOW-TO-RESTORE.txt" echo   3. Copy everything from this backup's "bloom-cafe-pos" folder into that
>>"%DEST%\HOW-TO-RESTORE.txt" echo      folder and choose "Replace the files".
>>"%DEST%\HOW-TO-RESTORE.txt" echo   4. Open Bloom Cafe POS.

call :say "      Backup finished."
if defined AUTO goto done_ok
start "" explorer "%DEST%"
call :say ""
pause
goto done_ok

:err_dest
call :say "      ERROR: could not create the backup folder on the Desktop."
goto done_fail

:err_copy
call :say "      ERROR: some files could not be copied - see the robocopy lines in the log."
goto done_fail

:done_fail
if not defined AUTO pause
exit /b 1

:done_ok
exit /b 0


rem ==========================================================================
rem  Helpers
rem ==========================================================================

:say
echo(%~1
>>"%LOG%" echo(%~1
exit /b 0

rem copy_folder SOURCE TARGET - robocopy exit codes 0-7 mean success.
:copy_folder
if not exist "%~1\" exit /b 0
>>"%LOG%" echo ===== robocopy "%~1" =====
rem Skips Chromium caches and the browser files it keeps locked while running.
robocopy "%~1" "%~2" /E /COPY:DAT /R:3 /W:2 /NP /NFL /NDL /XD "Cache" "Code Cache" "GPUCache" "DawnCache" "DawnGraphiteCache" "DawnWebGPUCache" "Crashpad" "Shared Dictionary" "Dictionaries" "blob_storage" "Service Worker" "Network" "Session Storage" "WebStorage" "SharedStorage" "shared_proto_db" /XF "lockfile" "LOCK" "*.tmp" >>"%LOG%" 2>&1
if errorlevel 8 set "COPY_FAILED=1"
exit /b 0

:is_app_running
tasklist /FI "IMAGENAME eq %APP_EXE%" /FO CSV /NH 2>nul | find /i "%APP_EXE%" >nul
exit /b %ERRORLEVEL%

:close_app
call :say "Closing Bloom Cafe POS..."
taskkill /IM "%APP_EXE%" >>"%LOG%" 2>&1
set /a CLOSE_TRIES=0
:close_app_wait
ping -n 2 127.0.0.1 >nul
call :is_app_running
if errorlevel 1 exit /b 0
set /a CLOSE_TRIES+=1
if %CLOSE_TRIES% LSS 15 goto close_app_wait
taskkill /F /T /IM "%APP_EXE%" >>"%LOG%" 2>&1
ping -n 3 127.0.0.1 >nul
exit /b 0
