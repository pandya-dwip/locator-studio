<#
.SYNOPSIS
  Runs TypeScript checks, unit tests and the production build. Exits non-zero on any failure.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\check.ps1
#>
. "$PSScriptRoot\common.ps1"

Enter-ProjectRoot
Assert-Node
Assert-Dependencies

Write-Step 'TypeScript check'
& npm run typecheck
if ($LASTEXITCODE -ne 0) { Exit-WithError 'TypeScript check failed.' }
Write-Ok 'No type errors'

Write-Step 'Unit tests'
& npm run test
if ($LASTEXITCODE -ne 0) { Exit-WithError 'Unit tests failed.' }

Write-Step 'Production build'
& npm run build
if ($LASTEXITCODE -ne 0) { Exit-WithError 'Production build failed.' }

Write-Step 'Verifying build output'
$problems = Test-BuildOutput
if ($problems.Count -gt 0) { $problems | ForEach-Object { Write-Host "  ERROR  $_" -ForegroundColor Red }; exit 1 }

Write-Host ''
Write-Host 'All checks passed.' -ForegroundColor Green
exit 0
