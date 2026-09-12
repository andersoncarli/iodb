// Roteiro de avaliacao — feature 8.2: schema normalizado, duas gramaticas, um
// POJO; lei de ida-e-volta; fixture de retrocompatibilidade; quinta lei de
// conformidade (schema-capability).

// 1. Os arquivos que a feature promete.
eval("test -f src/table/schema.js && test -f src/fixtures/tabular-pre-8.2.csv && echo OK", (out) =>
  check(out.includes("OK"))
)

// 2. O probe roda os cenarios reais.
eval("bun plans/8-table/8.2.probe.js", (out) => {
  check(out.includes('soml-normalizes-to-pojo: true'))
  check(out.includes('roundtrip: true'))
  check(out.includes('loss: age.default,id.autohash,id.autoinc,id.default,name.default,state.default'))
  check(out.includes('four-axes: {"pk":true,"unique":true,"indexed":true,"nullable":true}'))
  check(out.includes('fixture-fields: name,age,score,active'))
  check(out.includes('fixture-no-pk-no-unique: true'))
  check(out.includes('broken-schema-capability-get: schema-capability'))
  check(out.includes('broken-schema-capability-find: schema-capability'))
})

// 3. A suite do projeto inteira passa.
eval("utest . --force", (out, r) => {
  check(r.exitCode, 0)
  check(!out.includes('✘'))
})

// 4. O FIXTURE NAO MUDOU UM BYTE — commitado antes de parseSchema ser tocado,
//    tem que continuar identico ao fim do sprint.
eval("git diff --stat src/fixtures/tabular-pre-8.2.csv", (out) =>
  check(out.trim(), "")
)

// 5. ESCOPO PRESERVADO: so src/table, src/tabular-projection.js e o fixture
//    foram tocados por ESTA feature. src/adapters/sqlite.js e os src/index-*
//    sao escopo do sprint 024 [2.4], ja aberto antes desta, e ficam de fora
//    do filtro — nao sao regressao desta feature.
eval("git status --porcelain src/ | grep -v '^?? src/table/' | grep -v '^ M src/table/' | grep -v 'src/tabular-projection.js' | grep -v 'src/fixtures/' | grep -v 'src/adapters/sqlite.js' | grep -v 'src/index-contract.js' | grep -v 'src/index-registry.js' | grep -v 'src/index-registry.t.js' | grep -v 'src/index-textpages.js'", (out) =>
  check(out.trim(), "")
)
