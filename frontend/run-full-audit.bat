@echo off
cd /d c:\Users\Alfred\NeuraReport\frontend
set BASE_URL=http://127.0.0.1:5174
echo Starting full semantic verification audit...
echo BASE_URL: %BASE_URL%
echo.
npx playwright test tests/e2e/audit-semantic-verification.spec.ts --reporter=list
echo.
echo Audit complete!
pause
