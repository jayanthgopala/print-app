@echo off
echo ================================================
echo  Cloudflared Installation Script
echo  For Print Shop Manager PC App
echo ================================================
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo Right-click and select "Run as Administrator"
    echo.
    pause
    exit /b 1
)

echo [1/4] Checking if cloudflared is already installed...
cloudflared --version >nul 2>&1
if %errorLevel% equ 0 (
    echo Cloudflared is already installed!
    cloudflared --version
    echo.
    echo Installation complete. You can now use the PC app.
    pause
    exit /b 0
)

echo [2/4] Creating temp directory...
set TEMP_DIR=%TEMP%\cloudflared-install
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"
cd /d "%TEMP_DIR%"

echo [3/4] Downloading cloudflared...
echo This may take a minute depending on your internet speed...
echo.

powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'}"

if not exist "cloudflared.exe" (
    echo ERROR: Failed to download cloudflared
    echo Please check your internet connection and try again
    pause
    exit /b 1
)

echo [4/4] Installing cloudflared to System32...
move /Y "cloudflared.exe" "C:\Windows\System32\cloudflared.exe" >nul 2>&1

if %errorLevel% neq 0 (
    echo ERROR: Failed to move cloudflared to System32
    echo Please make sure you are running as Administrator
    pause
    exit /b 1
)

echo.
echo ================================================
echo  Installation Complete!
echo ================================================
echo.
echo Verifying installation...
cloudflared --version
echo.
echo Cloudflared has been successfully installed.
echo You can now use the PC Print Console app.
echo.
echo The tunnel will start automatically when you
echo click "Save and Connect" in the app.
echo.
pause
