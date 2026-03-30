@echo off
echo ========================================
echo  Print Shop Tunnel Setup
echo ========================================
echo.
echo This script will:
echo 1. Start a Cloudflare tunnel for your PC app
echo 2. Extract the tunnel URL
echo 3. Update your .env file
echo.
echo Make sure the PC app is NOT running before continuing!
echo.
pause

cd /d "%~dp0pc-app"

echo.
echo Starting Cloudflare tunnel...
echo (This may take 10-15 seconds)
echo.

rem Start cloudflared and capture output
start "Cloudflare Tunnel" cloudflared tunnel --url http://localhost:8788 > cloudflared-quick.log 2>&1

rem Wait for tunnel to be created
timeout /t 15 /nobreak > nul

rem Try to extract the tunnel URL from the log
echo.
echo Checking for tunnel URL...
findstr /C:"https://" cloudflared-quick.log > tunnel-url.txt

if exist tunnel-url.txt (
    echo.
    echo ========================================
    echo  SUCCESS! Tunnel URL found
    echo ========================================
    type tunnel-url.txt
    echo.
    echo.
    echo IMPORTANT: Copy the URL above (the https://... line^)
    echo Then open the PC app and paste it in the "Upload Public URL" field
    echo.
    echo The tunnel is now running in the background.
    echo.
) else (
    echo.
    echo ERROR: Could not extract tunnel URL
    echo Please check cloudflared-quick.log for details
    echo.
)

pause
