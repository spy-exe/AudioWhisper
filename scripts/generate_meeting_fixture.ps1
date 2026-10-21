# Offline synthetic meeting for end-to-end tests. Requires Windows desktop voices.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apps/web/tests/e2e/fixtures/meeting.wav'))
$format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
    16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
)
try {
    $synth.SetOutputToWaveFile($outputPath, $format)
    $synth.SelectVoice('Microsoft Maria Desktop')
    $synth.Speak('Na reunião de infraestrutura, decidimos revisar os alertas de backup. Ficou decidido testar a restauração dos backups toda segunda-feira.')
    $synth.SelectVoice('Microsoft Daniel')
    $synth.Speak('Eu, Carlos, vou levantar as falhas e preparar o relatório até sexta-feira.')
    $synth.SelectVoice('Microsoft Maria Desktop')
    $synth.Speak('Ainda precisamos confirmar se há espaço suficiente no armazenamento. Não definimos um responsável por essa verificação.')
} finally {
    $synth.Dispose()
}
Get-Item -LiteralPath $outputPath | Select-Object Name,Length
