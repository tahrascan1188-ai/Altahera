@echo off
title Altahera Management System Launcher
cd /d "%~dp0"

echo ===================================================
echo   Altahera Central Receptionist System Launcher
echo ===================================================
echo.

echo [1/3] Checking dependencies...
if not exist node_modules (
    echo [!] node_modules folder not found. Installing dependencies, please wait...
    call npm install
) else (
    echo [OK] Dependencies are already installed.
)
echo.

echo [2/3] Launching web browser...
start "" http://localhost:3000
echo.

echo [3/3] Starting Node.js server...
node server.js
pause
