@echo off
title Bloom Cafe POS - Update
cd /d "%~dp0"
echo Downloading the latest version from GitHub...
git pull
if errorlevel 1 (
  echo ERROR: git pull failed. Check the internet connection.
  pause
  exit /b 1
)
call "%~dp0INSTALL.bat"
