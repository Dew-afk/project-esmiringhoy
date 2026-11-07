$ErrorActionPreference = "Stop"

$frontendPath = Join-Path $PSScriptRoot "frontend"
$npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue

if (-not $npmCommand) {
    throw "Node.js and npm are required. Install Node.js, then run this script again."
}

if (-not (Test-Path (Join-Path $frontendPath "package.json"))) {
    throw "Could not find the frontend project at '$frontendPath'."
}

# ML inference server in its own window (the UI shows its live status)
Start-Process powershell -ArgumentList '-NoExit','-Command','python "machine learning/webcam_demo.py"'
# Open the browser once the dev server is up
Start-Process powershell -WindowStyle Hidden -ArgumentList '-Command','Start-Sleep 8; Start-Process "http://localhost:3000"'

Push-Location $frontendPath
try {
    if (-not (Test-Path (Join-Path $frontendPath "node_modules"))) {
        Write-Host "Installing frontend dependencies..."
        & $npmCommand.Source ci
        if ($LASTEXITCODE -ne 0) {
            throw "Dependency installation failed with exit code $LASTEXITCODE."
        }
    }

    Write-Host "Starting the frontend at http://localhost:3000"
    & $npmCommand.Source run dev
    if ($LASTEXITCODE -ne 0) {
        throw "The frontend stopped with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
