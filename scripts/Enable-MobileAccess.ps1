[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InterfaceAlias,
    [ValidatePattern('^[0-9.]+/([89]|[12][0-9]|3[0-2])$')][string]$AdditionalSubnet,
    [ValidateRange(1, 65535)][int]$Port = 8080
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$isAdmin -and !$WhatIfPreference) {
    $shellPath = (Get-Process -Id $PID).Path
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), '-Port', $Port)
    if ($InterfaceAlias) { $arguments += @('-InterfaceAlias', ('"{0}"' -f $InterfaceAlias)) }
    if ($AdditionalSubnet) { $arguments += @('-AdditionalSubnet', $AdditionalSubnet) }
    $process = Start-Process -FilePath $shellPath -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw 'O Windows não concluiu a configuração. Nenhum resultado anterior deve ser usado.' }
    $resultPath = Join-Path $projectRoot '.devdata\mobile-access.json'
    if (Test-Path -LiteralPath $resultPath) { Get-Content -LiteralPath $resultPath }
    return
}
$interfaces = @(Get-NetIPConfiguration | Where-Object { $_.IPv4Address -and $(if ($InterfaceAlias) { $_.InterfaceAlias -eq $InterfaceAlias } else { [bool]$_.IPv4DefaultGateway }) })
if ($interfaces.Count -ne 1) { throw 'Selecione uma interface com -InterfaceAlias. Nenhuma regra foi alterada.' }
$interface = $interfaces[0]
$address = @($interface.IPv4Address)[0]
$ip = $address.IPAddress
$prefix = [int]$address.PrefixLength
if (($prefix -lt 8 -or $prefix -gt 30) -and !$AdditionalSubnet) { throw 'A interface não parece uma rede local compartilhada. Informe -AdditionalSubnet para a rede da VPN.' }
$bytes = [System.Net.IPAddress]::Parse($ip).GetAddressBytes()
for ($index = 0; $index -lt 4; $index++) {
    $bits = [Math]::Max(0, [Math]::Min(8, $prefix - $index * 8))
    $mask = if ($bits -eq 0) { 0 } else { (255 -shl (8 - $bits)) -band 255 }
    $bytes[$index] = $bytes[$index] -band $mask
}
$subnet = ([System.Net.IPAddress]::new($bytes)).ToString() + '/' + $prefix
$remoteSources = @()
if ($prefix -ge 8 -and $prefix -le 30) { $remoteSources += $subnet }
if ($AdditionalSubnet) {
    $additionalIp = [System.Net.IPAddress]::Parse($AdditionalSubnet.Split('/')[0])
    if ($additionalIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Informe uma sub-rede IPv4 válida.' }
    $remoteSources += $AdditionalSubnet
}
$ruleName = 'AudioWhisper-Mobile-' + $interface.InterfaceIndex + '-' + $Port
if ($PSCmdlet.ShouldProcess("$ip`:$Port, $($interface.InterfaceAlias), origem $($remoteSources -join ', ')", 'Permitir somente acesso local ao AudioWhisper')) {
    $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($rule) {
        $rule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any -InterfaceAlias $interface.InterfaceAlias
        $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port
        $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -LocalAddress $ip -RemoteAddress $remoteSources
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName 'AudioWhisper Mobile (rede local)' -Description 'Somente a porta do Studio no IP e sub-rede selecionados. Não altera o perfil da rede.' -Enabled True -Direction Inbound -Action Allow -Profile Any -InterfaceAlias $interface.InterfaceAlias -Protocol TCP -LocalPort $Port -LocalAddress $ip -RemoteAddress $remoteSources | Out-Null
    }
    $result = [ordered]@{ url = "http://$ip`:$Port"; interface = $interface.InterfaceAlias; remote_subnet = $remoteSources; rule = $ruleName }
    $directory = Join-Path $projectRoot '.devdata'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'mobile-access.json') -Encoding UTF8
    $result
}
