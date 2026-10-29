@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Bloom Cafe POS - Back up data

rem ==========================================================================
rem  Bloom Cafe POS - copy all sales data to a dated folder on the Desktop.
rem
rem  Double-click:              asks to close the app first (needed for an
rem                             exact copy of the live database), then opens
rem                             the backup folder when it is done.
rem  BACKUP-DATA.bat /auto LOG  used by INSTALL.bat: closes the app if it is
rem                             still open, no questions, no pause, also
rem                             writes to the given log file.
rem
rem  The app keeps its data in %APPDATA%\bloom-cafe-pos: the live database,
rem  menu, settings, logs, and its own verified snapshots in backups\ (made
rem  with VACUUM INTO, so they are always consistent). Browser caches are
rem  skipped. Backups on the Desktop are never deleted automatically.
rem
rem  The live database (bloom-cafe.db + -wal/-shm) is only copied while the
rem  app is closed. If you choose to keep the app open, the backup still has
rem  the app's latest snapshot from backups\ and HOW-TO-RESTORE.txt says so.
rem ==========================================================================

set "APP_EXE=Bloom Cafe POS.exe"
set "AUTO="
if /i "%~1"=="/auto" set "AUTO=1"
set "LOG=%~2"
if not defined LOG set "LOG=nul"
set "LIVE_DB=1"

rem Data folders: Electron's userData comes from package.json "name".
set "HAS_DATA="
if exist "%APPDATA%\bloom-cafe-pos\" set "HAS_DATA=1"
if exist "%APPDATA%\Bloom Cafe POS\" set "HAS_DATA=1"
if defined HAS_DATA goto have_data
call :say "      No Bloom Cafe POS data on this PC yet - nothing to back up."
goto done_ok

:have_data
if not defined AUTO goto ask_close
call :is_app_running
if errorlevel 1 goto copy
call :close_app
call :is_app_running
if errorlevel 1 goto copy
set "LIVE_DB="
goto copy

:ask_close
call :say "============================================"
call :say "  Bloom Cafe POS - Back up data"
call :say "============================================"
call :say ""
call :is_app_running
if errorlevel 1 goto copy
call :say "Bloom Cafe POS is open. For an exact copy of today's sales it must"
call :say "be closed. Open tables are saved and come back when you reopen it."
choice /C YN /N /M "Close Bloom Cafe POS now? [Y/N] "
if errorlevel 2 goto keep_open
call :close_app
call :is_app_running
if errorlevel 1 goto copy
:keep_open
set "LIVE_DB="
call :say "OK - the app stays open. The backup will use the app's own latest"
call :say "automatic snapshot of the sales database instead of the live file."
call :say ""

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
if not defined LIVE_DB goto check_snapshots
if exist "%APPDATA%\bloom-cafe-pos\bloom-cafe.db" if not exist "%DEST%\bloom-cafe-pos\bloom-cafe.db" goto err_copy
goto write_readme
:check_snapshots
if exist "%APPDATA%\bloom-cafe-pos\backups\" if not exist "%DEST%\bloom-cafe-pos\backups\" goto err_copy

:write_readme
> "%DEST%\HOW-TO-RESTORE.txt" echo Bloom Cafe POS backup made %DATE% %TIME% on %COMPUTERNAME%.
>>"%DEST%\HOW-TO-RESTORE.txt" echo.
if defined LIVE_DB goto readme_steps
>>"%DEST%\HOW-TO-RESTORE.txt" echo NOTE: Bloom Cafe POS was open, so the live database was not copied.
>>"%DEST%\HOW-TO-RESTORE.txt" echo The sales database to restore is the newest one in bloom-cafe-pos\backups\:
>>"%DEST%\HOW-TO-RESTORE.txt" echo copy backups\[newest date]\bloom-cafe.db up into bloom-cafe-pos\ first.
>>"%DEST%\HOW-TO-RESTORE.txt" echo.
:readme_steps
>>"%DEST%\HOW-TO-RESTORE.txt" echo To restore it:
>>"%DEST%\HOW-TO-RESTORE.txt" echo   1. Close Bloom Cafe POS.
>>"%DEST%\HOW-TO-RESTORE.txt" echo   2. Press Windows+R, type %%APPDATA%%\bloom-cafe-pos and press Enter.
>>"%DEST%\HOW-TO-RESTORE.txt" echo   3. Delete bloom-cafe.db-wal and bloom-cafe.db-shm there if they exist.
>>"%DEST%\HOW-TO-RESTORE.txt" echo   4. Copy everything from this backup's "bloom-cafe-pos" folder into that
>>"%DEST%\HOW-TO-RESTORE.txt" echo      folder and choose "Replace the files".
>>"%DEST%\HOW-TO-RESTORE.txt" echo   5. Open Bloom Cafe POS.

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
rem Skips Chromium caches and the browser files it keeps locked while running.
rem Without LIVE_DB the live database files are skipped everywhere, then the
rem app's consistent snapshots in backups\ are copied in a second pass.
:copy_folder
if not exist "%~1\" exit /b 0
set "SKIP_DB="
if not defined LIVE_DB set "SKIP_DB=bloom-cafe.db*"
>>"%LOG%" echo ===== robocopy "%~1" =====
robocopy "%~1" "%~2" /E /COPY:DAT /R:3 /W:2 /NP /NFL /NDL /XD "Cache" "Code Cache" "GPUCache" "DawnCache" "DawnGraphiteCache" "DawnWebGPUCache" "Crashpad" "Shared Dictionary" "Dictionaries" "blob_storage" "Service Worker" "Network" "Session Storage" "WebStorage" "SharedStorage" "shared_proto_db" /XF "lockfile" "LOCK" "*.tmp" %SKIP_DB% >>"%LOG%" 2>&1
if errorlevel 8 set "COPY_FAILED=1"
if defined LIVE_DB exit /b 0
if not exist "%~1\backups\" exit /b 0
>>"%LOG%" echo ===== robocopy "%~1\backups" (app snapshots) =====
robocopy "%~1\backups" "%~2\backups" /E /COPY:DAT /R:3 /W:2 /NP /NFL /NDL /XF "*.tmp" >>"%LOG%" 2>&1
if errorlevel 8 set "COPY_FAILED=1"
exit /b 0

:is_app_running
tasklist /FI "IMAGENAME eq %APP_EXE%" /FO CSV /NH 2>nul | find /i "%APP_EXE%" >nul
exit /b %ERRORLEVEL%

rem Close Bloom Cafe POS politely (it checkpoints and closes its database), force it if needed.
:close_app
call :say "      Closing Bloom Cafe POS (open tables are saved)..."
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
