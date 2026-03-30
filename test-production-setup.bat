@echo off
echo ================================================
echo  Production Setup Test Script
echo  Tests automatic tunnel functionality
echo ================================================
echo.

echo [Step 1] Checking cloudflared installation...
cloudflared --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ❌ FAIL: Cloudflared not installed
    echo.
    echo Please run: INSTALLER\install-cloudflared.bat
    echo.
    pause
    exit /b 1
)
echo ✅ PASS: Cloudflared is installed
cloudflared --version
echo.

echo [Step 2] Checking Node.js installation...
node --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ❌ FAIL: Node.js not installed
    echo.
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)
echo ✅ PASS: Node.js is installed
node --version
echo.

echo [Step 3] Checking backend API...
echo Testing: https://print-app-backend.jayanthgopala21.workers.dev/health
curl -s https://print-app-backend.jayanthgopala21.workers.dev/health
if %errorLevel% neq 0 (
    echo ❌ FAIL: Backend API not reachable
    echo.
    pause
    exit /b 1
)
echo ✅ PASS: Backend API is reachable
echo.

echo [Step 4] Checking shop status in database...
node check-shop-status.js
echo.

echo [Step 5] Checking frontend...
echo Frontend URL: https://print-app-87r.pages.dev/?shop=SHOP001
echo Open this URL in your browser to verify
echo.

echo ================================================
echo  Test Summary
echo ================================================
echo.
echo ✅ Cloudflared: Installed
echo ✅ Node.js: Installed
echo ✅ Backend API: Reachable
echo.
echo Next steps:
echo 1. Open the PC app
echo 2. Enter shop code: SHOP001
echo 3. Enter password
echo 4. Click "Save and Connect"
echo 5. Watch for "Online (Auto-tunnel active)"
echo 6. Open frontend URL above
echo 7. Verify "Shop is online"
echo.
pause
