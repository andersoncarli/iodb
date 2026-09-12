// Roteiro de avaliacao — feature 8.3: o cursor preguicoso, scan sem
// materializar, medido em paginas.

// 1. O arquivo que a feature promete.
eval("test -f src/table/page-cursor.js && echo OK", (out) => check(out.includes("OK")))

// 2. O probe roda os cenarios reais contra um PagedText de 404 paginas.
eval("bun plans/8-table/8.3.probe.js", (out) => {
  check(out.includes('pageCount: 404'))
  check(out.includes('first10-len: 10'))
  check(out.includes('limit10-is-O1: true'))
  check(out.includes('interleaved: line-0|line-0|line-1|line-1'))
  check(out.includes('monotonic: true'))
  check(out.includes('maxLive: 1'))
  check(out.includes('finalPagesRead: 404'))
  check(out.includes('storePageCount: 404'))
  check(out.includes('after-close: null'))
})

// 3. A suite do projeto inteira passa.
eval("utest . --force", (out, r) => {
  check(r.exitCode, 0)
  check(!out.includes('✘'))
})

// 4. ESCOPO PRESERVADO: so src/table foi tocado por esta feature (fora o que
//    ja e escopo do sprint 024 [2.4], aberto antes desta).
eval("git status --porcelain src/ | grep -v '^?? src/table/' | grep -v '^ M src/table/' | grep -v 'src/adapters/sqlite.js' | grep -v 'src/index-contract.js' | grep -v 'src/index-registry.js' | grep -v 'src/index-registry.t.js' | grep -v 'src/index-textpages.js' | grep -v 'src/tabular-projection.js' | grep -v 'src/fixtures/' | grep -v 'src/io-engine.js'", (out) =>
  check(out.trim(), "")
)
