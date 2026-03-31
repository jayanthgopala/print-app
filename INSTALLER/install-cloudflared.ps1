# Cloudflared Quick Install Script
# Run this in PowerShell as Administrator

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Cloudflared Installation Script" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[1/4] Checking if cloudflared is already installed..." -ForegroundColor Yellow
$existing = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "✓ Cloudflared is already installed!" -ForegroundColor Green
    cloudflared --version
    Write-Host ""
    Write-Host "Installation complete. You can now use the PC app." -ForegroundColor Green
    Read-Host "Press Enter to exit"
    exit 0
}

Write-Host "[2/4] Creating temp directory..." -ForegroundColor Yellow
$tempDir = "$env:TEMP\cloudflared-install"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}
Set-Location $tempDir

Write-Host "[3/4] Downloading cloudflared..." -ForegroundColor Yellow
Write-Host "This may take a minute depending on your internet speed..." -ForegroundColor Gray
Write-Host ""

$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
$output = "$tempDir\cloudflared.exe"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $output -UseBasicParsing
    
    if (-not (Test-Path $output)) {
        throw "Download failed"
    }
    
    Write-Host "✓ Downloaded successfully" -ForegroundColor Green
    Write-Host ""
    
} catch {
    Write-Host "✗ ERROR: Failed to download cloudflared" -ForegroundColor Red
    Write-Host "Please check your internet connection and try again" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You can also download manually from:" -ForegroundColor Yellow
    Write-Host $url -ForegroundColor Cyan
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[4/4] Installing cloudflared to System32..." -ForegroundColor Yellow

try {
    $destination = "C:\Windows\System32\cloudflared.exe"
    Copy-Item -Path $output -Destination $destination -Force
    
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Green
    Write-Host " Installation Complete!" -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Verifying installation..." -ForegroundColor Yellow
    cloudflared --version
    Write-Host ""
    Write-Host "✓ Cloudflared has been successfully installed." -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now use the PC Print Console app." -ForegroundColor Green
    Write-Host "The tunnel will start automatically when you" -ForegroundColor Green
    Write-Host "click 'Save and Connect' in the app." -ForegroundColor Green
    Write-Host ""
    
} catch {
    Write-Host "✗ ERROR: Failed to install cloudflared to System32" -ForegroundColor Red
    Write-Host "Please make sure you are running as Administrator" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Read-Host "Press Enter to exit"
