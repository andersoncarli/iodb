// Roteiro de avaliação — feature 1.2: saveIndex corrompe sob escrita concorrente
// multi-processo. Corrigido no sprint 002 (temp por-PID + saveIndex sob lock).

// 1. Suite completa continua verde — sem regressão da correção.
eval("utest .", (out, r) => check(r.exitCode, 0))

// 2. O reprodutor multi-processo (8 processos bun reais × 30 writes no mesmo
//    IO(), genesis semeado): antes ~90% ENOENT + perda silenciosa; depois
//    240/240, verify().valid, zero crash.
eval("utest io-engine.concurrency.test.js", (out, r) => {
  check(r.exitCode, 0)
  check(!out.includes("ENOENT"))
})

// 3. saveIndex() usa temp por-PID (não o nome fixo compartilhado).
eval(
  "grep -n 'f.index.*process.pid.*tmp' io-engine.js",
  (out) => check(out.includes("process.pid"))
)
