// Roteiro de avaliacao — feature 3.3: lock de presenca portado para o nutshell
// (opt-in), as duas engines comparadas sob a mesma carga, e a interface
// convergida no que nao toca os call sites do io-engine.
//
// Escopo: portar + comparar + convergir API do lado do nutshell. A unificacao
// dura da assinatura IO() e o genesis lazy do io-engine sao sprint proprio.

// ── PORTAR O PROTOCOLO ──────────────────────────────────────────────────────

// 1. O nutshell importa o protocolo compartilhado — nao tem copia propria.
eval("grep -c \"from '../src/adapters/io-append.js'\" nutshell/io-nutshell.js",
  (out) => check(Number(out.trim()) >= 1))

// 2. O caminho ligado passa pela secao critica compartilhada (appendGuarded),
//    e repassa o hook de timing pra ela.
eval("grep -c 'appendGuarded' nutshell/io-nutshell.js", (out) => check(Number(out.trim()) >= 1))
eval("grep -c 'onPhase' nutshell/io-nutshell.js", (out) => check(Number(out.trim()) >= 1))

// 3. ensureLock e chamado UMA vez, na construcao — nunca dentro de flush().
//    Recriar a mutex mid-flush sob ausencia=livre poria dois escritores na
//    secao critica (a armadilha que o sprint 007 mediu).
eval("grep -c 'ensureLock' nutshell/io-nutshell.js", (out) => check(Number(out.trim()) >= 1))
eval("awk 'BEGIN{c=0} /function flush\\(\\)/{f=1} f&&/ensureLock/{c++} /^  }$/{f=0} END{print c}' nutshell/io-nutshell.js",
  (out) => check(out.trim(), "0"))

// ── CONTRATO PRESERVADO ─────────────────────────────────────────────────────

// 4. lock=false continua o default declarado.
eval("grep -c 'lock = false' nutshell/io-nutshell.js", (out) => check(out.trim(), "1"))

// 5. A doc continua dizendo "No locks. No WAL. No fsync." — o lock e opt-in,
//    nao o novo normal.
eval("grep -c 'No locks. No WAL. No fsync.' nutshell/io-nutshell.md", (out) => check(out.trim(), "1"))

// 6. O teste caracterizador da 3.2 (modo sem lock) segue valendo: os dois
//    casos originais continuam no arquivo.
eval("grep -c '3.2 —' nutshell/io-nutshell.concurrency.test.js", (out) => check(Number(out.trim()) >= 2))

// ── SEGURANCA SOB CARGA (o criterio da feature) ─────────────────────────────

// 7. Suite de concorrencia verde. 13 checks: os da 3.2 (caracterizacao do modo
//    sem lock) mais o caso 3.3 do modo com lock. NAO ha um "{ lock:false }
//    inalterado" separado — o proprio teste "3.2 — 8 concurrent writers" e a
//    guarda dessa regressao; re-spawnar 8 processos pra afirmar o identico so
//    seria hog.
eval("utest nutshell/io-nutshell.concurrency.test.js --force 2>&1 | sed 's/\\x1b\\[[0-9;]*m//g'", (out) => {
  check(!out.includes("💥"))
  check(/\b13\b/.test(out))
})
eval("grep -c '3.3 —.*lock: true' nutshell/io-nutshell.concurrency.test.js", (out) => check(Number(out.trim()) >= 1))

// 8. AO VIVO — o caso do criterio textual (8 workers, lock ligado: 240/240,
//    zero crash, zero timeout) roda sem 💥.
eval("utest nutshell/io-nutshell.concurrency.test.js --force 2>&1 | sed 's/\\x1b\\[[0-9;]*m//g'",
  (out) => check(!out.includes("💥")))

// ── COMPARACAO ENTRE ENGINES ───────────────────────────────────────────────

// 9. O bench comparativo existe e roda as DUAS engines pela mesma carga, com
//    a mesma medicao de lock (io-append.js onPhase / io-engine t._*Ns).
eval("test -f bench/compare-3.3.js && echo OK", (out) => check(out.includes("OK")))
eval("grep -c \"bench('engine')\" bench/compare-3.3.js", (out) => check(Number(out.trim()) >= 1))
eval("grep -c \"bench('nutshell')\" bench/compare-3.3.js", (out) => check(Number(out.trim()) >= 1))
eval("grep -cE '_lockWaitNs|_criticalNs' bench/compare-3.3.js", (out) => check(Number(out.trim()) >= 1))
eval("grep -c onPhase bench/compare-3.3.js", (out) => check(Number(out.trim()) >= 1))

// 10. AO VIVO — a comparacao roda ate o fim e imprime as duas tabelas
//     (custo por op + tempo no lock) sem crash.
eval("bun bench/compare-3.3.js 3 400 100 2", (out) => {
  check(out.includes("custo por io.in()"))
  check(out.includes("tempo NO LOCK"))
  check(out.includes("| engine    |"))
  check(out.includes("| nutshell  |"))
  check(!out.includes("crashed"))
})

// 11. A tabela commitada, ao lado dos baselines existentes em bench/.
eval("ls bench/ | grep -c 'resultado-3.3.txt'", (out) => check(out.trim(), "1"))
eval("grep -c 'DIFERENCA DE DESENHO' bench/resultado-3.3.txt", (out) => check(out.trim(), "1"))
//     A diferenca de desenho REGISTRADA, nao mediada: o resultado explica por
//     que o nutshell e mais leve (publica menos), nao afirma que trava melhor.
eval("grep -ciE 'publica|publicar' bench/resultado-3.3.txt", (out) => check(Number(out.trim()) >= 1))

// ── CONVERGENCIA DE INTERFACE (lado do nutshell) ────────────────────────────

// 12. open/close existem no nutshell e sao no-ops chainaveis — codigo escrito
//     pra io-engine (open() ... close()) roda aqui sem branch.
eval("grep -c 'open(initPayload)' nutshell/io-nutshell.js", (out) => check(Number(out.trim()) >= 1))
eval("grep -c 'close() { return this }' nutshell/io-nutshell.js", (out) => check(Number(out.trim()) >= 1))

// 13. header/state/find alinhados com o io-engine.
eval("grep -cE 'header\\(\\)|state\\(\\)|find\\(pred\\)' nutshell/io-nutshell.js", (out) => check(Number(out.trim()) >= 3))

// 14. Os casos de convergencia existem no arquivo de testes...
eval("grep -c 'open/close are optional no-ops' nutshell/io-nutshell.t.js", (out) => check(out.trim(), "1"))
eval("grep -c 'open(payload) seeds record #0' nutshell/io-nutshell.t.js", (out) => check(out.trim(), "1"))
eval("grep -c 'header / state / find match' nutshell/io-nutshell.t.js", (out) => check(out.trim(), "1"))
// ...e a suite roda verde AO VIVO (32 checks, sem 💥).
eval("utest nutshell/io-nutshell.t.js --force 2>&1 | sed 's/\\x1b\\[[0-9;]*m//g'", (out) => {
  check(!out.includes("💥"))
  check(/\b32\b/.test(out))
})

// 15. A doc registra a interop sem inflar: uma subsecao em The Interface, nao
//     uma reescrita. O nutshell continua "five verbs" no titulo.
eval("grep -c 'Interop with io-engine' nutshell/io-nutshell.md", (out) => check(out.trim(), "1"))
eval("grep -c '^## ' nutshell/io-nutshell.md", (out) => check(out.trim(), "10"))

// ── ESCOPO: A UNIFICACAO DURA NAO VAZOU ─────────────────────────────────────

// 16. io-engine.js so ganhou as marcas hrtime pro bench — nada de assinatura
//     nova, nada de genesis lazy. Os call sites (test/concurrency/matrix/bench/
//     db-factory) estao intocados.
eval("git diff --stat HEAD -- src/io-engine.test.js src/io-engine.concurrency.test.js src/io-engine.matrix.test.js src/io-engine.bench.js src/db-factory.js | wc -l",
  (out) => check(out.trim(), "0"))
eval("git diff HEAD -- src/io-engine.js | grep -E '^\\+' | grep -c 'lockWaitNs\\|criticalNs\\|hrtime'",
  (out) => check(Number(out.trim()) >= 1))

// 17. Regressao: io-engine e db-factory seguem verdes (as 6 falhas de
//     io-engine.matrix.test.js sao pre-existentes — defeito 1.5, ainda aberto).
eval("utest src/io-engine.test.js --force 2>&1 | sed 's/\\x1b\\[[0-9;]*m//g'", (out) => {
  check(!out.includes("💥"))
  check(/\b55\b/.test(out))     // 55 checks, all green
})
eval("utest src/db-factory.t.js --force", (out) => {
  const clean = out.replace(/\[[0-9;]*m/g, "")
  check(!/💥/.test(clean))
})
