---
sprint: 34
date: 2026-09-12
features: [5.3]
thread: null
---
# 034 — janitor: migra issues externas e corrige estado de frente

Intro: migra 3 itens de ISSUES.md que eram defeitos do sprint-cli/utest (nao do iodb) para
os repositorios donos, e corrige plans/8-table/_front.md que sprint docs acusava inconsistente.

## Objetivo

`ISSUES.md` acumulou itens `[sprint]`/`[utest]` cujo detalhe forense (`ISSUES/001,002,003`)
descreve bugs das ferramentas vizinhas, nao do `iodb`. Migrados com o writeup completo para
`~/sprint-cli/ISSUES/001,002` e `~/utest/ISSUES/007`, com entrada correspondente no
`ISSUES.md` de cada repo. Removidos do `iodb`; `ISSUES/README.md` aponta para onde foram.

`ISSUES/004` (fixture da 8.2) estava desatualizado dizendo "staged, nao commitado" — o
fixture correto (30 linhas, md5 `a32adc31...`) ja estava no HEAD desde `9c58e18`. Corrigido
para DONE.

`plans/8-table/_front.md` tinha `state: active` com as 7 features da frente ja `🔵`
confirmadas — `sprint docs` reclamava exatamente dessa inconsistencia. Voltou a `confirmed`;
o item de performance pendente (`flushPages()` O(store)) e trabalho novo que abre sprint
proprio (ja em andamento como 1.6/sprint 033), nao motivo para reabrir a frente 8.

`ISSUES/005` (fixture intermitente) e `006` (proposta de mudanca em `renderPage()`) ficam
como estao — ambos pedem investigacao/decisao propria, fora do escopo deste sprint.

## Evidencia

- `bun ../utest/utest.js . --force` — suite inteira verde antes e depois da mudanca (2703
  checks).
- `sprint docs` — de `✗ plans/8-table/_front.md: todas as features confirmadas mas
  state: active (esperado confirmed)` para `docs:check — ok`.
