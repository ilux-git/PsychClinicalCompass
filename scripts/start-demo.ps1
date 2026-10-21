$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.env')) {
    $randomBytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
    $jwtSecret = [Convert]::ToBase64String($randomBytes)
    $envTemplate = [System.IO.File]::ReadAllText((Join-Path $projectRoot '.env.example'))
    $envContent = $envTemplate.Replace('JWT_SECRET=change-me-in-production', "JWT_SECRET=$jwtSecret")
    [System.IO.File]::WriteAllText((Join-Path $projectRoot '.env'), $envContent)
}
docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker engine unavailable. Start Docker Desktop and retry.' }
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Demo startup failed. Inspect docker compose logs init app worker.' }
Write-Host 'Demo: http://127.0.0.1:8000/  |  API: http://127.0.0.1:8000/docs'
Write-Host 'The init service applies migrations and synthetic fixtures before the API and worker.'
