@echo off
chcp 65001 >nul 2>&1
title 4-Stroke Engine Simulator

echo.
echo  ========================================
echo   4-Stroke Engine Physics Simulator
echo   Starting up...
echo  ========================================
echo.

cd /d "%~dp0"

if not exist node_modules (
    echo [*] First run detected, installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [!] Dependency install failed. Please check Node.js is installed.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed.
    echo.
)

echo [*] Launching dev server at http://localhost:3000 ...
echo [*] Browser will open automatically in 3 seconds...
echo [*] Press Ctrl+C to stop the server.
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

call npx vite --port=3000 --host=0.0.0.0 --open
