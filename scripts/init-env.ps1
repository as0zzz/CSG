$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.env'
if (Test-Path -LiteralPath $target) { Write-Output '.env already exists; preserved'; exit }
function New-LocalSecret {
    $bytes = New-Object byte[] 24
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
$lines = @(
    ('POSTGRES_PASSWORD=' + (New-LocalSecret))
    'MINIO_ROOT_USER=aksg-local'
    ('MINIO_ROOT_PASSWORD=' + (New-LocalSecret))
    ('SESSION_SECRET=' + (New-LocalSecret))
    ('DEMO_PASSWORD=' + (New-LocalSecret))
    'DEMO_BASE_DATE=2026-11-12'
)
[System.IO.File]::WriteAllLines($target, $lines)
Write-Output 'Created .env with random local secrets. Demo password is stored in .env.'
