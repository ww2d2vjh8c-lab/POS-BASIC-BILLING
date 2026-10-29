; Custom NSIS hooks for the Bloom Cafe POS installer and uninstaller.
; electron-builder picks this file up automatically (build/installer.nsh).

; Closes every Bloom Cafe POS process of this Windows user (main window and
; helper processes) and waits until all of them have exited, so the old
; version's files are free when it is replaced or removed.
;
; Replaces electron-builder's built-in check, which only waited for the main
; process: with the app open, the old version's uninstaller then failed and
; the silent installer waited forever on an "uninstall failed" message box.
!macro customCheckAppRunning
  !insertmacro bcpWaitForAppExit 1
  ${If} $R0 == 0
    ; Someone double-clicked the installer while the till is open: ask first,
    ; like the built-in check did. Silent installs (INSTALL.bat) go ahead.
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
    Quit

    ; 1. Ask the app to close. It saves the open tables and takes a final backup.
    DetailPrint `Closing "${PRODUCT_NAME}"...`
    nsExec::Exec `$SYSDIR\cmd.exe /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
    Pop $R0
    !insertmacro bcpWaitForAppExit 20

    ; 2. Anything still running after 10 seconds is force-closed, helpers included.
    ${If} $R0 == 0
      nsExec::Exec `$SYSDIR\cmd.exe /c taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
      Pop $R0
      !insertmacro bcpWaitForAppExit 20
    ${EndIf}

    ; 3. Give Windows a moment to release the file handles.
    Sleep 1000
  ${EndIf}
!macroend

; Checks up to TRIES times, 0.5 s apart, whether the app is still running.
; Leaves $R0 = 0 if it is still running, non-zero once it has exited.
!macro bcpWaitForAppExit TRIES
  StrCpy $R1 0
  ${Do}
    nsExec::Exec `$SYSDIR\cmd.exe /c tasklist /fi "USERNAME eq %USERNAME%" /fi "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /fo csv | $SYSDIR\find.exe /i "${APP_EXECUTABLE_FILENAME}"`
    Pop $R0
    ${If} $R0 != 0
      ${Break}
    ${EndIf}
    IntOp $R1 $R1 + 1
    Sleep 500
  ${LoopUntil} $R1 >= ${TRIES}
!macroend

; If the old version's uninstaller could not run or reported an error, install
; over it instead of stopping: the new files replace the old ones (the copy
; step retries locked files itself) and the data in %APPDATA% is never touched.
; The built-in handler showed a message box with no silent-mode default here,
; which hung silent installs.
!macro bcpHandleOldUninstall
  ${If} ${Errors}
    DetailPrint `Could not start the previous version's uninstaller - installing over it.`
  ${ElseIf} $R0 != 0
    DetailPrint `The previous version did not uninstall cleanly (code $R0) - installing over it.`
  ${EndIf}
  ClearErrors
!macroend

!macro customUnInstallCheck
  !insertmacro bcpHandleOldUninstall
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro bcpHandleOldUninstall
!macroend
