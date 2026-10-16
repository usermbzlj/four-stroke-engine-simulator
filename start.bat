@echo off
chcp 65001 >nul 2>&1
title 4-Stroke Engine Simulator
cd /d "%~dp0"

if not exist node_modules (
    echo [*] First run: installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [!] Install failed. Please check that Node.js is installed.
        pause
        exit /b 1
    )
)

echo [*] Dev server: http://localhost:3000  (Ctrl+C to stop)
call npm run dev -- --open
