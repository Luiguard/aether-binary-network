<#
.SYNOPSIS
    🌐 Aether Binary Network – Zero-Friction Installer
.DESCRIPTION
    One-Click Deployment for the Binary Internet.
    Validates Node.js, installs dependencies, and launches the network node.
    No Docker, no containers, no build tools required.
#>

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  🌐 AETHER BINARY NETWORK – Das Binäre Internet" -ForegroundColor Cyan
Write-Host "  Zero-Friction Installer v1.0.0" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$deployPath = $PSScriptRoot

# 1. Validate Node.js
Write-Host "[1/4] Validating Node.js runtime..." -ForegroundColor White
try {
    $nodeVersion = node -v 2>&1
    Write-Host "  ✅ Node.js detected: $nodeVersion" -ForegroundColor Green
    
    $major = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($major -lt 18) {
        Write-Host "  ⚠️  Node.js 18+ required. Please upgrade." -ForegroundColor Red
        Write-Host "  📥 Download: https://nodejs.org/" -ForegroundColor Yellow
        Exit 1
    }
} catch {
    Write-Host "  ❌ Node.js is not installed." -ForegroundColor Red
    Write-Host "  📥 Please install Node.js 18+: https://nodejs.org/" -ForegroundColor Yellow
    Exit 1
}

# 2. Install Dependencies
Write-Host "[2/4] Installing binary protocol dependencies..." -ForegroundColor White
Set-Location $deployPath
try {
    npm install --production 2>&1 | Out-Null
    Write-Host "  ✅ Dependencies installed (ws, msgpackr)" -ForegroundColor Green
} catch {
    Write-Host "  ❌ npm install failed. Check your internet connection." -ForegroundColor Red
    Exit 1
}

# 3. Launch Server
Write-Host "[3/4] Launching Aether Binary Network node..." -ForegroundColor White
$env:PORT = "8080"
Start-Process "node" -ArgumentList "src/server.js" -WorkingDirectory $deployPath -WindowStyle Normal

Start-Sleep -Seconds 2

# 4. Open Dashboard
Write-Host "[4/4] Opening Binary Dashboard..." -ForegroundColor White
Start-Process "http://localhost:8080"

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ AETHER BINARY NETWORK IS LIVE!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  📡 Dashboard:  http://localhost:8080" -ForegroundColor White
Write-Host "  📊 API Stats:  http://localhost:8080/api/stats" -ForegroundColor White
Write-Host "  📐 Protocol:   http://localhost:8080/api/protocol" -ForegroundColor White
Write-Host ""
Write-Host "  Resource Limits per Node:" -ForegroundColor DarkGray
Write-Host "    CPU: 0.3% | RAM: 0.3% | GPU: 0.3% | BW: 0.3%" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press Ctrl+C in the server window to stop." -ForegroundColor DarkGray
Write-Host ""
