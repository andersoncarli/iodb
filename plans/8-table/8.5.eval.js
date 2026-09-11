// Roteiro de avaliacao — feature 8.5: o log .dash vira Table, scan() em
// stream, L1 pelo caminho que ja existe, find/range ausentes de proposito.

// 1. O arquivo que a feature promete.
eval("test -f src/table/io-table.js && echo OK", (out) => check(out.includes("OK")))

// 2. O probe roda os cenarios reais.
eval("bun plans/8-table/8.5.probe.js", (out) => {
  check(out.includes('isTable: true'))
  check(out.includes('level: 1'))
  check(out.includes('has: {"get":true,"find":false,"range":false,"count":true,"filter":false,"group":false}'))
  check(out.includes('scan-count: 3'))
  check(out.includes('scan-names: Ana,Bob,Cid'))
  check(out.includes('get-matches-scan: true'))
  check(out.includes('count: 3'))
  check(out.includes('conform: true'))
  check(out.includes('maxLinesLive: 1'))
  check(out.includes('bytesRead-eq-filesize: true'))
  check(out.includes('purity-no-new-record: true'))
})

// 3. A suite do projeto, julgada por STATE/FAILS (ISSUES/003: o agregado
//    `grand` do utest vaza contagem entre arquivos concorrentes e derruba o
//    exit code mesmo com todo state=passed e fails=[]).
eval("bun ../utest/utest.js . --force --json", (out) => {
  const rows = JSON.parse(out.trim())
  const bad = rows.filter(r => r.state !== 'passed' || (r.fails && r.fails.length > 0))
  check(bad.length, 0)
})

// 4. ESCOPO PRESERVADO: src/table + src/io-engine.js (parseLine exportada).
eval("git status --porcelain src/ | grep -v '^?? src/table/' | grep -v '^ M src/table/' | grep -v 'src/io-engine.js'", (out) =>
  check(out.trim(), "")
)
