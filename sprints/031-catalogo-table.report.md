---
sprint: 31
date: 2026-09-11
features: [8.7]
thread: null
---
# 031 — catalogo-table

Intro: o catalogo `db.users` resolve preguicosamente uma Table por extensao (csv/dash),
sem tocar disco no acesso -- ultima feature da frente 8, encerrando-a por completo.

## Objetivo

O diretorio IODB resolve tabelas por nome, preguicosamente: `db.users` produz um no
`{op:'source', name:'users'}`, e a Table so e aberta quando o no e executado.

## O que foi feito

- `src/table/catalog.js` -- `catalog(dir)` (Proxy que produz nos congelados sem tocar
  disco, identidade estavel `db.users === db.users`), `resolveSource(node, opts)`
  (unico ponto que toca disco, por extensao ou registro explicito), `catalogExecutor(dir)`
  (cache de resultado). `require('fs')` em vez de `import` -- exports de modulo ES sao
  somente-leitura mesmo com `writable:true`, e o teste que prova "sem syscall" precisa
  espionar um objeto mutavel.
- `src/db-factory.js` -- `factory.table(name)` passa a resolver via `catalogExecutor`
  (zero chamadores reais do preset anterior, medido antes do sprint).
- `src/table/catalog.t.js` -- sem syscall no acesso (db.users, db.foo); identidade
  estavel; resolver csv/.dash passa `conform()`; paridade de conjunto com capabilities
  diferentes; cache de resolucao.
- `src/db-factory.t.js` -- teste de integracao de `factory.table()`.
