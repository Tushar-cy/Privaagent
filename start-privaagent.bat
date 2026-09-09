@echo off
setlocal enabledelayedexpansion

echo ==================================================================
echo    PRIVAAGENT (SIH26171) -- ONE-CLICK AUTOMATED LAUNCHER
echo    On-Device Visual Perception for Light-Weight Browser Agents
echo ==================================================================
echo.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

:: 1. Verify Extension Build
if not exist "%ROOT%\extension\dist\manifest.json" (
    echo [1/3] Building Chrome MV3 Extension...
    cd /d "%ROOT%\extension"
    call npm.cmd run build
    if errorlevel 1 (
        echo [ERROR] Failed to build extension!
        pause
        exit /b 1
    )
    cd /d "%ROOT%"
) else (
    echo [1/3] Extension build verified at: %ROOT%\extension\dist
)

:: 2. Launch FastAPI Backend Server (if not already running)
echo [2/3] Checking FastAPI Backend server on http://127.0.0.1:8000...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo       Starting FastAPI Backend server in background...
    if exist "%ROOT%\server\venv\Scripts\python.exe" (
        start "Privaagent Backend Server" /min "%ROOT%\server\venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
    ) else (
        start "Privaagent Backend Server" /min python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
    )
    echo       Waiting for server to become healthy...
    powershell -Command "for ($i=0; $i -lt 20; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 1 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
) else (
    echo       Server is already running and healthy!
)

:: 3. Launch Chrome with Extension Pre-Loaded
echo [3/3] Locating browser executable and pre-loading extension...

set "CHROME_EXE="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "CHROME_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)

if defined CHROME_EXE (
    echo.
    echo ==================================================================
    echo  SUCCESS! Launching browser with Privaagent extension pre-loaded.
    echo  Extension Path: %ROOT%\privaagent-extension
    echo  Demo Portal:    http://127.0.0.1:8000/demo/index.html
    echo ==================================================================
    start "" "!CHROME_EXE!" --load-extension="%ROOT%\privaagent-extension" "http://127.0.0.1:8000/demo/index.html"
) else (
    echo [WARNING] Could not automatically find Chrome or Edge.
    echo Please manually open your browser to: chrome://extensions/
    echo Enable Developer Mode, click 'Load unpacked', and select:
    echo %ROOT%\privaagent-extension
    echo Then visit: http://127.0.0.1:8000/demo/index.html
)

echo.
echo Press any key to exit this launcher window (server remains active).
pause >nul
