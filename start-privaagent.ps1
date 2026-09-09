# Privaagent (SIH26171) - One-Click Launcher for PowerShell
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   PRIVAAGENT (SIH26171) -- ONE-CLICK AUTOMATED LAUNCHER" -ForegroundColor Cyan
Write-Host "   On-Device Visual Perception for Light-Weight Browser Agents" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Verify Extension Build
$manifestPath = Join-Path $ROOT "extension\dist\manifest.json"
if (-not (Test-Path $manifestPath)) {
    Write-Host "[1/3] Building Chrome MV3 Extension..." -ForegroundColor Yellow
    Set-Location (Join-Path $ROOT "extension")
    npm.cmd run build
    Set-Location $ROOT
} else {
    Write-Host "[1/3] Extension build verified at: $ROOT\extension\dist" -ForegroundColor Green
}

# 2. Check and Launch FastAPI Backend
Write-Host "[2/3] Checking FastAPI Backend server on http://127.0.0.1:8000..." -ForegroundColor Yellow
$serverOnline = $false
try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2 -UseBasicParsing
    if ($res.StatusCode -eq 200) { $serverOnline = $true }
} catch {}

if (-not $serverOnline) {
    Write-Host "      Starting FastAPI Backend server in background..." -ForegroundColor Gray
    $pythonExe = Join-Path $ROOT "server\venv\Scripts\python.exe"
    if (-not (Test-Path $pythonExe)) { $pythonExe = "python" }
    
    Start-Process -FilePath $pythonExe -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8000" -WorkingDirectory (Join-Path $ROOT "server") -WindowStyle Minimized
    
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $check = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -TimeoutSec 1 -UseBasicParsing
            if ($check.StatusCode -eq 200) { $serverOnline = $true; break }
        } catch {}
    }
}

if ($serverOnline) {
    Write-Host "      FastAPI Backend is online and healthy!" -ForegroundColor Green
} else {
    Write-Host "      [WARNING] Server startup timed out. Proceeding to launch browser." -ForegroundColor Red
}

# 3. Find Chrome and launch
Write-Host "[3/3] Locating browser executable and pre-loading extension..." -ForegroundColor Yellow
$candidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)

$browserExe = $null
foreach ($c in $candidates) {
    if (Test-Path $c) { $browserExe = $c; break }
}

$extPath = Join-Path $ROOT "extension\dist"
$demoUrl = "http://127.0.0.1:8000/demo/index.html"

if ($browserExe) {
    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Green
    Write-Host " SUCCESS! Launching browser with Privaagent extension pre-loaded." -ForegroundColor Green
    Write-Host " Extension Path: $extPath" -ForegroundColor Gray
    Write-Host " Demo Portal:    $demoUrl" -ForegroundColor Gray
    Write-Host "==================================================================" -ForegroundColor Green
    Start-Process -FilePath $browserExe -ArgumentList "--load-extension=`"$extPath`"", "`"$demoUrl`""
} else {
    Write-Host "[WARNING] Could not find Chrome or Edge automatically." -ForegroundColor Red
    Write-Host "Please open your browser to: chrome://extensions/" -ForegroundColor Yellow
    Write-Host "Enable Developer Mode -> Click 'Load unpacked' -> Select: $extPath" -ForegroundColor Yellow
}
