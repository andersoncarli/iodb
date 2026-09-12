// Roteiro de avaliacao — feature 3.2: o modo de falha do nutshell sob
// concorrencia multi-processo esta CARACTERIZADO como teste que roda.
// Escopo fechado: caracteriza, nao corrige. O modo coordenado e da 4.2.

// 1. O teste existe, e no diretorio do nutshell — ele testa o nutshell, nao o
//    io-engine, e roda com a suite do nutshell.
eval("test -f nutshell/io-nutshell.concurrency.test.js && echo OK", (out) => check(out.includes("OK")))

// 2. Spawna processos DE VERDADE. Promise.all num processo so nao reproduz:
//    um event loop, sem append paralelo real. Mesma razao pela qual o
//    io-engine.concurrency.test.js da 1.2 usa Bun.spawn.
eval("grep -c 'Bun.spawn' nutshell/io-nutshell.concurrency.test.js", (out) => check(Number(out.trim()) >= 1))

// 3. Tem os DOIS casos — o controle de 1 processo e o cenario de 8. Sem o
//    controle, o resultado multi-processo nao se distingue de um bug comum.
eval("grep -c '^test(' nutshell/io-nutshell.concurrency.test.js", (out) => check(out.trim(), "2"))

// 4. A suite do nutshell roda verde. Os 21 checks da 3.1 seguem intactos e os
//    8 novos sao desta feature.
eval("utest nutshell/", (out) => {
  const clean = out.replace(/\[[0-9;]*m/g, "")
  check(clean.includes("io-nutshell.concurrency.test.js"))
  check(/io-nutshell\.concurrency\.test\.js\s*✔8/.test(clean))
  check(/io-nutshell\.t\.js\s*✔21/.test(clean))
})

// 5. O ACHADO, medido AO VIVO — cenario 8x30 na mesma base. As quatro
//    propriedades que definem o modo de falha, inverso ao da 1.2: nada se
//    perde (append POSIX e atomico abaixo de PIPE_BUF), mas a cadeia quebra
//    (cada processo encadeia contra o proprio prefixSet, cego aos outros).
eval("bun plans/3-nutshell/3.2.probe.js 8 30", (out) => {
  check(out.includes("crashed=0"))     // nenhum worker morre
  check(out.includes("records=240"))   // 8x30 — NADA se perde
  check(out.includes("valid=false"))   // a cadeia acusa a quebra
  // distinct varia com o escalonamento (medido 170 e 174 em corridas
  // distintas) — o que a feature afirma e a colisao, nao um valor fixo.
  const m = out.match(/distinct=(\d+)/)
  check(m !== null)
  check(Number(m[1]) < 240)
})

// 6. O CONTROLE — o mesmo motor, um processo so: cadeia integra e chaves
//    unicas. E isto que prova que o item 5 e ausencia de coordenacao, nao
//    defeito de codigo.
eval("bun plans/3-nutshell/3.2.probe.js 1 30", (out) => {
  check(out.includes("crashed=0"))
  check(out.includes("records=30"))
  check(out.includes("distinct=30"))
  check(out.includes("valid=true"))
})

// 7. A doc continua MINIMAL — ganhou UMA frase no bloco "What's Not Here",
//    nao uma secao. O io-nutshell.md documenta o mecanismo, nao o relatorio.
eval("grep -c '^## ' nutshell/io-nutshell.md", (out) => check(out.trim(), "10"))
eval("grep -c 'price of' nutshell/io-nutshell.md", (out) => check(out.trim(), "1"))

// 8. ESCOPO PRESERVADO — caracteriza, nao corrige. Nem o motor do nutshell
//    nem o io-engine e seus vizinhos foram tocados.
eval("git diff --stat HEAD -- nutshell/io-nutshell.js nutshell/io-hash.js io-engine.js hash.js | wc -l", (out) => check(out.trim(), "0"))

// 9. O modo coordenado NAO existe ainda — { lock: true } e entrega da 4.2,
//    junto com a extracao do io-append.js. Vermelho aqui = escopo vazou.
eval("grep -c 'lock' nutshell/io-nutshell.js; true", (out) => check(out.trim(), "0"))
