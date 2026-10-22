---
version: alpha
name: AudioWhisper Studio
description: Gravação, transcrição e organização de áudio com foco na tarefa.
colors:
  background: '#0c1220'
  surface: '#141e30'
  raised: '#1a2840'
  interactive: '#253956'
  primary: '#9bc7ff'
  violet: '#c4b5fd'
  amber: '#ffbd87'
  text: '#f1f5fc'
  secondary: '#becbe0'
  muted: '#9baec8'
  border: '#344966'
  success: '#89e3cd'
  warning: '#ffd49b'
  danger: '#ff9ba7'
  focus: '#c3ddff'
typography:
  sans:
    fontFamily: 'IBM Plex Sans Variable, Segoe UI, system-ui, sans-serif'
  display:
    fontFamily: 'Manrope Variable, Segoe UI, sans-serif'
  mono:
    fontFamily: 'Cascadia Code, Consolas, ui-monospace, monospace'
rounded:
  sm: '0.375rem'
  md: '0.625rem'
  lg: '1.25rem'
spacing:
  page-max: '95rem'
  section-gap: '2.25rem'
components:
  button:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.background}'
    rounded: '{rounded.md}'
  secondary-button:
    backgroundColor: '{colors.interactive}'
    textColor: '{colors.text}'
  panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  raised-panel:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.secondary}'
  navigation:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.secondary}'
  transcript:
    backgroundColor: '{colors.background}'
    textColor: '{colors.text}'
    typography: '{typography.sans}'
  document:
    backgroundColor: '{colors.background}'
    textColor: '{colors.text}'
  metadata:
    textColor: '{colors.muted}'
  capture:
    textColor: '{colors.amber}'
  project-marker:
    textColor: '{colors.violet}'
  success-badge:
    textColor: '{colors.success}'
  warning-badge:
    textColor: '{colors.warning}'
  error-message:
    textColor: '{colors.danger}'
  field:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'

---

# AudioWhisper Studio

## Overview

O AudioWhisper é uma ferramenta de trabalho com áudio. Cada tela apresenta uma tarefa identificável: gravar, localizar uma gravação, revisar texto, acompanhar tarefas ou preparar documentos. A hierarquia vem de títulos, espaçamento, tipografia e dados reais. Evitar slogans, chamadas promocionais, ilustrações de preenchimento e ícones de brilho para representar funções. Português do Brasil; datas no fuso do navegador e duração independente de fuso.

A navegação usa nomes concretos. A central apresenta gravações recentes e prazos. O Studio começa nos controles de gravação e importação, sem uma abertura promocional. Não usar travessões nos rótulos da interface. A marca possui um ícone próprio em SVG, também utilizado como favicon.

## Colors

Azul gelo indica ações e navegação. Âmbar destaca a captura; os demais acentos identificam projetos e estados. Superfícies em três níveis separam página, painel e controles. Verde significa concluído, amarelo indica pendência e rosa sinaliza falha. Estados sempre têm rótulos além da cor. Cor e contraste indicam prioridade; evitar fundos decorativos que concorram com o conteúdo.

## Typography

Manrope nos títulos e IBM Plex Sans no conteúdo, ambas variáveis e hospedadas junto à aplicação. Corpo de 17px; controles e texto secundário de 16px; metadados de 14px; transcrição de 19px com entrelinha de 1,7. Títulos de página de 30 a 36px, inclusive no Studio. Timestamps usam fonte mono e números tabulares. Somente o complemento da marca pode usar tamanho menor. Não reduzir a fonte para resolver problemas de layout: empilhar controles ou permitir quebra.

## Layout

Sidebar de 248px a partir de 1024px, cabeçalho de 88px. A sidebar acomoda os dez destinos com fonte de 16px, controles de pelo menos 40px e rolagem própria em telas baixas. Em telas estreitas, navegação com Central, Studio, Biblioteca e Mais; o último abre todas as ferramentas em diálogo. Studio limitado a 1520px e workspace a 1560px, com respiro de 36px no desktop e 18px no celular. Captura e importação lado a lado a partir de 1280px; abaixo disso, empilhadas. Editor e documentos usam dois painéis onde houver espaço. O documento controla a rolagem da página; transcrição, fontes e prévia podem ter rolagem interna limitada. Nenhum fluxo depende de hover. Quadro de tarefas vira uma sequência de colunas em telas estreitas; a alternativa de lista mantém todas as ações sem exigir arrastar.

## Elevation & Depth

Painéis com bordas tonais e superfícies discretas. Não há animação ambiente ou arte decorativa no Studio e na central. Feedback de hover, foco e expansão usa 150 a 250ms. O sistema operacional ou a opção de desativar efeitos interrompem transições, preservando os estados finais e indicadores textuais. Skeletons reservam a geometria de carregamento. Projetos usam monogramas e quatro acentos.

## Divulgação progressiva

Coleções aparecem antes dos formulários. Novo projeto, nova tarefa, novo modelo e registro no caderno usam recolhíveis nativos com rótulos específicos. Fechar e reabrir preserva os campos. Filtros secundários ficam recolhidos; o resumo indica a quantidade de filtros aplicados. Modelo de processamento, configuração de dispositivos e automação ficam em opções secundárias; erros relevantes continuam visíveis junto à ação principal. Gravação, fonte de áudio, transcrição, tarefas e fontes verificáveis não dependem de abrir ajuda.

Referências: [Nielsen Norman Group, Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) e [GOV.UK Design System, Details](https://design-system.service.gov.uk/components/details/). Recolher somente informações secundárias, sem esconder o que a maioria precisa para executar a tarefa.

## Shapes

Painéis principais de 14px; campos e botões de 10–12px; símbolos de 14–16px. Botões principais têm altura mínima de 48px, campos de 46px e ações compactas de 40px. Ícones de 20–24px nas ações principais. Fundo, forma e rótulo revelam a prioridade da ação.

## Components

`apps/web/app/globals.css` é a fonte canônica dos tokens. O frontmatter documenta o mapeamento: `raised` → `--color-surface-raised`, `interactive` → `--color-surface-interactive`, `primary` → `--color-accent`, `violet` → `--color-accent-violet`, `text/secondary/muted` → `--color-text-*`; demais cores seguem seu nome. Tailwind v4 consome o bloco `@theme`. As variáveis `--font-heading` e `--font-body`, criadas por `next/font/local`, alimentam `--font-display` e `--font-sans`.

Button, Panel, Badge e Icon são compartilhados. MotionPreferences é o dono da política de movimento em CSS e Motion. DocumentContent renderiza Markdown sem HTML ou imagens remotas. DocumentView e o documento compartilhado usam esse mesmo componente. Selects permanecem nativos, com teclado e popup pertencentes ao sistema operacional. Busca possui limpeza explícita; feedback de erro permanece junto à operação com nova tentativa. Foco visível e scrollbars são globais.

## Do's and Don'ts

Preservar segmentos confirmados, separar texto provisório e mostrar progresso real. Favorecer leitura, contexto e revisão humana. Não inventar métricas, falantes, responsáveis ou prazos para preencher a interface. Não enviar conteúdo externamente sem ação explícita de compartilhamento. Não substituir feedback por animação. Não expor dados pessoais nas capturas de documentação.
