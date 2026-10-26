# Dependências do aplicativo

Revisão em 26/10/2026. Exceções temporárias vencem em 26/11/2026. `npm run audit:dependencies` executa a auditoria do registro, bloqueia avisos novos e exige nova revisão após o vencimento. A compilação não tem uma auditoria sem alertas.

| Aviso | Uso nesta versão | Tratamento |
|---|---|---|
| [node-forge, GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Ferramentas Expo CLI e certificados de desenvolvimento | APK independente, sem servidor de desenvolvimento nem atualizações remotas. A assinatura Android usa o SDK Android. Não processar certificados não confiáveis com a CLI. Sem correção compatível publicada no registro consultado. |
| [zod, GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | Validação da CLI Expo, série 3.25 | Não expor a CLI à rede. A versão corrigida da série 4 não substitui a série 3 sem migração do Expo. |
| [decode-uri-component, GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | Dependência transitiva do roteador, potencialmente presente no bundle | Não publicar a exportação web como serviço. Links externos não iniciam gravações nem configuram o PC automaticamente. Resta risco de indisponibilidade ao abrir um link malformado; acompanhar a atualização compatível do roteador. |

As exceções cobrem somente estes três avisos, não outras vulnerabilidades dessas dependências. Não usar `npm audit fix --force`: a sugestão atual troca versões principais do Expo/roteador e quebra o contrato do SDK.

O telefone só envia áudio para o endereço de PC configurado e verifica a identidade da instalação antes de enviar. HTTP é permitido para redes locais; use uma rede confiável ou VPN. O app aceita HTTPS com validação normal do sistema e não ignora erros de certificado. Tokens não aparecem em logs ou manifestos de gravação. Android Keystore e iOS Keychain protegem os perfis de conexão.
