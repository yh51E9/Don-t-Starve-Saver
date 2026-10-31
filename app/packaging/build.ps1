# One-click build: frontend -> PyInstaller -> exe next to app\
#   powershell -File packaging/build.ps1
param()

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent        # project root (app\)
$deploy = Split-Path $root -Parent              # exe output dir (sibling of app\)
Set-Location $root

# WorkBuddy bundles Node 22 which shadows PATH; put nvm Node 24 first
$nodeHome = "D:\Software\Scoop\persist\nvm\nodejs\v24.22.1"
if (Test-Path $nodeHome) {
    $env:PATH = "$nodeHome;$env:PATH"
}
$nodeVersion = (& node -v).Trim()
Write-Host "Node: $nodeVersion" -ForegroundColor DarkCyan
if (-not $nodeVersion.StartsWith("v24.")) {
    throw "Need Node 24 (nvm lts). Got $nodeVersion; check $nodeHome"
}

Write-Host "== Build frontend ==" -ForegroundColor Cyan
Push-Location ui
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
} finally {
    Pop-Location
}

Write-Host "== Package (onefile -> $deploy) ==" -ForegroundColor Cyan
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
& $py -m PyInstaller --clean --noconfirm `
    --distpath $deploy `
    --workpath (Join-Path $root "build") `
    packaging/onefile.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

# intermediates are disposable; keep only the single exe at project root
Remove-Item (Join-Path $root "build") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root "dist-onefile") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root "dist") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root "dist-onedir") -Recurse -Force -ErrorAction SilentlyContinue

$exe = Join-Path $deploy "饥荒存档备份工具.exe"
Write-Host "Done: $exe" -ForegroundColor Green
