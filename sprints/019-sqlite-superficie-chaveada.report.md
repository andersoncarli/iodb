---
sprint: 19
date: 2026-09-11
features: [7.1]
thread: null
---
# 019 — sqlite-superficie-chaveada

O `SqliteCollection` ganhou `put(id,row) / remove(id) / all() / flush()` — a mesma
superficie que `IO(base,{reduce:merge})` — e um teste prova que a MESMA sequencia keyed
deixa os dois engines no mesmo estado observavel, incluindo o efeito do `remove`. O
passthrough de SQL cru que o adapter ja era continua intacto.

## O que foi entregue

**A segunda porta.** Passar `{ table }` para a fabrica abre o contrato keyed sobre essa
tabela, `id` como PRIMARY KEY. Sem `{ table }`, o adapter e o passthrough de sempre —
`query`, `run`, `get(tabela)`, `in({ tabela: linha })` como INSERT cru. `db.io.t.js` (16
checks) e `db-factory.t.js` (8) — os consumidores de `SqliteCollection` no engine — passam
sem tocar em nada.

**O mapeamento, chamada por chamada.** `put(id, row)` → `INSERT ... ON CONFLICT(id) DO
UPDATE`; `remove(id)` → `DELETE FROM {t} WHERE id = ?`; `all()` → `SELECT * FROM {t}`;
`flush()` → no-op, porque o SQLite ja e duravel por statement e o chamador nao deve
precisar saber qual backend esta embaixo. `in({ [id]: row })` / `in({ [id]: null })`
tambem roteiam para `put`/`remove` — a mesma forma que o `fswatch/fswatch.js` ja passa para
o `MetadataStore`.

**A prova da paridade.** `put(a) ; put(b) ; put(a', +size) ; remove(b)` rodado contra
`IO(merge)` e contra `SqliteCollection({ table })`: os dois `all()` normalizados sao
deep-equal — um registro, `b` ausente, `size` presente. O `remove` e um tombstone `null`
num lado (io-engine.js:702, `delete acc[k]`) e um `DELETE` no outro, e o resultado
observavel e o mesmo.

## O desvio do plano, registrado

O plano do 019 (decisao 3, versao inicial) dizia: **"coluna nova numa linha posterior e
erro do chamador"**. Implementei o oposto — `put` faz `ALTER TABLE ADD COLUMN` para chaves
que aparecem depois.

Motivo: o caso de uso do fswatch, que e a razao da 7.1 existir, e precisamente esse. Um
arquivo e visto (`put` sem `size`), depois medido (`put` do mesmo id com `size`). O `merge`
do iodb tolera — a chave nova simplesmente aparece na projecao. Se o adapter rejeitasse, a
"paridade" seria so nominal: a mesma sequencia quebraria de um lado e nao do outro. O
codigo esta certo; o plano estava errado nesse ponto, e foi corrigido para casar.

Isso NAO e scope creep — e a mesma feature (a superficie keyed pareada com `merge`),
so que a decisao escrita antes de codar subestimou o que "pareada" exigia. A regra da
deriva e sobre pedido novo com sprint aberto; aqui o pedido e o mesmo, a decisao e que
amadureceu ao encostar no teste.

## Verificacao

- `utest src/adapters/sqlite.t.js --force` — ✔16 (era ✔1).
- `bun plans/7-adapter-parity/7.1.probe.js` — `paridade: IGUAL`, `remove apagou b`,
  `upsert pegou size=42`, `passthrough INSERT cru: ok`, `flush no-op: ok`,
  `put sem table lanca: ok`.
- `utest src/db.io.t.js --force` — ✔16 · `src/db-factory.t.js` — ✔8.
- `sprint eval 7.1 --yes` — 4 passos, todos ✓ → 🟢.

## Fora de escopo, reportado

- **`src/tabular-projection.t.js` falha por conta propria.** E WIP nao versionado da
  feature 2.2 (`?? src/tabular-projection.js`, `?? sprints/020-projecao-tabular.*`): um
  roundtrip de CSV via `python3` que estoura `IndexError`, um decode de string vazia que
  devolve `""` em vez de vazio, e um teto de paginas que nao bate. Verificado com
  `git stash` que falha identico sem as mudancas deste sprint. Por isso o `7.1.eval.js`
  afirma sobre os tres arquivos que a 7.1 toca (o adapter + os dois consumidores), nao
  sobre `src` inteiro — um eval sobre `src` inteiro afirmaria vermelho sobre WIP alheio.
- **Os outros adapters** (`folder`, `file`, `jsonl`, `yaml`, `json`, `env`). A frente 7
  existe para dar a superficie keyed a todos; a 7.1 fez sqlite porque e o par que a 6.3
  mede contra o iodb. O resto sao features proprias da frente 7.
- **O `SqliteStore` local do `fswatch.js`** (sprint 017) ainda existe. Troca-lo por
  `SqliteCollection` e passo da 6.3, que e quem consome esta feature.
