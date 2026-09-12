// Roteiro de avaliacao — feature 2.0: o pagedtext e o primitivo unico, e a
// escrita e page-local.
//
// A prova e em BYTES e nao em grep. A 2.5 foi rebaixada justamente por ter
// passado por metrica-proxy: checou alinhamento de pagina, que e condicao
// necessaria e nao suficiente.

// 1. O PADDING, EM DOIS EDITORES LADO A LADO. Dois TextBuffer do scl/editor
//    sobre o MESMO arquivo paginado: a esquerda os bytes crus com o filling
//    visivel, a direita as linhas logicas que a API devolve.
//
//    O contraste E o argumento: o filling e capacidade FISICA dentro da pagina
//    e nunca aparece na face logica. E quem decide onde a pagina termina e a
//    contagem do header, nao a corrida de espacos — um editor que aparasse os
//    espacos finais nao mudaria uma linha logica sequer.
eval("bun plans/2-pagedtext/2.0.pages.probe.js", (out) => {
  const cruas = Number(out.match(/linhas cruas: (\d+)/)[1])
  const fill = Number(out.match(/linhas cruas: \d+\s+—\s+(\d+) delas sao filling/)[1])
  const logicas = Number(out.match(/linhas logicas: (\d+)/)[1])
  const fillLogico = Number(out.match(/linhas logicas: \d+\s+—\s+(\d+) de filling/)[1])
  check(fill > 0)                    // ha filling de verdade nos bytes crus
  check(cruas > logicas)             // e ele ocupa espaco fisico
  check(fillLogico, 0)               // e nao vaza para a face logica
  check(out.includes('multiplo de 4096: true'))   // o invariante de alinhamento
})

// 2. O BENCH, COM FENCE DE TEMPO DE 900ms. Fence de TEMPO e nao de ciclos: um
//    numero fixo de escritas faz a duracao da celula depender de quao lento o
//    motor esta, que e justamente o que se quer medir (a regra da 4.2).
//
//    O caso medido e o dos docs: CSV append-only sobre arquivo grande. E o
//    criterio e que o custo do append NAO cresca com o arquivo — um arquivo 39x
//    maior tem que custar o mesmo por append.
eval("bun plans/2-pagedtext/2.0.bench.probe.js", (out) => {
  check(out.includes('fence: 900ms'))
  const linhas = out.split('\n').filter(l => /^\s+\d+ \|/.test(l))
  check(linhas.length >= 3)                       // as tres celulas rodaram
  const perAppend = []
  for (const l of linhas) {
    const col = l.split('|').map(x => x.trim())
    check(Number(col[3]) > 0)                     // houve appends
    check(Number(col[4]) <= 1100)                 // ~900ms + a ultima escrita
    perAppend.push(Number(col[7]))
  }
  // UMA pagina de dados por append, em qualquer tamanho de arquivo. E a
  // entrega da feature, e o que separa escrita page-local de reescrita.
  for (const p of perAppend) check(p < 1.5)
  check(out.includes('veredito: PLANO'))
})

// 3. UM PRIMITIVO SO. O paged-projection deixou de ser uma segunda
//    implementacao da mesma coisa: ele importa o pagedtext e nao abre fd, nao
//    renomeia, nao faz fsync. Era a duplicacao que a feature existe para matar.
eval("grep -c \"from '../pagedtext/pagedtext.js'\" src/paged-projection.js", (out) => check(Number(out.trim()) >= 1))
eval("grep -v '^ \\*' src/paged-projection.js | grep -c 'openSync\\|renameSync\\|fsyncSync\\|writeFileSync'", (out) => check(out.trim(), "0"))
eval("grep -c 'PAGEDPROJ' src/paged-projection.js", (out) => check(out.trim(), "0"))

// 4. O `dirty` DEIXOU DE SER MENTIRA. Antes ele era escrito em quatro lugares e
//    nunca lido em posicao de decisao; `ftruncateSync` era importado e nunca
//    chamado. Agora ha um conjunto sujo que governa o que se escreve, e o
//    truncate roda quando o arquivo encolhe.
eval("grep -c 'dirty.add\\|dirty.clear\\|\\[...dirty\\]' pagedtext/pagedtext.js", (out) => check(Number(out.trim()) >= 4))
eval("grep -c 'ftruncateSync(fd' pagedtext/pagedtext.js", (out) => check(Number(out.trim()) >= 1))

// 5. O HEADER E O GENESIS, E AS STATS FICAM NO RODAPE. Era isso que fazia o
//    custo do append crescer: counts[]/extents[] tem uma entrada por pagina, e
//    estando no header eles eram reescritos a cada commit. O header agora so
//    carrega o que nunca muda; o que muda vai para o trailer, no fim, onde
//    crescer nao empurra pagina nenhuma. E o rodape pode ser volatil (a cada
//    flush) ou checkpoint (a cada N), porque nao e fonte de verdade: as paginas
//    sao autodescritivas e o reconstroem.
eval("grep -c 'HEADER_VERSION = 3' pagedtext/pagedtext.js", (out) => check(out.trim(), "1"))
eval("grep -c 'TRAILER_MARK' pagedtext/pagedtext.js", (out) => check(Number(out.trim()) >= 4))
eval("grep -c 'checkpointEvery' pagedtext/pagedtext.js", (out) => check(Number(out.trim()) >= 3))
// Versao desconhecida tem desfecho DISTINTO de nao-ter-header: antes ela caia
// no migrador de texto legado, que reinterpretava o arquivo e chamava flush(),
// destruindo-o.
eval("grep -c 'UNKNOWN' pagedtext/pagedtext.js", (out) => check(Number(out.trim()) >= 3))

// 6. O INVARIANTE DE ALINHAMENTO, que e o pre-requisito da escrita posicionada:
//    sem toda pagina ocupando um multiplo exato de pageSize, o offset de uma
//    pagina nao e calculavel. Linha maior que a pagina ocupa k paginas, e k
//    esta no header.
eval("grep -c 'extentOf' pagedtext/pagedtext.js", (out) => check(Number(out.trim()) >= 3))

// 7. O MEIO-CONSERTO DA 2.5 FECHOU: o recompute DENTRO do lock usa a mesma
//    copia que o de fora, com o ramo Array.isArray. Antes ele inlinava
//    `{ ...projection }` e convertia uma projecao append de array para objeto.
// O `{ ...projection }` que resta e o RAMO INTERNO do proprio _projCopy, que e
// legitimo: ele so e alcancado quando a projecao nao e array. O que a 2.5
// deixou pela metade foi o site DENTRO do lock, que inlinava a copia sem esse
// ramo. A assercao segue o invariante: existe UM dono da copia, e os dois
// call-sites chamam ele.
eval("grep -c 'const _projCopy = ' src/io-engine.js", (out) => check(out.trim(), "1"))
eval("grep -c '_projCopy()' src/io-engine.js", (out) => check(Number(out.trim()) >= 2))

// 8. O BATCHING SAIU DOS TESTES. Ele existia para contornar a reescrita total:
//    uma escrita por registro era O(n^2). O comentario que o admitia era a
//    confissao do defeito no proprio codigo de teste.
eval("grep -c 'flush: 0' src/io-engine.paged.t.js", (out) => check(out.trim(), "0"))
eval("utest src/io-engine.paged.t.js --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
})

// 9. O TETO DE RAM, que e a manchete da 2.5 e que o pagedtext nao tinha: o
//    cache era um Map sem eviccao, entao qualquer varredura materializava o
//    arquivo inteiro. Os dois testes novos cobrem o teto e a versao desconhecida.
eval("utest pagedtext/pagedtext.t.js --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(/✔\s*54/.test(clean))
  check(!clean.includes("✘"))
})

// 10. SUITE VERDE — 399 de antes mais os 9 novos. Convergir duas
//    implementacoes numa so nao pode custar comportamento.
//    Bench e suite nunca no mesmo eval (medido na 4.2): disputam CPU.
eval("utest . --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(/✔\s*408/.test(clean))
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
})
