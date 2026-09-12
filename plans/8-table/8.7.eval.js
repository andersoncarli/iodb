// Roteiro de avaliacao — feature 8.7: o catalogo, db.users resolve uma
// Table, tarde e sem tocar o disco. Ultima feature da frente 8.

// 1. O arquivo que a feature promete.
eval("test -f src/table/catalog.js && echo OK", (out) => check(out.includes("OK")))

// 2. O probe roda os cenarios reais.
eval("bun plans/8-table/8.7.probe.js", (out) => {
  check(out.includes('node-shape: {"op":"source","name":"users"}'))
  check(out.includes('foo-node-shape: {"op":"source","name":"foo"}'))
  check(out.includes('no-syscall-on-access: true'))
  check(out.includes('identity-stable: true'))
  check(out.includes('isTable-csv: true'))
  check(out.includes('conform-csv: true'))
  check(out.includes('isTable-dash: true'))
  check(out.includes('conform-dash: true'))
  check(out.includes('same-data: true'))
  check(out.includes('caps-csv-level: 4'))
  check(out.includes('caps-dash-level: 1'))
  check(out.includes('missing-is-null: true'))
  check(out.includes('exec-cache: true'))
})

// 3. A suite do projeto, julgada por STATE/FAILS (ISSUES/003).
eval("utest . --force --json", (out) => {
  const rows = JSON.parse(out.trim())
  const bad = rows.filter(r => r.state !== 'passed' || (r.fails && r.fails.length > 0))
  check(bad.length, 0)
})

// 4. ESCOPO PRESERVADO: src/table, db-factory.js, e o que ja e de outros
//    sprints abertos (io-engine.js, adapters/sqlite.js).
eval("git status --porcelain src/ | grep -v 'src/table/' | grep -v 'src/io-engine.js' | grep -v 'src/adapters/sqlite.js' | grep -v 'src/db-factory.js' | grep -v 'src/db-factory.t.js'", (out) =>
  check(out.trim(), "")
)
