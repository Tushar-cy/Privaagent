# Privaagent — One-Click Demonstration & Evaluation Launcher
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   PRIVAAGENT (SIH26171) — ONE-CLICK DEMO LAUNCHER" -ForegroundColor Cyan
Write-Host "   On-device Visual Perception for Light-weight Browser Agents" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

# 1. Build Extension Bundle if needed
Write-Host "[1/3] Checking Chrome Extension Build..." -ForegroundColor Yellow
Set-Location "$ROOT\extension"
if (-not (Test-Path "dist\manifest.json")) {
    Write-Host "Building extension bundle..." -ForegroundColor Gray
    npm.cmd run build
} else {
    Write-Host "Extension bundle ready at: extension\dist\" -ForegroundColor Green
}

# 2. Package Zip Archive
Set-Location $ROOT
Compress-Archive -Path "extension\dist\*" -DestinationPath "privaagent-extension.zip" -Force
Write-Host "Packaged distributable extension: privaagent-extension.zip" -ForegroundColor Green

# 3. Start Backend Server
Write-Host ""
Write-Host "[2/3] Starting Privaagent Minimum-Disclosure Core Server..." -ForegroundColor Yellow
$PythonExe = "$ROOT\server\venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $PythonExe) {
        Write-Host "Python not found! Please install Python or run setup first." -ForegroundColor Red
        exit 1
    }
    Write-Host "Using system Python: $PythonExe" -ForegroundColor Gray
}

$ServerProcess = Start-Process -FilePath $PythonExe -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8000" -WorkingDirectory "$ROOT\server" -PassThru -NoNewWindow
Start-Sleep -Seconds 2

# 4. Open Demo in Browser
Write-Host ""
Write-Host "[3/3] Launching Demonstration Showcase Portal..." -ForegroundColor Yellow
$DemoUrl = "http://127.0.0.1:8000/demo/index.html"
Start-Process $DemoUrl

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "   DEMO RUNNING AT: $DemoUrl" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "To test with the Chrome Extension:" -ForegroundColor Gray
Write-Host "  1. Open Chrome -> navigate to chrome://extensions" -ForegroundColor Gray
Write-Host "  2. Enable 'Developer mode' (top right toggle)" -ForegroundColor Gray
Write-Host "  3. Click 'Load unpacked' -> select '$ROOT\privaagent-extension\'" -ForegroundColor Gray
Write-Host "  4. Open the extension popup or click on the demo page!" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor DarkGray

try {
    Wait-Process -Id $ServerProcess.Id
} finally {
    Stop-Process -Id $ServerProcess.Id -ErrorAction SilentlyContinue
}
