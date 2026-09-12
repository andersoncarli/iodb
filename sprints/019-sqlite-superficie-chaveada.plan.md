# 019 — Plano: sqlite-superficie-chaveada

Feature 7.1. O `SqliteCollection` (src/adapters/sqlite.js) ganha `put / remove / all /
flush` — a mesma superficie que `IO(base,{reduce:merge})` ja oferece — sem perder o
passthrough de SQL cru que ele e hoje.

## Objetivo

Somar um contrato keyed ao adapter, de modo que um consumidor possa escolher entre
`IO(merge)` e `SqliteCollection` chamando as **mesmas** operacoes. Pre-requisito da 6.3, que
compara os dois engines pela mesma interface no `fswatch/bench.js`.

## As decisoes que este sprint escreve ANTES de codar

### 1. Aditivo, nao substituto

`query`, `run`, `get(tabela)` e o `in({ tabela: linha })` de INSERT cru **continuam
funcionando**. Consumidores atuais: `db-factory.js` `.sql()` (linha `BACKENDS['sqlite'] =
sqlite.default`, e o wrapper `.sql: (name, o) => factory.collection(...)`), e `src/db.io.t.js`.
Nenhum deles pode quebrar. O contrato keyed e uma segunda porta na MESMA colecao.

### 2. O mapeamento, chamada por chamada

| iodb `IO(merge)`                | `SqliteCollection` (novo)                          |
| ------------------------------ | ------------------------------------------------- |
| `io.in({ [id]: row })`         | `put(id, row)` → `INSERT ... ON CONFLICT(id) DO UPDATE` |
| `io.in({ [id]: null })`        | `remove(id)` → `DELETE FROM {t} WHERE id = ?`     |
| `Object.values(io.get('#1'))`  | `all()` → `SELECT * FROM {t}` como array          |
| `io.flush()`                   | `flush()` → no-op (SQLite ja e duravel por statement) |

`in(patch)` passa a reconhecer a forma keyed: se toda chave de `patch` casa `/^..*$/` e o
valor e objeto-linha ou `null`, roteia para `put`/`remove` por chave. A forma antiga
(`{ tabela: linha }` onde a chave e nome de tabela conhecida e nao ha coluna `id`) continua
indo para o `INSERT` cru. Heuristica de desempate: **a fabrica recebe `{ table }`** — se
`table` foi declarado, todo `in` keyed opera nessa tabela; sem `table`, o comportamento e o
de hoje.

### 3. O schema nasce da primeira linha, e cresce com ALTER TABLE

`put` faz `CREATE TABLE IF NOT EXISTS {table} (col1 TYPE, ..., PRIMARY KEY(id))` no primeiro
uso, colunas das chaves de `row`, tipos inferidos (`number`→`INTEGER`/`REAL`, resto→`TEXT`).
Uma linha POSTERIOR que traz chave nova recebe `ALTER TABLE {table} ADD COLUMN` — a coluna
aparece com o tempo do mesmo jeito que uma chave aparece na projecao `merge` do iodb (um
arquivo visto primeiro, depois medido, ganha `size`).

**Desvio do que este plano dizia:** a versao anterior desta decisao dizia "coluna nova numa
linha posterior e erro do chamador". Isso estava errado. O caso de uso do fswatch — a razao
da 7.1 existir — e exatamente esse: `put` de um entry sem `size`, depois `put` do mesmo id
COM `size`. O `merge` do iodb tolera (a chave so aparece); para a paridade ser real, o
adapter tem que tolerar tambem. Mudado no codigo, registrado no report do 019.

Valores objeto/array numa coluna: `JSON.stringify` na escrita, sem parse automatico na
leitura (o consumidor sabe seu schema). `all()` devolve as linhas como o SQLite as da.

### 4. O tombstone e o teste que prova a paridade

Nao basta "os dois tem metodos homonimos". O criterio e: a sequencia
`put(a) ; put(b) ; put(a') ; remove(b)` rodada contra `IO(base,{reduce:merge})` e contra
`SqliteCollection({ table })` deixa `all()` **igual** nos dois — mesmo cardinal, mesma linha
por id, `b` ausente. Se `remove` no sqlite deixasse a linha (ou o iodb guardasse `null` em
vez de apagar a chave), os `all()` divergiriam e a feature nao estaria pronta.

## Passos

1. `src/adapters/sqlite.js`: aceitar `opts.table` na fabrica; guardar `let ensured = false`
   e um helper `ensureTable(row)` que faz o `CREATE TABLE IF NOT EXISTS` uma vez.
2. `src/adapters/sqlite.js`: `put(id, row)` — `ensureTable`, entao
   `INSERT INTO {t} (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET ...` com os valores
   serializados; retorna `'sqlite-ok'` (consistente com o `in` atual).
3. `src/adapters/sqlite.js`: `remove(id)` — `DELETE FROM {t} WHERE id = ?`.
4. `src/adapters/sqlite.js`: `all()` — `if (!ensured) return []`, senao `SELECT * FROM {t}`.
5. `src/adapters/sqlite.js`: `flush() { return }` — no-op explicito, documentado.
6. `src/adapters/sqlite.js`: `in(patch)` — se `opts.table` e todo par e
   `{ id: row|null }`, iterar `put`/`remove`; senao, o `INSERT` cru de hoje, intacto.
7. `src/adapters/sqlite.t.js`: subir de 1 check para cobrir put/upsert/remove/all/flush; e
   **o teste de paridade** — importar `IO, { merge }` de `../io-engine.js`, rodar a mesma
   sequencia nos dois, `check` que `all()` bate (ordenar por id antes de comparar).
8. Conferir `utest src --force` verde inteiro — `db.io.t.js` e o `.sql()`
   do `db-factory.js` incluidos.

## Criterio de pronto

`utest src/adapters/sqlite.t.js --force` verde com o teste de paridade
passando (incluindo o efeito do `remove`); `utest src --force` sem
regressao; `in({ tabela: linha })` de INSERT cru ainda funcionando para quem nao passa
`{ table }`; e o diff mostrando que nada do passthrough existente foi removido.
