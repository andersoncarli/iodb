// Roteiro de avaliacao — feature 3.1: o nutshell roda NESTE repo e reproduz
// os proprios numeros. Escopo fechado: produz a evidencia, nao a decisao de
// arquitetura (assimilar no io-engine.js vs. virar a nova base).

// 1. Os 8 arquivos do nutshell existem — o par motor+doc, os 3 adapters/hash,
//    e os 3 executaveis (teste, smoke, demo).
eval("ls nutshell/ | wc -l", (out) => check(out.trim(), "8"))
eval("test -f nutshell/io-nutshell.js && echo OK", (out) => check(out.includes("OK")))
eval("test -f nutshell/io-nutshell.md && echo OK", (out) => check(out.includes("OK")))

// 2. O motor cabe no que a doc promete: "~190 linhas". 161 hoje — a doc nao
//    mente para cima, que e o unico sentido que importaria.
eval("wc -l < nutshell/io-nutshell.js", (out) => check(Number(out.trim()) <= 190))

// 3. DEFEITO 1 corrigido — o teste esperava 'buf.dash', residuo da nomenclatura
//    do io-engine.js; o nutshell escreve .jsonl. Nenhum 'dash' sobra no diretorio.
eval("grep -rl dash nutshell/ --exclude-dir=.utest | wc -l", (out) => check(out.trim(), "0"))
eval("grep -n \"buf.jsonl\" nutshell/io-nutshell.t.js", (out) => check(out.length > 0))

// 4. DEFEITO 2 corrigido — fromB64 vem de io-hash.js (onde mora), nao de
//    io-nutshell.js (que nao o reexporta). O motor nao alarga a superficie
//    para servir um consumidor de benchmark.
eval("grep -n \"from './io-hash.js'\" nutshell/smoke-io.js", (out) =>
  check(out.includes("fromB64"))
)
eval("grep -c 'export function fromB64' nutshell/io-hash.js", (out) => check(out.trim(), "1"))
eval("grep -c 'export.*fromB64' nutshell/io-nutshell.js; true", (out) => check(out.trim(), "0"))

// 4b. Imports mortos removidos do motor: canonical/sha64/toB64/fromB64 eram
//     importados de io-hash.js e nunca usados. So as 4 primitivas vivas ficam.
eval("grep -n \"from './io-hash'\" nutshell/io-nutshell.js", (out) => {
  check(out.includes("toBits"))
  check(out.includes("makeFullKey"))
  check(!out.includes("canonical"))
  check(!out.includes("sha64"))
})

// 5. A suite do nutshell passa inteira pelo runner do projeto. `test`, `check`
//    e `withTempDir` sao globais injetados pelo utest — rodar com `bun` direto
//    da ReferenceError, e isso NAO e defeito do codigo.
eval("utest nutshell/ --force", (out, r) => {
  check(r.exitCode, 0)
  check(out.includes("io-nutshell.t.js"))
})

// 6. Smoke: escreve 1000 registros e a cadeia de hash verifica. A chave E a
//    prova — verify() re-deriva cada chave do payload e do antecessor.
eval("bun nutshell/smoke-io.js", (out, r) => {
  check(r.exitCode, 0)
  check(out.includes("valid (1002 records)"))
})

// 7. ACHADO — o throughput de escrita NAO reproduz o numero da doc de forma
//    estavel. A doc publica "~9.000 rec/s"; medido aqui em 6 corridas o valor
//    vai de 2.283 a 9.093 rec/s (mediana ~6.000), e cai a ~4.000 quando roda
//    sob a carga do proprio eval. O 11.300 rec/s da primeira medicao era o
//    topo da faixa, nao o tipico.
//
//    O numero da doc portanto NAO esta confirmado: e alcancavel, nao tipico.
//    O check afirma so o que se sustenta — que o smoke completa e reporta um
//    throughput mensuravel — e deixa o valor publicado como questao aberta
//    para um sprint de benchmark honesto (a 4.1 fez isso para o io-engine).
eval("bun nutshell/smoke-io.js", (out) => {
  const m = out.match(/\((\d+) rec\/s\)/)
  check(m !== null)
  check(Number(m[1]) > 1000)
})

// 8. A curva de profundidade de chave e a propriedade emergente que a doc
//    descreve: prefixo binario unico mais curto, com pico em depth 10.
eval("bun nutshell/smoke-io.js | grep -E '^  10 '", (out) => check(out.length > 0))

// 9. Demo roda as 5 secoes ate o fim, incluindo o ping-pong reativo (1000
//    round-trips sincronos, cada .out() escrevendo no outro stream).
eval("bun nutshell/demo-io.js", (out, r) => {
  check(r.exitCode, 0)
  check(out.includes("1000 round-trips"))
  check(out.includes("Demo complete"))
})

// 10. ESCOPO PRESERVADO: nenhum arquivo do io-engine.js / frentes 1-2 foi
//     tocado. O nutshell declara "No locks. No WAL. No fsync." enquanto a
//     frente 2 endurece exatamente essa concorrencia — o conflito fica para
//     um sprint de decisao, com esta evidencia na mao.
eval("git diff --stat HEAD -- io-engine.js hash.js db-factory.js node-core.js", (out) =>
  check(out.trim(), "")
)

// 11. RUIDO CONHECIDO, registrado para quem vier depois. `utest .` (a suite
//     inteira) faz io-engine.concurrency.test.js falhar; isolado ele passa
//     18/18, medido 5x seguidas. Os 8 arquivos do nutshell deixam a suite
//     ~44% mais lenta (16s -> 23s) e esses testes multi-processo sao
//     sensiveis a timing sob carga — perdem registros (ex.: 210 de 240
//     esperados), nao corrompem. NAO e regressao do nutshell: sem o
//     diretorio, a suite passa 220/220; o nutshell nao importa, nao e
//     importado por, e nao compartilha arquivo com o io-engine.
//
//     Por isso este passo NAO re-executa aquele teste: ele falha sob a carga
//     que o proprio eval cria, o que o tornaria um check instavel. O que se
//     verifica aqui e o ISOLAMENTO — a razao pela qual o ruido e ruido.
eval("grep -rl 'io-engine' nutshell/ --exclude-dir=.utest | wc -l", (out) =>
  check(out.trim(), "0")
)
eval("grep -rl 'nutshell' io-engine.js hash.js db-factory.js node-core.js | wc -l", (out) =>
  check(out.trim(), "0")
)
