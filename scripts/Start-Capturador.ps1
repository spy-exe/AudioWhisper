param(
    [string]$StudioUrl = 'http://127.0.0.1:8080',
    [switch]$OpenStudio
)
$ErrorActionPreference = 'Stop'
$captureRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$captureRuntime = Join-Path $env:LOCALAPPDATA 'AudioWhisper\runtime'
$capturePython = Join-Path $captureRuntime 'Scripts\python.exe'
$capturePythonw = Join-Path $captureRuntime 'Scripts\pythonw.exe'
try {
    $captureHealth = Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2
    if ($captureHealth.service -eq 'audiowhisper-capture') {
        Write-Host 'Capturador Windows já está em execução na bandeja.'
        if ($OpenStudio) { Start-Process "$StudioUrl/?capture=windows" }
        return
    }
} catch { }
if (!(Test-Path -LiteralPath $capturePython)) {
    Write-Host 'Preparando Python 3.12 para o capturador local...'
    py -3.12 -m venv $captureRuntime
    if ($LASTEXITCODE -ne 0) { throw 'Instale Python 3.12 para Windows e execute novamente.' }
}
& $capturePython -m pip install -r (Join-Path $captureRepo 'apps\capture\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível instalar as dependências do capturador.' }
$captureModuleDir = Join-Path $captureRepo 'apps\capture'
$captureEnvFile = Join-Path $captureRepo '.env'
$captureArguments = @('-m', 'audiowhisper_capture', '--api-url', $StudioUrl, '--env-file', "`"$captureEnvFile`"")
Start-Process -FilePath $capturePythonw -ArgumentList $captureArguments -WorkingDirectory $captureModuleDir -WindowStyle Hidden
$captureReady = $false
for ($captureAttempt = 0; $captureAttempt -lt 30; $captureAttempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $captureHealth = Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 1
        if ($captureHealth.service -eq 'audiowhisper-capture') { $captureReady = $true; break }
    } catch { }
}
if (!$captureReady) { throw 'O capturador não iniciou. Consulte %LOCALAPPDATA%\AudioWhisper\capture.log.' }
Write-Host 'Capturador pronto na bandeja do Windows. Nenhuma gravação foi iniciada.'
if ($OpenStudio) { Start-Process "$StudioUrl/?capture=windows" }
