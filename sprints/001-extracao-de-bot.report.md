---
sprint: 1
date: 2026-09-05
features: [1.1]
---
# 001 — Report: Extração de bot/lib/adapters para repositório próprio

Sprint que originou este repositório. Corresponde ao sprint 027
(`sprints/027-extrair-io-db-lib-adapters-db-js-node-js-para-submodule-iodb.*`)
do projeto hospedeiro `bot` (FRM — Fractal Reasoning Machine).

## O que foi entregue

- `bot/lib/config.js` ⇄ `bot/lib/adapters/*` desacoplados (ciclo via
  `findProjectRoot`) para permitir a extração sem dependência circular.
- `bot/lib/hash.js` movido para dentro de `lib/adapters/` (agora `hash.js` na
  raiz deste repo) — usado por outros consumidores em `bot/` (`collection.js`,
  `nutshell/`), que passaram a importar daqui.
- ~70 pontos de import em `bot/` reescritos para apontar ao futuro submodule
  `iodb/db.js` e `iodb/node.js`.
- `lib/db.js`, `lib/node.js`, e os `.t.js` soltos movidos para dentro de
  `lib/adapters/`, unificando toda a superfície do sistema numa única árvore.
- `git subtree split --prefix=lib/adapters` preservou 22 commits de histórico
  relevante (origem: "Migration Complete: Unified Reactive IO Architecture
  Verified").
- Empacotado como projeto standalone: `package.json` (dependência `yaml`),
  `TEST.yaml`, `.gitignore`, submodules próprios `utils/` e `utest/` — mesma
  cadeia de dependência que `bot/` já usa, sem nenhuma referência de volta a
  `bot/lib`.
- `memory.t.js` (testava `bot/lib/memory.js`, fora do escopo do io-db) voltou
  para `bot/lib/memory.io.t.js`.
- Push para `github.com/andersoncarli/iodb` (branch `main`).

## Linhagem completa

`io/` (Sprint 10 de `bot`, "IO Store Foundation & Architecture") → unificado
em `bot/lib/adapters/` ("CHECKPOINT io->lib unification") → extraído para
`iodb` standalone (este repositório), reintegrado em `bot/` como git
submodule.

## Verificação

- Suite standalone (`bun utest/utest.js .`, fora de qualquer monorepo
  hospedeiro): 824 checks verdes, 0 falhas.
- Suite de `bot/` com `iodb` reintegrado via submodule: nenhuma regressão nos
  testes que tocam DB/node/hash/config (falhas remanescentes — `hittask.t.js`,
  `llm.call.t.js`, `plan.integration.t.js` — são ruído pré-existente,
  confirmado via `git stash` contra o commit anterior à extração).

## Critério de pronto

Ver `verify_tests`/`verify_manual` em
[1.1](1.1-db-reativo-db-js-node-js-models-adapters-file-yaml-json-sqlite-dash-.md).
