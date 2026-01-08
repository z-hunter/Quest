@echo off
echo ==========================================
echo       Quest Game Setup & Launcher
echo ==========================================
echo.

WHERE node >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo Error: Node.js is not installed or not in your PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b
)

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo Error: Failed to install dependencies.
        pause
        exit /b
    )
) else (
    echo Dependencies already installed.
)

echo.
echo Starting Development Server...
echo The game will open in your browser shortly.
echo Press Ctrl+C in this window to stop the server.
echo.

call npm run dev
pause
