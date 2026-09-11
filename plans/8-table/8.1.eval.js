// Roteiro de avaliacao — feature 8.1: o contrato Table como codigo, a suite de
// conformidade como oraculo, e a tabela de memoria como referencia de nivel 0.

// 1. Os quatro arquivos que a feature promete.
eval("test -f src/table/contract.js && test -f src/table/cursor.js && test -f src/table/mem-table.js && test -f src/table/conformance.js && echo OK", (out) =>
  check(out.includes("OK"))
)

// 2. O probe roda os cenarios reais: memTable e uma Table valida de nivel 0
//    (so {schema, scan} — nenhuma capacidade extra), conform() passa inteira,
//    e dois cursores scan() intercalados sao independentes (1,1,2,2 — cada um
//    comeca do zero e avanca por conta propria).
eval("bun plans/8-table/8.1.probe.js", (out) => {
  check(out.includes('isTable: true'))
  check(out.includes('level: 0'))
  check(out.includes('conform-mem-table: true'))
  check(out.includes('interleaved: 1,1,2,2'))

  // 3. A suite e provada pelo que ela REPROVA. Cursores que compartilham
  //    posicao (i unico fechado por closure) quebram a lei de reentrancia;
  //    um find() que sempre devolve a primeira linha quebra a lei de
  //    equivalencia de capacidade. As duas leis certas, nenhuma outra.
  check(out.includes('broken-reentrancy-law: reentrancy'))
  check(out.includes('broken-capability-law: capability-equivalence'))
})

// 4. A suite do projeto inteira passa — a feature nao quebrou nada fora do
//    escopo dela, e os proprios testes do modulo table estao nela.
eval("bun ../utest/utest.js . --force", (out, r) => {
  check(r.exitCode, 0)
  check(!out.includes('✘'))
})

// 5. ESCOPO PRESERVADO: nenhum arquivo fora de src/table foi tocado por esta
//    feature (o oraculo nao mexe no que ele vai avaliar depois).
eval("git status --porcelain src/ | grep -v '^?? src/table/' | grep -v '^ M src/table/'", (out) =>
  check(out.trim(), "")
)
