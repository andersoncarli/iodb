// Roteiro de avaliacao — feature 8.4: a projecao tabular vira Table, com get/
// find/range/count por cima do que a 2.2 ja construiu.

// 1. O arquivo que a feature promete.
eval("test -f src/table/tabular-table.js && echo OK", (out) => check(out.includes("OK")))

// 2. O probe roda os cenarios reais: pk+indexed (get/find/range/count),
//    sem indice (L0+count), descarte de pagina no range, limit(10) O(1).
eval("bun plans/8-table/8.4.probe.js", (out) => {
  check(out.includes('isTable: true'))
  check(out.includes('level3: 4'))
  check(out.includes('get3: {"id":3,"name":"Cid","age":19}'))
  check(out.includes('find-age26: 1,5'))
  check(out.includes('conform-l3: true'))
  check(out.includes('level0: 0'))
  check(out.includes('has-get0: false'))
  check(out.includes('has-count0: true'))
  check(out.includes('count0: 5'))
  check(out.includes('conform-l0: true'))
  check(out.includes('range-discard: true'))
  check(out.includes('range-count: 5'))
  check(out.includes('limit10-len: 10'))
})

// 3. FIXTURE DA 8.2 INTACTO: a suite inteira depende dele; se sumiu, algo
//    concorrente apagou -- ver ISSUES/003. Regenera-lo aqui seria mentir
//    sobre retrocompatibilidade, entao o passo so CONFERE.
eval("test -f src/fixtures/tabular-pre-8.2.csv && md5sum src/fixtures/tabular-pre-8.2.csv", (out) =>
  check(out.includes('a32adc3199b302d5c321d65b49c09845'))
)

// 4. A suite do projeto, julgada por STATE/FAILS (nao pelo exit code bruto).
//    ISSUES/003: o agregado `grand` do utest vaza contagem entre
//    page-cursor.t.js e tabular-table.t.js concorrentes e derruba o exit code
//    mesmo com todo state=passed e fails=[] -- entao o criterio real e o
//    JSON por-arquivo, nao `check(r.exitCode, 0)`.
eval("utest . --force --json", (out) => {
  const rows = JSON.parse(out.trim())
  const bad = rows.filter(r => r.state !== 'passed' || (r.fails && r.fails.length > 0))
  check(bad.length, 0)
})

// 5. ESCOPO PRESERVADO.
eval("git status --porcelain src/ | grep -v '^?? src/table/' | grep -v '^ M src/table/' | grep -v 'src/adapters/sqlite.js' | grep -v 'src/index-contract.js' | grep -v 'src/index-registry.js' | grep -v 'src/index-registry.t.js' | grep -v 'src/index-textpages.js' | grep -v 'src/tabular-projection.js' | grep -v 'src/fixtures/' | grep -v 'src/io-engine.js'", (out) =>
  check(out.trim(), "")
)
