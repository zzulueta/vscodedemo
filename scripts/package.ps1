[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$staging = Join-Path $root ".deployment/package-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path "$staging/app" -Force | Out-Null
foreach ($name in @('server.js', 'lib', 'views', 'public', 'scripts', 'package.json', 'package-lock.json')) {
    Copy-Item (Join-Path $root "app/$name") "$staging/app/" -Recurse -Force
}
Copy-Item (Join-Path $root 'GlobalAIManila.png') "$staging/GlobalAIManila.png" -Force
npm ci --prefix "$staging/app" --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
$archive = Join-Path $root '.deployment/website.zip'
if (Test-Path $archive) { Remove-Item $archive }
[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $archive, [System.IO.Compression.CompressionLevel]::Fastest, $false)
Write-Output 'Deployment archive: .deployment/website.zip'