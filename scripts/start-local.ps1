# Starts the whole local stack: API + local cloud (port 8787, moto on 5055) and the web app (5173).
# Ollama must be running for local AI wording (it usually starts with Windows).
$root = Split-Path $PSScriptRoot
$py = Join-Path $HOME ".ssvenv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Host "Run scripts\setup-backend.ps1 first."; exit 1 }
$api = Start-Process -PassThru -NoNewWindow $py -ArgumentList @("-m", "uvicorn", "app:app", "--app-dir", "`"$root\server`"", "--host", "0.0.0.0", "--port", "8787")
Write-Host "API pid $($api.Id) on http://0.0.0.0:8787  (phone: use the laptop IP shown below)"
try { npm --prefix $root run dev -- --port 5173 }
finally { Stop-Process -Id $api.Id -ErrorAction SilentlyContinue }
