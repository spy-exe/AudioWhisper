# AudioWhisper Mobile

## Objetivo e contrato

O celular captura e preserva áudio localmente. O PC recebe trechos WAV PCM mono de 16 kHz pela rede local ou VPN, executa o pipeline existente na GPU e devolve os segmentos. Não há provedor remoto ou inferência no telefone. A interface é compartilhada entre Android e iOS; captura e envio em segundo plano pertencem a módulos nativos.

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| companion-protocol | Identidade persistente do PC, capacidades e criação idempotente de capturas | API existente |
| native-capture | Microfone em segundo plano, WAVs duráveis, recuperação e envio ordenado | companion-protocol |
| screen-capture | Permissão MediaProjection e áudio permitido de outros apps no Android | native-capture |
| mobile-studio | Conexão, controle da gravação, transcrição ao vivo e histórico local | native-capture |

Ordem: companion-protocol, native-capture, screen-capture, mobile-studio.

## Invariantes

- Gravar em armazenamento privado antes de tentar qualquer envio. A confirmação do servidor avança o cursor; nunca apaga o áudio local automaticamente.
- O identificador gerado no telefone acompanha todas as tentativas de criar a sessão. Repetir uma requisição não cria outra gravação.
- Cada gravação permanece vinculada à identidade do PC escolhido. Trocar o endereço por outro servidor não redireciona pendências silenciosamente.
- Credenciais ficam no armazenamento seguro do aparelho, fora dos manifestos e logs.
- Cada trecho tem sequência e início baseados na contagem de amostras. Usar o mesmo contrato `/api/live` do Studio e do capturador Windows.
- Exibir texto confirmado e estado de conexão reais. Não simular falas nem gravar transcrição fictícia na biblioteca pessoal.
- Quedas de rede não interrompem a captura. Após interrupção do processo, preservar os trechos e registrar a interrupção; não reativar microfone ou tela sem ação do usuário.
- Android utiliza serviço de primeiro plano com notificação e encerramento explícito. Captura da tela sempre solicita consentimento do sistema. Alguns aplicativos impedem a captura de áudio e conteúdo protegido.
- iOS utiliza sessão de áudio e modo de áudio em segundo plano. Captura de tela por ReplayKit exige extensão e validação próprias, fora da primeira validação Android. Encerrar o app à força pode interromper a captura em ambos os sistemas.
- Testes utilizam apenas banco, filas e volumes de QA separados. A biblioteca pessoal não recebe fixtures.

## Compatibilidade e validação

Base React Native/Expo SDK 55. A compilação Android é local; build e assinatura iOS exigem macOS/Xcode. O protocolo mantém compatibilidade com navegadores e capturador Windows.

Na API, verificar repetição e conflito de sessão, identidade persistente, autenticação e preservação dos contratos anteriores. No módulo nativo, verificar cabeçalho WAV, persistência, cursor de envio e encerramento. Na interface, verificar conexão, falha, reconexão, vazio, fonte ampliada, leitura de transcrição e movimento reduzido.

Uma compilação aprovada não equivale a validação em aparelho. A validação física inclui tela bloqueada, troca de aplicativo, perda de Wi-Fi/VPN, retorno da rede, parada pela notificação e revogação da captura de tela pelo sistema.

## Instalar e conectar

1. Inicie o Studio no PC com a GPU disponível. A API precisa incluir `/api/companion`. Instale o APK Android da versão mobile no celular, Android 10 ou superior.
2. Na aba **Conexão**, informe `http://<IPv4-do-PC>:8080`. Celular e PC devem estar na mesma rede ou conectados por VPN. O endereço `localhost` no celular aponta para o próprio celular.
3. Se o Studio usa `ACCESS_TOKEN`, abra **Token de acesso** e informe o mesmo valor. Toque em **Testar e conectar**. O app confirma a identidade do PC e mostra o modelo e dispositivo configurados no Studio.
4. Em **Gravar**, escolha o título e a fonte. Autorize o microfone e as notificações. Para áudio dos aplicativos, aceite também o diálogo de captura do Android. Só o áudio é armazenado, sem vídeo.
5. Acompanhe o texto confirmado pelo PC. Use **Encerrar**, inclusive ao trocar de aba. As gravações e a cópia da transcrição ficam em **Gravações**. **Compartilhar áudio original** prepara um WAV e abre o compartilhamento do sistema após sua ação.

O gateway do Studio já escuta na rede. Permita TCP 8080 no firewall da rede privada do PC. Não encaminhe essa porta no roteador para a internet. Pela VPN, informe o IP do PC fornecido por ela. HTTP é permitido para uso em rede confiável; HTTPS usa a validação normal de certificados do sistema.

Para atualizar apenas a API de um Studio existente, preservando os volumes:

```powershell
docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.ai.yml build api
docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.ai.yml up -d --no-deps api
```

Faça atualizações sem uma captura em andamento. Não use `docker compose down -v`, não substitua o banco nem copie fixtures para os volumes pessoais.

## O que cada sistema permite

| Recurso | Android | iPhone |
|---|---|---|
| Interface, conexão LAN/VPN e texto ao vivo | Implementado | Implementado |
| Microfone com app em segundo plano | Serviço nativo com notificação | AVAudioEngine e modo de áudio em segundo plano |
| Áudio de outros aplicativos, sem vídeo | AudioPlaybackCapture com consentimento do sistema | Extensão ReplayKit ainda necessária |
| Gravação sem rede e reenvio | Diário nativo e WorkManager | Diário nativo e fila enquanto a sessão de áudio/processo permanece ativa |
| Distribuição | APK Android assinado | Compilação em macOS aprovada; distribuição exige assinatura Apple |

Alguns aplicativos bloqueiam captura de áudio, e chamadas ou conteúdo protegido podem não ser capturados. No Android 15 ou superior, bloquear a tela pode revogar a captura dos aplicativos. O microfone usa um serviço próprio e pode continuar com a tela apagada. Encerramento forçado, reinício, falta de espaço ou restrições de bateria do fabricante podem interromper a gravação. O app preserva o que já foi escrito e informa a interrupção ao reabrir.

No iPhone, a execução da fila sem uma gravação ativa depende de o sistema manter o processo. Ao reabrir o app, a fila retoma. Não se promete envio indefinido depois de o sistema suspender ou encerrar o aplicativo.

O áudio fica no armazenamento privado do app. Atualize instalando o novo APK por cima, com a mesma assinatura. Desinstalar ou limpar os dados do aplicativo remove esses arquivos pelo próprio sistema. Exporte os originais que deseja manter fora do app.

## Desenvolvimento e builds

Requisitos: Node 22, JDK 21, Android SDK 36, Build Tools 36 e NDK 27.1.12297006. O projeto usa geração nativa do Expo; `android/` e `ios/` gerados não são versionados. Expo Go não contém o módulo de captura deste aplicativo. Não há dependência de EAS ou servidor remoto para gerar o APK.

```powershell
cd apps/mobile
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run audit:dependencies
npm run build:android
```

O APK de validação fica em `android/app/build/outputs/apk/release/app-release.apk`. O build local usa a assinatura de desenvolvimento do projeto gerado. Para distribuir, assine uma cópia com uma chave própria usando `apksigner`; conserve a chave para as atualizações seguintes. Não publique chaves, senhas ou tokens.

No Windows, `scripts/Sign-Mobile.ps1` gera ou reutiliza a chave em `%LOCALAPPDATA%\AudioWhisper\signing`, fora do repositório. A senha fica protegida por DPAPI para o usuário do Windows. A chave e a senha são necessárias para manter a assinatura; planeje um backup seguro antes de trocar de máquina. O script verifica a assinatura e imprime somente o hash do APK e informações públicas do certificado.

Em caminhos longos no Windows, execute o build por uma unidade curta antes de gerar os arquivos nativos. Escolha uma letra livre, configure `JAVA_HOME` e `ANDROID_HOME` e informe a raiz curta ao script:

```powershell
subst W: C:\caminho\AudioWhisper
$env:AW_MOBILE_ROOT = 'W:\apps\mobile'
cd W:\apps\mobile
npm run build:android
```

No macOS, `npm run ios` gera e abre o app no simulador. Para um iPhone físico, use Xcode e a assinatura da sua conta Apple. O workflow [Mobile](https://github.com/spy-exe/AudioWhisper/actions/workflows/mobile.yml) compila Android e iOS, além de verificar tipos, lint, testes e dependências.

As [exceções temporárias de dependências](../apps/mobile/SECURITY.md) são específicas, possuem vencimento e não dispensam a revisão de avisos novos.

## Evidência automatizada

- API: 220 testes aprovados, cobertura de 96,56% para API e pacote core.
- Regras de apresentação e conexão do mobile: 6 testes, 100% de linhas e branches desses helpers. Esse número não representa cobertura da interface ou dos módulos nativos.
- Android nativo: 10 testes aprovados para WAV, recuperação, perda de confirmação, identidade do PC, atualização da transcrição e transporte real até o worker na GPU.
- O teste de integração confirmou texto não vazio antes do encerramento, finalização no PC com `device=cuda` e permanência do áudio local.
- [Build no GitHub](https://github.com/spy-exe/AudioWhisper/actions/runs/40391539786): quality, Android e iOS aprovados.
- APK assinado no emulador Android 15: 2 testes completos aprovados em 115,436 s. Incluem captura de microfone e aplicativos combinados, texto real antes de parar, desligamento de Wi-Fi e dados, reenvio após reconexão, parada pela notificação, microfone com tela bloqueada, recuperação após encerramento forçado e parada disponível durante um timeout de conexão.
- QA visual em 411dp e 320dp, incluindo fonte a 130%, teclado, navegação por três botões e compartilhamento do WAV pelo seletor do sistema. A validação encontrou e corrigiu sobreposição da navegação e quebra de rótulos. Nenhuma mensagem ou arquivo foi enviado pelo seletor de compartilhamento.

Os testes de dispositivo recusam aparelhos físicos e APIs fora do ambiente `e2e` em `localhost:8090`. `tests/build_android_fixture.py` gera um player somente para QA com o arquivo público `apps/web/tests/e2e/fixtures/speech.wav`. A validação não injeta gravações na biblioteca pessoal.

Com o ambiente QA ativo, instale o APK assinado, o player e o probe de acessibilidade no emulador `emulator-5554`. O probe lê a árvore atual sem exigir que o relógio ao vivo fique imóvel. Ele não faz parte do aplicativo distribuído.

```powershell
python apps/mobile/tests/build_android_fixture.py
adb -s emulator-5554 root
adb -s emulator-5554 install -r .devdata/mobile-qa-player/player.apk
adb -s emulator-5554 install -r .devdata/mobile-qa-player/probe.apk
python apps/mobile/tests/android_e2e.py
```

As capturas e os logs locais ficam em `.devdata/qa/mobile` e `.devdata`, ignorados pelo Git. O teste espera permissões de áudio e notificações já concedidas no emulador. O diálogo de captura dos aplicativos continua sendo solicitado a cada sessão.
