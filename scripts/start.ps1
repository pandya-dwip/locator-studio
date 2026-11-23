<#
.SYNOPSIS
  Starts Locator Studio in development mode (Vite + CRXJS with hot reload).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start.ps1
#>
. "$PSScriptRoot\common.ps1"

Enter-ProjectRoot
Assert-Node
Assert-Dependencies

$dist = Join-Path $ProjectRoot 'dist'
Write-Step 'Starting development mode'
Write-Host "  Dev server : http://localhost:5180 (serves modules to the extension; not a page to browse)"
Write-Host "  Extension  : load this folder unpacked in chrome://extensions -> $dist"
Write-Host "  Keep this window open while developing. Press Ctrl+C to stop."
Write-Host ''

& npm run dev
exit $LASTEXITCODE
