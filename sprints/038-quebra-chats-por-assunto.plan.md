# 038 — Plano: quebra-chats-por-assunto

Plano do sprint 038 (feature 5.5).

## Objetivo

Quebrar as conversas longas em `fswatch/chats/*.md` (exports do ChatGPT, um único arquivo por
conversa com múltiplos assuntos misturados) em fragmentos menores por assunto, de forma
**determinística** (mesma entrada → mesma saída sempre), reusando os sinais de TF-IDF
explorados em `BM25/02-fts-claude.md` — adaptados de *seleção* de turnos (a proposta original)
para *segmentação* de uma conversa corrida em grupos.

## Contexto

`fswatch/chats/` guarda 3 exports (`260910-fswatch-iodb.md`, 16 turnos;
`260913-armazeanar-arvore-eficient.md`, recuperado, mesmo formato; `260914-analizar-script-topologico.md`,
54 turnos). Cada turno é um par `## Prompt:` / `## Response:` com timestamp. `BM25/` tem 3
conversas exploratórias; só `02-fts-claude.md` chega a um algoritmo concreto (TF-IDF sobre
título/resumo/tags pré-gerados) — mas os chats reais não têm esses metadados por turno, então o
sinal precisa vir do próprio texto do turno + headings markdown que o ChatGPT já usa dentro das
respostas longas.

Não há código de BM25/FTS/segmentação já existente no repo — implementação greenfield.

## Decisões (confirmadas com o usuário)

- Granularidade: por **turno** (`## Prompt:` + `## Response:` = 1 unidade atômica).
- Sinal: TF-IDF sobre o texto do turno **+** headings markdown como pista extra de fronteira.
- Corte: **não é limiar fixo** — escolhe os K cortes de maior queda de similaridade entre turnos
  adjacentes, K proporcional ao número de turnos do arquivo.
- Saída: `fswatch/chats/<slug-original>/NN-<slug-assunto>.md`, subpasta por conversa.
- Arquivo original: mantido intacto ao lado da subpasta.
- Código-fonte em `tools/splitchat.js` (não em `fswatch/typed/` — é uma ferramenta de
  manutenção do repo, não parte do engine fswatch).

## Passos

1. `tools/splitchat.js` — módulo ESM puro, zero deps:
   - `parseTurns(text)` → lista de `{ index, promptText, responseText, timestamp, headings[] }`.
   - `tokenize(text)` → lowercase, remove pontuação (preserva acentos/ç), split por espaço,
     filtra `length > 2`.
   - `buildIDF(turnos)` → `idf[term] = log((N+1)/(freq+1)) + 1` sobre o corpus do próprio arquivo.
   - `tfidfVector(turno, idf)` → vetor esparso `{ termo: tf*idf }`.
   - `cosineSim(vecA, vecB)` → similaridade entre turnos adjacentes.
   - `chooseCuts(sims, headingsChanged, targetTurnsPerGroup)` → K = `max(1, round(N /
     targetTurnsPerGroup))`; desconta similaridade nos pontos onde `headingsChanged[i]` é true;
     pega os K menores valores de `sims` como cortes; retorna índices ordenados.
   - `slugifyGroup(turnos, idf)` → heading de maior nível do primeiro turno do grupo, ou top
     2–3 termos de maior TF-IDF agregado; slugify (lowercase, sem acento, `-`, trunca ~40 chars).
   - `splitFile(text, { targetTurnsPerGroup })` → orquestra tudo, retorna lista de `{ slug,
     turnRange, content }` pronta para escrita.
   - CLI mínimo (`node tools/splitchat.js <arquivo.md> [--target N]`) que lê o arquivo, chama
     `splitFile`, escreve em `<dir>/<slug-original>/NN-<slug-assunto>.md`.

2. `tools/splitchat.t.js` — testes via `utest` (padrão do repo:
   `test('nome', async ({ check }) => {...})`):
   - fixture sintético pequeno (4-6 turnos, 2 assuntos claros) → parse correto.
   - tokenização: casos com acento, pontuação, tokens curtos filtrados.
   - IDF/similaridade: valores esperados calculados à mão para o fixture.
   - `chooseCuts` determinístico: mesma entrada → mesmos cortes sempre, em 3 execuções.
   - `slugifyGroup`: heading presente vs ausente (fallback TF-IDF).
   - `splitFile` end-to-end sobre o fixture: grupos e ranges de turno esperados.

3. Rodar `tools/splitchat.js` sobre os 3 arquivos reais em `fswatch/chats/*.md`, gerando as
   subpastas. Conferir manualmente os slugs gerados contra o conteúdo.

## Verificação (critério de pronto)

- `utest tools/splitchat.t.js --force` — todos os testes passam.
- Rodar o CLI duas vezes sobre o mesmo arquivo real e diff os resultados — deve ser
  byte-idêntico (prova de determinismo).
- Os 3 arquivos originais em `fswatch/chats/*.md` permanecem intactos (git diff vazio para eles).
- Subpastas geradas para os 3 arquivos, com `NN-<slug-assunto>.md` legível e coerente com o
  conteúdo (revisão humana rápida).
