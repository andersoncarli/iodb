# 031 — Plano: catalogo-table

Plano do sprint 031 (feature 8.7) -- a ultima da frente 8.

## Objetivo

O diretorio IODB resolve tabelas por nome, preguicosamente: `db.users` produz um no
`{op:'source', name:'users'}`, e a Table so e aberta quando o no e executado. E o ponto
onde o backing e escolhido -- por extensao (`users.csv` -> tabularTable, `users.dash` ->
ioTable), sem tocar disco no acesso da propriedade.

## Passos

1. `src/table/catalog.js`:
   - `catalog(dir)` -- Proxy cujo acesso a QUALQUER propriedade devolve
     `{op:'source', name}` congelado, com identidade estavel (`db.users === db.users`)
     via cache de nos. `db.foo` inexistente nao lanca e nao toca disco.
   - `resolveSource(node, {dir, backings})` -- unico ponto que toca disco: resolve por
     extensao (`.csv` primeiro, depois `.dash`) ou por registro explicito em `backings`.
     Arquivo inexistente devolve `null`, nao lanca.
   - `catalogExecutor(dir)` -- cache de RESULTADO (nao so de no), pra que resolver o
     mesmo nome duas vezes nao reabra o arquivo.
   - `require('fs')` em vez de `import`: exports de modulo ES sao somente-leitura mesmo
     com `writable:true` no descriptor -- um spy que reatribui `existsSync` precisa do
     objeto de exports mutavel do CommonJS, senao a prova de "sem syscall" fica invisivel.
2. `src/db-factory.js` -- `factory.table(name)` passa a resolver via `catalogExecutor`
   em vez do preset yaml upsert-by-id (zero chamadores reais no repo, medido antes deste
   sprint). O preset `table:` do BACKENDS continua existindo pra quem pede a assinatura
   `'nome yaml table'` por string; so o atalho `.table()` muda.
3. `src/table/catalog.t.js` -- sem syscall no acesso (db.users e db.foo); identidade
   estavel; resolver csv/.dash devolve Table que passa `conform()`; paridade de conjunto
   entre os dois backings com capabilities diferentes; cache de resolucao.
4. `src/db-factory.t.js` -- teste de integracao: `factory.table('users')` sobre um
   `users.csv` real, e cache de identidade dentro da sessao da factory.

## Criterio de pronto

- `db.foo` para arquivo inexistente nao lanca e nao faz nenhuma syscall (medido com spy
  em `fs.existsSync`, nao afirmado).
- `db.users` devolve um no `{op:'source', name:'users'}`.
- Resolver esse no devolve uma Table que passa `conform()`.
- A mesma sequencia sobre dois backings (csv, .dash) devolve os mesmos conjuntos com
  `capabilities()` diferentes.
- `db.users === db.users`.
- Suite completa do projeto sem falha real (state/fails).
