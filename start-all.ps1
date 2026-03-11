Write-Host "Starting Print Shop Application..." -ForegroundColor Green

# 1. Install Dependencies if missing
if (-not (Test-Path "backend\node_modules")) {
    Write-Host "Installing Backend Dependencies..."
    cd backend
    npm install
    cd ..
}

if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "Installing Frontend Dependencies..."
    cd frontend
    npm install
    cd ..
}

if (-not (Test-Path "pc-app\node_modules")) {
    Write-Host "Installing PC App Dependencies..."
    cd pc-app
    npm install
    cd ..
}

# 2. Start Backend
Write-Host "Starting Backend Server..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; npm start"

# 3. Start Frontend
Write-Host "Starting Frontend..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

# 4. Start PC App
Write-Host "Starting PC App..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd pc-app; npm start"

Write-Host "All services started in new windows!" -ForegroundColor Cyan
