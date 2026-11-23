# Shared helpers for the Locator Studio scripts. Dot-source it: . "$PSScriptRoot\common.ps1"
# Compatible with Windows PowerShell 5.1 and PowerShell 7+.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$MinNode = 'Node.js ^22.12.0 or >=24.0.0 (LTS recommended)'
$NodeDownload = 'https://nodejs.org/en/download'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "  OK  $Message" -ForegroundColor Green }
function Exit-WithError([string]$Message) {
    Write-Host "  ERROR  $Message" -ForegroundColor Red
    exit 1
}

# Run all commands from the project root regardless of the caller's location.
function Enter-ProjectRoot {
    Set-Location -LiteralPath $ProjectRoot
    if (-not (Test-Path -LiteralPath 'package.json')) {
        Exit-WithError "package.json not found in $ProjectRoot."
    }
}

function Assert-Node {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Exit-WithError "Node.js is not installed or not on PATH. Install $MinNode from $NodeDownload and reopen the terminal."
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Exit-WithError "npm is not on PATH. Reinstall Node.js from $NodeDownload (npm ships with it)."
    }
    $raw = (& node -v).Trim()
    $version = [version]$raw.TrimStart('v')
    $supported = ($version -ge [version]'24.0.0') -or ($version.Major -eq 22 -and $version -ge [version]'22.12.0')
    if (-not $supported) {
        Exit-WithError "Node.js $raw is not supported. Required: $MinNode. Download: $NodeDownload"
    }
    Write-Ok "Node.js $raw, npm $((& npm -v).Trim())"
}

# True when node_modules exists and is at least as new as package.json / package-lock.json.
function Test-DependenciesCurrent {
    $marker = 'node_modules/.package-lock.json'
    if (-not (Test-Path -LiteralPath $marker)) { return $false }
    $installed = (Get-Item -LiteralPath $marker).LastWriteTime
    foreach ($f in 'package.json', 'package-lock.json') {
        if ((Test-Path -LiteralPath $f) -and (Get-Item -LiteralPath $f).LastWriteTime -gt $installed) { return $false }
    }
    return $true
}

function Assert-Dependencies {
    if (-not (Test-Path -Path 'node_modules/.bin/vite*')) {
        Exit-WithError "Dependencies are not installed. Run: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1"
    }
    if (-not (Test-DependenciesCurrent)) {
        Write-Host "  WARN  package.json changed since the last install. Consider re-running scripts\setup.ps1." -ForegroundColor Yellow
    }
}

# Checks that the build produced a loadable extension. Returns a list of problems.
function Test-BuildOutput {
    $dist = Join-Path $ProjectRoot 'dist'
    $problems = @()
    $manifestPath = Join-Path $dist 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { return @("dist/manifest.json is missing") }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.manifest_version -ne 3) { $problems += 'manifest_version is not 3' }

    $required = @{
        'popup (action.default_popup)'           = $manifest.action.default_popup
        'background (background.service_worker)' = $manifest.background.service_worker
        'workspace page'                         = 'workspace.html'
        'content script (injected on demand)'    = 'src/content/index.js'
    }
    foreach ($entry in $required.GetEnumerator()) {
        if (-not $entry.Value) { $problems += "$($entry.Key) is not set in the manifest"; continue }
        if (Test-Path -LiteralPath (Join-Path $dist $entry.Value)) { Write-Ok "$($entry.Key): $($entry.Value)" }
        else { $problems += "$($entry.Key) file missing: $($entry.Value)" }
    }
    return $problems
}
