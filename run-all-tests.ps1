# Privaagent (SIH26171) - Unified Automated Test and Benchmark Verification Runner
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   PRIVAAGENT (SIH26171) -- COMPLETE TEST AND BENCHMARK RUNNER" -ForegroundColor Cyan
Write-Host "   On-device Visual Perception for Light-weight Browser Agents" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

# Keep the local master runner aligned with CI: source checks and a fresh bundle
# must succeed before integration tests load extension/dist artifacts.
Write-Host ">>> Compiling and building extension bundles for integration tests" -ForegroundColor Yellow
Set-Location "$ROOT\extension"
npx.cmd tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Set-Location $ROOT
    Write-Host "[FAILED] TypeScript compilation" -ForegroundColor Red
    exit 1
}
npx.cmd vite build
if ($LASTEXITCODE -ne 0) {
    Set-Location $ROOT
    Write-Host "[FAILED] Extension bundle build" -ForegroundColor Red
    exit 1
}
Set-Location $ROOT

$suites = @(
    @{ Name = "1. DOM Perception and Execution"; Cmd = "npx.cmd tsx ..\tests\test_dom_perception.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "2. Privacy Engine and PII Detectors"; Cmd = "npx.cmd tsx ..\tests\test_privacy_engine.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "3. Local Vision and Multimodal Fusion"; Cmd = "npx.cmd tsx ..\tests\test_local_vision.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "4. Agent Local Solver and Minimum Disclosure"; Cmd = "npx.cmd tsx ..\tests\test_agent_and_backend.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "5. Action Validator and Security Shield"; Cmd = "npx.cmd tsx ..\tests\test_validator.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "6. Focused Security Regression Boundaries"; Cmd = "npx.cmd tsx ..\tests\test_security_regressions.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "7. Viewport HUD and privacy overlays"; Cmd = "npx.cmd tsx ..\tests\test_ui_and_overlays.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "8. Multi-Turn Autonomous Agent and Budget"; Cmd = "npx.cmd tsx ..\tests\test_multiturn_agent.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "9. Privacy Audit Vault"; Cmd = "npx.cmd tsx ..\tests\test_compliance_audit.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "10. Synthetic Replacer and Audit Vault"; Cmd = "npx.cmd tsx ..\tests\test_synthetic_replacer_and_audit_vault.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "11. Live HTTP Trust Boundary and Defense-in-Depth"; Cmd = "node ..\tests\test_live_http_end_to_end.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "12. Zero-Trust Red-Team Security & Invariants Suite"; Cmd = "npx.cmd tsx ..\tests\test_redteam_security.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "13. Internal 5-Metric Benchmark Harness"; Cmd = "npx.cmd tsx ..\benchmark\scripts\run-benchmark.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "14. FastAPI Backend Pytest Suite"; Cmd = ".\venv\Scripts\python.exe -m pytest -p no:cacheprovider ..\tests\test_backend_api.py ..\tests\test_backend_visual_contract.py ..\tests\test_request_size_limit.py ..\tests\test_contracts.py"; Dir = "$ROOT\server" },
    @{ Name = "15. Audit Dashboard Cryptographic Verification"; Cmd = "npx.cmd tsx ..\tests\test_audit_dashboard.mjs"; Dir = "$ROOT\extension" },
    @{ Name = "16. Screenshot Redaction Pixel Assertions"; Cmd = "node .\test-redaction-pixels.mjs"; Dir = "$ROOT\extension" }
)

$passed = 0
$total = $suites.Count

foreach ($s in $suites) {
    Write-Host "`n>>> Running: $($s.Name)" -ForegroundColor Yellow
    Set-Location $s.Dir
    Invoke-Expression $s.Cmd
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[PASSED] $($s.Name)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "[FAILED] $($s.Name)" -ForegroundColor Red
    }
}

Set-Location $ROOT

# Read the actual composite score from the benchmark report produced in suite 12
$reportPath = Join-Path $ROOT "benchmark\results\report.json"
$scoreDisplay = "(not available - suite 12 did not run or failed)"
if (Test-Path $reportPath) {
    try {
        $report = Get-Content $reportPath -Raw | ConvertFrom-Json
        $score  = [math]::Round($report.overallScore, 2)
        $scoreDisplay = "$score / 100.00"
    } catch {
        $scoreDisplay = "(could not parse report.json)"
    }
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
if ($passed -eq $total) {
    Write-Host "   TEST SUITE SUMMARY: $passed / $total SUITES PASSED" -ForegroundColor Green
} else {
    Write-Host "   TEST SUITE SUMMARY: $passed / $total SUITES PASSED" -ForegroundColor Red
}
Write-Host "   Internal composite score (from benchmark/results/report.json): $scoreDisplay" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Cyan

if ($passed -ne $total) {
    exit 1
}
