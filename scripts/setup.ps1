<#
.SYNOPSIS
  Checks the environment and installs Locator Studio dependencies.
.DESCRIPTION
  Safe to run repeatedly: it only installs when node_modules is missing or out of
  date, and never creates or modifies source files.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#>
. "$PSScriptRoot\common.ps1"

Write-Step 'Checking environment'
Enter-ProjectRoot
Assert-Node
Write-Ok "Project root: $ProjectRoot"

Write-Step 'Installing dependencies'
if (Test-DependenciesCurrent) {
    Write-Ok 'Dependencies already installed and up to date - skipping install.'
}
else {
    # npm ci gives a reproducible install from the lockfile; fall back to npm install without one.
    if (Test-Path -LiteralPath 'package-lock.json') { & npm ci } else { & npm install }
    if ($LASTEXITCODE -ne 0) { Exit-WithError "npm install failed (exit code $LASTEXITCODE). See the output above." }
}

Write-Step 'Verifying installed packages'
& npm ls --depth=0
if ($LASTEXITCODE -ne 0) {
    Exit-WithError 'Some dependencies are missing or invalid. Delete node_modules and re-run this script.'
}

Write-Host ''
Write-Host 'Setup complete. Next steps:' -ForegroundColor Green
Write-Host '  scripts\start.ps1   start development mode'
Write-Host '  scripts\build.ps1   create a production build in dist\'
Write-Host '  scripts\check.ps1   typecheck + build verification'
