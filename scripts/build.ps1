<#
.SYNOPSIS
  Creates a production build of Locator Studio in dist\.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#>
. "$PSScriptRoot\common.ps1"

Enter-ProjectRoot
Assert-Node
Assert-Dependencies

Write-Step 'Building production extension'
& npm run build
if ($LASTEXITCODE -ne 0) { Exit-WithError "Build failed (exit code $LASTEXITCODE). See the errors above." }

Write-Step 'Verifying build output'
$problems = Test-BuildOutput
if ($problems.Count -gt 0) { $problems | ForEach-Object { Write-Host "  ERROR  $_" -ForegroundColor Red }; exit 1 }

Write-Host ''
Write-Host "Build succeeded. Output directory: $(Join-Path $ProjectRoot 'dist')" -ForegroundColor Green
