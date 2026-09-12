// Roteiro de avaliação — feature 1.3: matriz de concorrência multi-processo.
// Caracterização, não correção — ver plano do sprint 003.

// 1. A matriz roda inteira e passa (6 células: seed=true × format × reduce,
//    no-seed characterisation, close=0).
eval("utest io-engine.matrix.test.js", (out, r) => {
  check(r.exitCode, 0)
  check(!out.includes("ENOENT"))
})

// 2. Suite completa continua verde — a matriz não regride nada.
eval("utest .", (out, r) => check(r.exitCode, 0))

// 3. O arquivo cobre os quatro eixos — cada nome de eixo aparece na assinatura
//    de runCell e nos loops/células.
eval("grep -c 'runCell({' io-engine.matrix.test.js", (out) =>
  check(Number(out.trim()) >= 3)
)
eval(
  "grep -oE 'seed: (true|false)|reducer of|format of' io-engine.matrix.test.js | sort -u | tr '\\n' ' '",
  (out) => {
    check(out.includes("seed: false"))
    check(out.includes("seed: true"))
    check(out.includes("format of"))
    check(out.includes("reducer of"))
  }
)
