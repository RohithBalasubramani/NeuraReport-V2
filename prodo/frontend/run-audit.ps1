$env:BASE_URL = "http://127.0.0.1:5174"
Set-Location "c:\Users\Alfred\NeuraReport\frontend"

Write-Host "Starting semantic verification audit on all 2,534 actions..."
Write-Host "This will take approximately 30-40 minutes."
Write-Host ""

npx playwright test tests\e2e\audit-semantic-verification.spec.ts --reporter=list

Write-Host ""
Write-Host "Audit complete! Check results at:"
Write-Host "  tests\e2e\evidence\semantic-audit\ledger\ACTION-RESOLUTION-LEDGER.json"
