# One-time: Python environment for the backend. The venv lives in a short path because
# Windows limits paths to 260 characters and this project folder is deep.
$venv = Join-Path $HOME ".ssvenv"
$root = Split-Path $PSScriptRoot
if (-not (Test-Path "$venv\Scripts\python.exe")) { python -m venv $venv }
& "$venv\Scripts\python.exe" -m pip install --upgrade pip
& "$venv\Scripts\python.exe" -m pip install -r "$root\server\requirements.txt"
Write-Host "Backend ready. Start everything with: powershell -File scripts\start-local.ps1"
