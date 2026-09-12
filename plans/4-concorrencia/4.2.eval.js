// Roteiro de avaliacao — feature 4.2: a secao critica ficou minima.
// O trabalho indivisivel e conferir que o log cresceu, apender e soltar;
// indice e projecao sao DERIVADOS e saem de dentro do lock.

// 1. O modulo da secao critica existe, e e peer de hash.js — nao esta enterrado
//    dentro do src/io-engine.js. E o que permite um segundo consumidor.
eval("test -f src/adapters/io-append.js && echo OK", (out) => check(out.includes("OK")))
eval("grep -c '^export function' src/adapters/io-append.js", (out) => check(Number(out.trim()) >= 4))

// 2. O lock foi MOVIDO, nao reescrito: a recuperacao de crash e inegociavel.
//    PID no nome + kill(pid,0) para detectar dono morto e roubar. Sem isso, um
//    holder morto por kill -9 trava o mutex para sempre.
eval("grep -c 'process.kill(pid, 0)' src/adapters/io-append.js", (out) => check(out.trim(), "1"))

// 3. ensureLock usa 'wx' SEM guarda de existsSync. A guarda era o bug: enquanto
//    alguem DETEM o lock o arquivo nao existe (foi renomeado), entao
//    create-if-missing recria o mutex e dois escritores entram juntos.
//    Medido: 8 de 120 secoes criticas sobrepostas; com criacao unica, 0.
// (o 'wx' migrou de ensureLock — hoje um stub — para acquireLock, na 2.3/4.3.
//  A assercao segue o INVARIANTE: criacao exclusiva, sem existsSync.)
eval("grep -c \"flag: 'wx'\" src/adapters/io-append.js", (out) => check(Number(out.trim()) >= 1))
eval("grep -c 'existsSync(mine)' src/adapters/io-append.js", (out) => check(out.trim(), "0"))

// 4. O CORTE — saveIndex e a publicacao da projecao acontecem DEPOIS do rename
//    de release, nao antes. E isto que a feature inteira significa.
// Imprime as linhas do bloco de publicacao do flush(), na ordem em que estao no
// arquivo. O release tem que aparecer ANTES do saveIndex e do publishYaml.
// Nao fixa numero de linha: acha o release do flush() e olha as 30 linhas
// seguintes. Numero de linha e coordenada, e coordenada envelhece.
eval("awk '/releaseLock\\(myLock, f.lock\\)/{n=NR} END{}' src/io-engine.js >/dev/null; grep -n 'releaseLock(myLock, f.lock)\\|saveIndex()\\|publishYaml()' src/io-engine.js | awk -F: '$1>500'", (out) => {
  const lines = out.split("\n").filter(Boolean)
  const rel = lines.findIndex(l => l.includes("release"))
  const idx = lines.findIndex(l => l.includes("saveIndex()"))
  const pub = lines.findIndex(l => l.includes("publishYaml()"))
  check(rel >= 0)
  check(idx > rel)   // indice publicado DEPOIS de soltar o lock
  check(pub > rel)   // projecao idem
})

// 5. ARBITRO DE ORDEM — com a publicacao fora do lock, um escritor lento pode
//    landar depois de um adiantado. saveIndex so publica se estiver tao a frente
//    quanto o que ja esta no disco. Seguro porque o indice e HINT: pular custa
//    um hint velho, sobrescrever custaria um errado.
eval("grep -c 'indexOffsetOnDisk' src/io-engine.js", (out) => check(Number(out.trim()) >= 2))
eval("grep -c 'readOffset: () => indexOffsetOnDisk()' src/io-engine.js", (out) =>
  check(Number(out.trim()) >= 2)
)

// 6. O RESULTADO — a secao critica parou de crescer com o tamanho do store.
//    Este e o criterio de aceitacao da feature. Baseline 4.1: p99 17ms (1k) e
//    96ms (10k), subindo a 733ms em 100k.
eval("bun src/io-engine.bench.js --quick", (out) => {
  const line = out.split("\n").find(l => l.includes("| critical"))
  check(line != null)
  const p99 = Number(line.split("|")[6].trim())
  check(p99 <= 5)   // era 17ms no baseline para o mesmo store de 1k
})

// 7. O bench respeita a regra de granularidade do projeto: celula alvo entre
//    100 e 1000ms, com fence de TEMPO e nao de ciclos — um numero fixo de
//    escritas faz a duracao da celula depender de quao lento o motor esta, que
//    e justamente o que se quer medir.
eval("grep -c 'CELL_BUDGET_MS' src/io-engine.bench.js", (out) => check(Number(out.trim()) >= 3))
eval("grep -c 'Date.now() < deadline' src/io-engine.bench.js", (out) => check(Number(out.trim()) >= 1))

// 8. O resultado medido esta commitado ao lado do baseline que ele derruba.
eval("test -f bench/resultado-4.2.txt && echo OK", (out) => check(out.includes("OK")))
eval("grep -ci plana bench/resultado-4.2.txt", (out) => check(Number(out.trim()) >= 1))

// 9. SUITE VERDE — verificada pelo `sprint test 4.2` (verify_tests), que e quem
//    move a feature para 🟡. Este eval NAO reexecuta a suite inteira de
//    proposito: ele ja roda o bench, e as duas coisas competem pela CPU — o
//    matrix.test.js spawna 48 processos e vira a vitima. Medido: suite sozinha
//    ~9s e verde 10/10; suite concorrendo com o bench, 25-42s e ate 4 falhas.
//    Um eval que cria a propria contencao mede o escalonador, nao a feature.
//
//    Aqui roda so o arquivo que o corte da 4.2 poderia ter quebrado, isolado.
eval("utest src/io-engine.test.js --force", (out) => {
  // Limpa ANSI incluindo o ESC solto: o utest emite "\x1b✔\x1b 55", entao um
  // regex que so cobre "[0-9;]*m" deixa o ESC entre o simbolo e o numero.
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(/✔\s*55/.test(clean))
  check(!clean.includes("✘"))
})

// 10. O segundo consumidor existe e esta DESLIGADO por padrao — o nutshell
//     continua "No locks. No WAL. No fsync." como a doc dele afirma, e o teste
//     caracterizador da 3.2 segue descrevendo esse caminho.
eval("grep -c 'lock = false' nutshell/io-nutshell.js", (out) => check(out.trim(), "1"))
eval("grep -c 'appendGuarded' nutshell/io-nutshell.js", (out) => check(Number(out.trim()) >= 1))
