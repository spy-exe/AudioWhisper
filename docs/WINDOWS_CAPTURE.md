# Captura em segundo plano no Windows

No Studio, escolha **Windows · segundo plano**. O capturador usa WASAPI para gravar a saída de áudio selecionada, o microfone ou os dois. A gravação pertence a um processo separado: fechar o navegador não a encerra. Docker continua responsável pelo Whisper.

## Iniciar e gravar

Requer Windows 10/11, Python **3.12** e a stack do AudioWhisper disponível. Na pasta do projeto:

```powershell
.\scripts\Start-Capturador.ps1 -OpenStudio
```

O script instala um ambiente em `%LOCALAPPDATA%\AudioWhisper\runtime` e inicia o ícone na bandeja. A instalação e a inicialização não começam nenhuma gravação. Para outra porta, use `-StudioUrl http://127.0.0.1:9090`. O token `ACCESS_TOKEN`, quando configurado, é lido do `.env` local.

1. Escolha **Windows · segundo plano** no Studio, no mesmo computador.
2. Selecione **Áudio do desktop** ou **Desktop e microfone** e os dispositivos desejados.
3. Clique em **Iniciar no Windows**. Contador, medidor e marca vermelha na bandeja indicam a gravação.
4. Pode minimizar ou fechar o navegador. Ao reabrir, o Studio reencontra a sessão em andamento.
5. Encerre pelo Studio ou por **Encerrar gravação** na bandeja. **Sair** encerra a captura e o processo.

Use fones no modo combinado para evitar que o microfone recapture os alto-falantes. Trocar ou desconectar dispositivos pode exigir selecionar novamente. Não há troca silenciosa para outro microfone.

## Preservação e limites

PCM mono de 16 kHz entra em um diário local, sincronizado em disco a cada segundo. Blocos de até cinco segundos viram WAV por renomeação atômica e uma thread separada os envia. IDs estáveis permitem reenviar sem duplicar o áudio. Lentidão do servidor não bloqueia a captura em disco.

Arquivos e confirmações de envio ficam em `%LOCALAPPDATA%\AudioWhisper\captures`; logs em `%LOCALAPPDATA%\AudioWhisper\capture.log`. A bandeja oferece **Abrir pasta de recuperação**. Os WAVs são mantidos após o envio: aproximadamente 115 MB por hora. O capturador encerra ao detectar pouco espaço disponível.

Após reiniciar o processo, trechos parciais persistidos são consolidados e o envio pendente é retomado. O microfone **não é religado automaticamente**. Um aviso informa a interrupção. Em perda de energia ou falha abrupta, amostras ainda nos buffers ou não sincronizadas podem se perder; não há garantia de perda zero.

A proteção contra suspensão automática usa `SetThreadExecutionState` durante a gravação e é liberada ao terminar. A tela pode apagar. Suspensão manual, desligamento, logoff e encerramento do processo interrompem a entrada de áudio. Uma sessão tem limite aproximado de 24 horas. Se Docker estiver parado, os trechos aguardam sua retomada para serem transcritos.

## Controle local

A API escuta somente em `127.0.0.1:8765`, valida Host, origem exata do Studio e um cabeçalho próprio. Outras páginas e formulários são recusados. Não disponibiliza arquivos de áudio. O destino da API é configurado no processo local; páginas da web não podem alterá-lo. O cliente não usa proxy HTTP e não segue redirecionamentos. Se o navegador solicitar conexão ao dispositivo local, permita para esta instalação.

## Modo do navegador

**No navegador** também oferece desktop e modo combinado. No seletor de Chrome/Edge, escolha a tela ou aba e habilite **Compartilhar áudio**. Somente áudio é enviado. O microfone selecionado é respeitado no modo combinado. A disponibilidade de áudio de sistema depende do navegador, sistema e superfície selecionada.

A aba precisa permanecer aberta. IndexedDB preserva os trechos antes do envio, com reenvio após reconexão. O áudio tenta retomar quando a janela volta ao foco e oferece **Retomar áudio** se precisar de intervenção. A proteção de tela do navegador depende da visibilidade da aba; para fechar o navegador, use o modo Windows.

## Validação

O E2E inicia um capturador em outro processo com áudio sintético, fecha o Chromium inteiro, confirma que a duração continua aumentando e abre outro Chromium para encerrar a mesma sessão. Upload e Whisper usam a stack real. Há capturas em seis larguras e verificações axe.

O adaptador WASAPI foi exercitado nesta instalação nos modos desktop e combinado, conferindo amostras e liberação dos dispositivos sem salvar áudio pessoal. Testes com substituto da API PortAudio cobrem resampling, mistura, seleção de entradas e overflow. Perda de energia, logoff e todas as combinações de drivers não são simuladas. A inicialização e o menu da bandeja têm verificação local; a interação da bandeja não tem cobertura automatizada de linhas.

Referências: [PyAudioWPatch](https://github.com/s0d3s/PyAudioWPatch), [suspensão no Windows](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate), [captura no navegador](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).
