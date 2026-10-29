<#
  CI only (windows-latest). Builds a "cafe laptop" folder the way the client has
  it today: a git clone that still contains the v1.2.x UPDATE.bat and is one
  commit behind the code under test. Running its UPDATE.bat then exercises the
  real upgrade path: old UPDATE.bat -> git pull -> new UPDATE.bat -> INSTALL.bat.

  Layout (all local, no network):
    <RUNNER_TEMP>\ci-staging      clone of the checkout, with two extra commits:
                                    C_old = code under test + v1.2.x UPDATE.bat
                                    C_new = C_old + current UPDATE.bat (== code under test)
    <RUNNER_TEMP>\ci-remote.git   bare "GitHub" with branch ci-under-test = C_new
    -Client                       clone of the bare repo, reset to C_old
#>
param(
  [Parameter(Mandatory)] [string] $Source,
  [Parameter(Mandatory)] [string] $Client
)
$ErrorActionPreference = 'Stop'

function Invoke-Git {
  & git @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed with exit code $LASTEXITCODE" }
}

# UPDATE.bat exactly as shipped in v1.2.x (commit 994f526), CRLF like the client's checkout.
$legacyUpdateBat = @(
  '@echo off'
  'title Bloom Cafe POS - Update'
  'cd /d "%~dp0"'
  'echo Downloading the latest version from GitHub...'
  'git pull'
  'if errorlevel 1 ('
  '  echo ERROR: git pull failed. Check the internet connection.'
  '  pause'
  '  exit /b 1'
  ')'
  'call "%~dp0INSTALL.bat"'
) -join "`r`n"
$legacyUpdateBat += "`r`n"

$branch  = 'ci-under-test'
$staging = Join-Path $env:RUNNER_TEMP 'ci-staging'
$remote  = Join-Path $env:RUNNER_TEMP 'ci-remote.git'
foreach ($dir in @($staging, $remote, $Client)) {
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
}
New-Item -ItemType Directory -Force -Path (Split-Path $Client) | Out-Null

Invoke-Git -C $Source branch -f $branch HEAD
Invoke-Git clone --quiet --branch $branch $Source $staging

$who = @('-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid')
[System.IO.File]::WriteAllText((Join-Path $staging 'UPDATE.bat'), $legacyUpdateBat, [System.Text.Encoding]::ASCII)
Invoke-Git -C $staging @who commit --quiet -am 'CI: client still on the v1.2.x UPDATE.bat'
Invoke-Git -C $staging checkout HEAD~1 -- UPDATE.bat
Invoke-Git -C $staging @who commit --quiet -am 'CI: update to the version under test'

Invoke-Git clone --quiet --bare $staging $remote
Invoke-Git clone --quiet --branch $branch $remote $Client
Invoke-Git -C $Client reset --quiet --hard HEAD~1

# Sanity checks: the client really has the old file, byte for byte, and a clean tree.
$onDisk = [System.IO.File]::ReadAllBytes((Join-Path $Client 'UPDATE.bat'))
if ($onDisk.Length -ne 251) { throw "Legacy UPDATE.bat is $($onDisk.Length) bytes, expected 251 (CRLF)" }
$status = & git -C $Client status --porcelain
if ($status) { throw "Client working tree is not clean:`n$status" }
$behind = & git -C $Client rev-list --count "HEAD..origin/$branch"
if ($behind -ne '1') { throw "Client should be 1 commit behind origin/$branch, is $behind" }

"CLIENT_DIR=$Client" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
Write-Host "Cafe-laptop folder ready at '$Client' (v1.2.x UPDATE.bat, 1 commit behind)."
