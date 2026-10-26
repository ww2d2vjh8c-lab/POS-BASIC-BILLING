<#
  CI only (windows-latest). Run after UPDATE.bat / INSTALL.bat installed the app
  from the folder given as -Repo. Checks what only a real Windows machine can:

    1. per-user install location + the registry values INSTALL.bat relies on
    2. Desktop and Start menu shortcuts
    3. the installed app starts and creates its database in %APPDATA%\bloom-cafe-pos
       (better-sqlite3 loads from app.asar.unpacked, seed data from resources\data)
    4. BACKUP-DATA.bat /auto closes the running app and copies the data
       (live database + the app's own snapshots) to a dated Desktop folder
    5. re-running the installer silently while the app is open closes it,
       upgrades in place and keeps the data
    6. silent uninstall removes the app but keeps %APPDATA%\bloom-cafe-pos
#>
param(
  [Parameter(Mandatory)] [string] $Repo
)
$ErrorActionPreference = 'Stop'

$Guid       = '3186cf90-cde4-54e2-a777-cb2654a587ae'   # UUIDv5 of appId com.bloomcafe.pos
$ProcName   = 'Bloom Cafe POS'
$Version    = (Get-Content -Raw (Join-Path $Repo 'package.json') | ConvertFrom-Json).version
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Bloom Cafe POS'
$Exe        = Join-Path $InstallDir 'Bloom Cafe POS.exe'
$DataDir    = Join-Path $env:APPDATA 'bloom-cafe-pos'
$Db         = Join-Path $DataDir 'bloom-cafe.db'
$Desktop    = [Environment]::GetFolderPath('Desktop')
$LogsOut    = Join-Path $env:RUNNER_TEMP 'ci-logs'
New-Item -ItemType Directory -Force -Path $LogsOut | Out-Null

$script:failed = 0
function Check([bool] $ok, [string] $what) {
  if ($ok) { Write-Host "PASS  $what" } else { Write-Host "FAIL  $what" -ForegroundColor Red; $script:failed++ }
}
function Wait-Until([scriptblock] $condition, [int] $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $condition) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return [bool](& $condition)
}
function Get-App { Get-Process -Name $ProcName -ErrorAction SilentlyContinue }
function Read-Reg([string] $path, [string] $name) {
  $item = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue
  if ($item) { return $item.$name } else { return $null }
}

Write-Host "== Checking Bloom Cafe POS $Version installed from '$Repo'"

# 1. Install location and registry -------------------------------------------
Check (Test-Path $Exe) "installed per-user at $Exe"
$location = Read-Reg "HKCU:\Software\$Guid" 'InstallLocation'
Check ($location -eq $InstallDir) "registry InstallLocation is '$InstallDir' (got '$location')"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Guid"
$shownVersion = Read-Reg $uninstallKey 'DisplayVersion'
Check ($shownVersion -eq $Version) "Add/Remove Programs shows version $Version (got '$shownVersion')"
Check ((Read-Reg $uninstallKey 'Publisher') -eq 'Ayush Kaushik') "Add/Remove Programs publisher"

$installLog = Join-Path $Repo 'install.log'
$logText = if (Test-Path $installLog) { Get-Content -Raw $installLog } else { '' }
Check ($logText -match "Installed version \(registry\): $([regex]::Escape($Version))") 'INSTALL.bat read the installed version from the registry'
Check ($logText -match "Installed exe: $([regex]::Escape($Exe))") 'INSTALL.bat found the installed exe'
Check ($logText -match 'Finished OK') 'INSTALL.bat finished OK'

# 2. Shortcuts -----------------------------------------------------------------
Check (Test-Path (Join-Path $Desktop 'Bloom Cafe POS.lnk')) 'Desktop shortcut'
Check (Test-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Bloom Cafe POS.lnk')) 'Start menu shortcut'

# 3. The installed app runs and creates its data --------------------------------
if (-not (Get-App)) {
  Write-Host 'App is not running (INSTALL.bat opens it) - starting it.'
  Start-Process -FilePath $Exe -WorkingDirectory $InstallDir
}
Check (Wait-Until { Test-Path $Db } 90) "installed app created its database at $Db"
Check (Test-Path (Join-Path $DataDir 'menu.json')) 'seed menu copied from resources\data'
Start-Sleep -Seconds 3

# 4. BACKUP-DATA.bat -------------------------------------------------------------
Push-Location $Repo
try {
  & cmd.exe /d /c BACKUP-DATA.bat /auto (Join-Path $LogsOut 'backup.log')
  $backupExit = $LASTEXITCODE
} finally { Pop-Location }
Check ($backupExit -eq 0) "BACKUP-DATA.bat /auto exit code 0 (got $backupExit)"
$latestBackup = Get-ChildItem (Join-Path $Desktop 'Bloom Cafe POS Backups') -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name | Select-Object -Last 1
Check ($null -ne $latestBackup -and (Test-Path (Join-Path $latestBackup.FullName 'bloom-cafe-pos\bloom-cafe.db'))) 'backup folder on the Desktop contains bloom-cafe.db'
Check ($null -ne $latestBackup -and (Test-Path (Join-Path $latestBackup.FullName 'bloom-cafe-pos\backups'))) "backup folder contains the app's own snapshots (backups\)"
Check ($null -ne $latestBackup -and (Test-Path (Join-Path $latestBackup.FullName 'HOW-TO-RESTORE.txt'))) 'backup folder contains HOW-TO-RESTORE.txt'
Check (-not (Get-App)) 'BACKUP-DATA.bat /auto closed the app before copying'

# 5. Upgrade while the app is open ------------------------------------------------
if (-not (Get-App)) { Start-Process -FilePath $Exe -WorkingDirectory $InstallDir }
Check ([bool](Wait-Until { Get-App } 30)) 'app running before re-install'
$setup = Get-ChildItem (Join-Path $Repo 'dist') -Filter 'Bloom-Cafe-POS-Setup-*.exe' | Select-Object -First 1
Check ($null -ne $setup) 'versioned installer Bloom-Cafe-POS-Setup-<version>.exe in dist'
if ($setup) {
  $p = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait -PassThru
  Check ($p.ExitCode -eq 0) "silent re-install of $($setup.Name) with the app open exits 0 (got $($p.ExitCode))"
  Check (Test-Path $Exe) 'app still installed after re-install'
  Check (Test-Path $Db) 'database kept after re-install'
}

# 6. Uninstall keeps the data -------------------------------------------------------
Get-App | Stop-Process -Force -ErrorAction SilentlyContinue
$uninstaller = Join-Path $InstallDir 'Uninstall Bloom Cafe POS.exe'
Check (Test-Path $uninstaller) 'uninstaller present'
if (Test-Path $uninstaller) {
  # The NSIS uninstaller re-launches itself from %TEMP%, so poll for the result.
  Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
  Check (Wait-Until { -not (Test-Path $Exe) } 90) 'uninstall removed the app'
  Check (Wait-Until { -not (Test-Path $uninstallKey) } 30) 'uninstall removed the Add/Remove Programs entry'
  Check (Test-Path $Db) 'uninstall KEPT the sales database in %APPDATA%\bloom-cafe-pos'
}

# Keep the logs for the workflow artifact.
Copy-Item (Join-Path $Repo '*.log') $LogsOut -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $DataDir 'logs')) { Copy-Item (Join-Path $DataDir 'logs') (Join-Path $LogsOut 'app-logs') -Recurse -Force }

if ($script:failed -gt 0) {
  Write-Host "$($script:failed) check(s) failed." -ForegroundColor Red
  exit 1
}
Write-Host 'All installer checks passed.'
