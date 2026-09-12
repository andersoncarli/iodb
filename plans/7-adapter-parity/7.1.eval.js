// Roteiro de avaliacao — feature 7.1: SqliteCollection ganha a superficie chaveada.
//
// O criterio nao e "os metodos existem". E: a MESMA sequencia de operacoes
// keyed deixa `IO(merge)` e `SqliteCollection` no mesmo estado observavel —
// incluindo o efeito do `remove`, que num lado e tombstone `null` e no outro e
// `DELETE`. E, ao lado disso, o passthrough de SQL cru que o adapter ja era
// continua intacto.

// 1. A PARIDADE, MEDIDA. O probe roda `put / put / put-upsert / remove` nos dois
//    engines e compara os `all()`. `size` aparece so no terceiro put — o
//    adapter tem que fazer ALTER TABLE ADD COLUMN, do jeito que uma chave nova
//    simplesmente aparece na projecao do iodb. Se os `all()` divergissem, ou o
//    `remove` deixasse a linha, ou o upsert nao pegasse, a feature nao estaria
//    pronta.
eval("bun plans/7-adapter-parity/7.1.probe.js", (out) => {
  check(out.includes('paridade: IGUAL'))
  check(out.includes('linhas iodb: 1'))
  check(out.includes('linhas sqlite: 1'))
  check(out.includes('remove apagou b: iodb=true sqlite=true'))
  check(out.includes('upsert pegou size=42: iodb=true sqlite=true'))

  // 2. O PASSTHROUGH E ADITIVO, NAO SUBSTITUIDO. Sem `{ table }`, o
  //    `in({ tabela: linha })` de INSERT cru e o `get(tabela)` continuam sendo
  //    o que eram — e por isso `db-factory.js` `.sql()` e `db.io.t.js` nao
  //    quebram.
  check(out.includes('passthrough INSERT cru: ok'))
  check(out.includes('get(tabela) devolve linhas: ok'))

  // 3. flush() E NO-OP, E A PORTA KEYED SO ABRE COM `{ table }`. O no-op existe
  //    para o chamador nao precisar saber qual backend esta embaixo; e as
  //    chamadas keyed sem `{ table }` lancam, em vez de agir sobre uma tabela
  //    que ninguem nomeou.
  check(out.includes('flush no-op: ok'))
  check(out.includes('put sem table lanca: ok'))
})

// 4. O ADAPTER E SEUS CONSUMIDORES, COM CONTAGEM EXATA. Tres arquivos: o teste
//    do proprio adapter (1 -> 16 checks: constroi · superficie keyed · lanca
//    sem table · passthrough · paridade com IO(merge)), e os dois consumidores
//    de `SqliteCollection` no engine — `db.io.t.js` (o `DB('x sqlite')`) e
//    `db-factory.t.js` (o `.sql()`). Se o passthrough tivesse regredido, um
//    destes dois acusaria. Contagem exata para um run vazio nao passar por
//    ausencia de "✘".
//
//    A suite `src` inteira NAO entra: ela hoje carrega WIP nao versionado da
//    feature 2.2 (`src/tabular-projection.t.js`) que falha por conta propria —
//    fora do escopo desta feature, reportado no report do sprint 019.
eval("utest src/adapters/sqlite.t.js --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
  check(Number([...clean.matchAll(/✔(\d+)/g)].pop()[1]) >= 16)
})

eval("utest src/db.io.t.js --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
  check(Number([...clean.matchAll(/✔(\d+)/g)].pop()[1]) >= 16)
})

eval("utest src/db-factory.t.js --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
  check(Number([...clean.matchAll(/✔(\d+)/g)].pop()[1]) >= 8)
})
