// Roteiro de avaliacao — feature 8.6: o sqlite vira Table, nivel 5, prova de
// que push-down cabe no contrato.

// 1. Os arquivos que a feature promete.
eval("test -f src/table/sqlite-table.js && echo OK", (out) => check(out.includes("OK")))

// 2. O probe roda os cenarios reais.
eval("bun plans/8-table/8.6.probe.js", (out) => {
  check(out.includes('isTable: true'))
  check(out.includes('level: 5'))
  check(out.includes('has: {"get":true,"find":true,"range":true,"count":true,"filter":true,"group":true}'))
  check(out.includes('conform: true'))
  check(out.includes('plain-level: 1'))
  check(out.includes('plain-has-find: false'))
  check(out.includes('rowsFetched: 10'))
  check(out.includes('rowsFetched-is-order-10: true'))
  check(out.includes('interleaved: a,a,b,b'))
  check(out.includes('null-trap-match: true'))
  check(out.includes('collation-case-sensitive: true'))
  check(out.includes('filter-result: a'))
  check(out.includes('filter-untranslatable: null'))
})

// 3. A suite do projeto, julgada por STATE/FAILS (ISSUES/003).
eval("bun ../utest/utest.js . --force --json", (out) => {
  const rows = JSON.parse(out.trim())
  const bad = rows.filter(r => r.state !== 'passed' || (r.fails && r.fails.length > 0))
  check(bad.length, 0)
})

// 4. ESCOPO PRESERVADO.
eval("git status --porcelain src/ | grep -v '^?? src/table/' | grep -v '^ M src/table/' | grep -v 'src/io-engine.js' | grep -v 'src/adapters/sqlite.js'", (out) =>
  check(out.trim(), "")
)
