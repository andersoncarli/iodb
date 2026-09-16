---
sprint: 38
date: 2026-09-16
features: [5.5]
thread: null
---
# 038 — quebra-chats-por-assunto

Quebra deterministica das conversas de `fswatch/chats/` em fragmentos por assunto, via TF-IDF sobre o texto do turno combinado com headings markdown.

## Objetivo

Quebrar as conversas longas em `fswatch/chats/*.md` (exports do ChatGPT, um
unico arquivo por conversa com multiplos assuntos misturados) em fragmentos
menores por assunto, de forma deterministica — reusando os sinais de TF-IDF
explorados em `BM25/02-fts-claude.md`, adaptados de selecao de turnos para
segmentacao de uma conversa corrida em grupos.

## Entrega

- `tools/splitchat.js` — parse de turnos, tokenizacao, IDF/TF-IDF, similaridade
  de cosseno entre turnos adjacentes, escolha de K cortes (proporcional ao
  numero de turnos), slugify e CLI de escrita.
- `tools/splitchat.t.js` — 33 testes unitarios cobrindo parse, tokenizacao,
  IDF, similaridade, determinismo dos cortes e do `splitFile` end-to-end.
- Rodado sobre os 3 arquivos reais em `fswatch/chats/` (260910, 260913,
  260914), gerando 4, 7 e 10 fragmentos respectivamente, em subpastas ao
  lado dos originais — que permanecem intactos.
- Determinismo confirmado: duas execucoes sobre o mesmo arquivo produzem
  fragmentos byte-idênticos.
