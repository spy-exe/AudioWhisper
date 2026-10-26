param(
    [string]$Apk,
    [string]$Output,
    [string]$SdkPath = $env:ANDROID_HOME
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$Apk) { $Apk = Join-Path $projectRoot 'apps\mobile\android\app\build\outputs\apk\release\app-release.apk' }
if (!$Output) { $Output = Join-Path $projectRoot '.devdata\releases\AudioWhisper-Mobile-0.1.0-beta.1.apk' }
if (!$SdkPath -or !$env:JAVA_HOME) { throw 'Configure ANDROID_HOME e JAVA_HOME antes de assinar.' }
$Apk = (Resolve-Path -LiteralPath $Apk).Path
$tools = Join-Path $SdkPath 'build-tools\36.0.0\apksigner.bat'
$keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
if (!(Test-Path -LiteralPath $tools) -or !(Test-Path -LiteralPath $keytool)) { throw 'Android Build Tools 36 e JDK não encontrados.' }
$signingDirectory = Join-Path $env:LOCALAPPDATA 'AudioWhisper\signing'
New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
$keyPath = Join-Path $signingDirectory 'mobile-release.jks'
$passwordPath = Join-Path $signingDirectory 'mobile-release.password'
if ((Test-Path -LiteralPath $keyPath) -and !(Test-Path -LiteralPath $passwordPath)) { throw 'A chave existente precisa da senha original. Nenhuma chave foi substituída.' }
if (Test-Path -LiteralPath $passwordPath) {
    $securePassword = (Get-Content -LiteralPath $passwordPath -Raw).Trim() | ConvertTo-SecureString
} else {
    $randomPassword = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(36))
    $securePassword = ConvertTo-SecureString -String $randomPassword -AsPlainText -Force
    $securePassword | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordPath
    $randomPassword = $null
}
$env:AW_SIGNING_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
try {
    if (!(Test-Path -LiteralPath $keyPath)) {
        & $keytool -genkeypair -keystore $keyPath -storetype PKCS12 -storepass:env AW_SIGNING_PASSWORD -keypass:env AW_SIGNING_PASSWORD -alias audiowhisper -dname 'CN=AudioWhisper Mobile' -keyalg RSA -keysize 3072 -validity 10000
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível gerar a chave de assinatura.' }
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Output) -Force | Out-Null
    & $tools sign --ks $keyPath --ks-key-alias audiowhisper --ks-pass env:AW_SIGNING_PASSWORD --key-pass env:AW_SIGNING_PASSWORD --v4-signing-enabled false --out $Output $Apk
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao assinar o APK.' }
    & $tools verify --verbose --print-certs $Output
    if ($LASTEXITCODE -ne 0) { throw 'A assinatura do APK não passou na verificação.' }
    Get-FileHash -LiteralPath $Output -Algorithm SHA256
} finally {
    Remove-Item Env:\AW_SIGNING_PASSWORD -ErrorAction SilentlyContinue
}
