@echo off
echo ==================================================================
echo    PRIVAAGENT (SIH26171) -- UNIFIED TEST RUNNER
echo    On-device Visual Perception for Light-weight Browser Agents
echo ==================================================================
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0run-all-tests.ps1"

pause
