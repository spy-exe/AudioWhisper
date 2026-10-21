---
version: alpha
name: AudioWhisper Studio
description: Um estúdio de áudio expressivo, legível e orientado à revisão.
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
  button: {}
  panel: {}
  navigation: {}
  transcript: {}
  document: {}
---

# AudioWhisper Studio

## Overview

Uma bancada de produção sonora para transformar conversas em informação verificável. Azul profundo, luz âmbar e linhas espectrais dão identidade ao produto. A assinatura visual parte do áudio: ondas, timestamps, medidores e referências ao trecho original. A composição deve ter presença sem competir com a leitura da transcrição. Português do Brasil; datas no fuso do navegador e duração independente de fuso.

## Colors

Azul gelo indica ações e navegação. Âmbar destaca a captura; violeta e verde-água compõem a ilustração sonora. Superfícies em três níveis separam página, painel e controles. Verde significa concluído, amarelo indica pendência e rosa sinaliza falha. Estados sempre têm rótulos além da cor. Gradientes são discretos, com bordas e reflexos de baixa intensidade.

## Typography

Manrope nos títulos e IBM Plex Sans no conteúdo, ambas variáveis e hospedadas junto à aplicação. Corpo de 17px; controles e texto secundário de 16px; metadados de 14px; transcrição de 19px com entrelinha de 1,7. Títulos de página de 30–36px, abertura do Studio de 34–48px. Timestamps usam fonte mono e números tabulares. Somente marca e ilustração decorativa podem usar tamanhos menores. Não reduzir a fonte para resolver problemas de layout: empilhar controles ou permitir quebra.

## Layout

Sidebar de 248px a partir de 1024px, cabeçalho de 88px. Em telas estreitas, navegação superior com três destinos e áreas de toque amplas. Studio limitado a 1520px com respiro de 36px no desktop e 18px no celular. Captura e importação lado a lado a partir de 1280px; abaixo disso, empilhadas. Editor e assistente usam dois painéis onde houver espaço. O documento controla a rolagem da página; transcrição, fontes e prévia podem ter rolagem interna limitada. Nenhum fluxo depende de hover.

## Elevation & Depth

Painéis com bordas tonais, reflexo interno e sombras suaves. A arte espectral é SVG leve, animada com transform e opacity. Não há cena WebGL decorativa na abertura. O movimento ambiente dura 12s; feedback de interação usa 150–250ms. O sistema operacional ou a opção de desativar efeitos interrompem movimentos ambientes, pulsos e transições, preservando indicadores textuais de estado. Skeletons reservam a geometria de carregamento.

## Shapes

Painéis principais de 20px; campos e botões de 10–12px; símbolos de 14–16px. Botões principais têm altura mínima de 48px, campos de 46px e ações compactas de 40px. Ícones de 20–24px nas ações principais. Fundo, forma e rótulo revelam a prioridade da ação.

## Components

`apps/web/app/globals.css` é a fonte canônica dos tokens. O frontmatter documenta o mapeamento: `raised` → `--color-surface-raised`, `interactive` → `--color-surface-interactive`, `primary` → `--color-accent`, `violet` → `--color-accent-violet`, `text/secondary/muted` → `--color-text-*`; demais cores seguem seu nome. Tailwind v4 consome o bloco `@theme`. As variáveis `--font-heading` e `--font-body`, criadas por `next/font/local`, alimentam `--font-display` e `--font-sans`.

Button, Panel, Badge e Icon são compartilhados. MotionPreferences é o dono da política de movimento em CSS e Motion. DocumentContent renderiza Markdown sem HTML ou imagens remotas. DocumentView e o documento compartilhado usam esse mesmo componente. Selects permanecem nativos, com teclado e popup pertencentes ao sistema operacional. Busca possui limpeza explícita; feedback de erro permanece junto à operação com nova tentativa. Foco visível e scrollbars são globais.

## Do's and Don'ts

Preservar segmentos confirmados, separar texto provisório e mostrar progresso real. Favorecer leitura, contexto e revisão humana. Não inventar métricas, falantes, responsáveis ou prazos para preencher a interface. Não enviar conteúdo externamente sem ação explícita de compartilhamento. Não substituir feedback por animação. Não expor dados pessoais nas capturas de documentação.
