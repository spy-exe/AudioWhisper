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
