// Roteiro de avaliacao — feature 6.1: o fswatch para de usar SQLite.
//
// O criterio desta feature nao e "os testes passam". Ela promete tres coisas
// que um teste de unidade nao ve: que o SQLite deixou de ser OBRIGATORIO sem
// deixar de ser POSSIVEL, que a troca aguenta arvores reais, e que o dado
// sobrevive ao processo que o escreveu.

// 1. O NEGATIVO ESTRUTURAL, e ele tem duas metades. O `bun:sqlite` nao pode
//    mais ser o unico caminho — mas tambem nao pode ter sumido: a decisao foi
//    manter os dois backends atras da MESMA interface. E o split nodes/leaves
//    morreu junto (feature 6.4), porque era bookkeeping de SQL e o `kind` ja
//    distingue diretorio de arquivo.
eval("bun plans/6-fswatch/6.1.probe.js", (out) => {
  check(out.includes('bun:sqlite obrigatorio: nao'))
  check(out.includes('backend sqlite disponivel: true'))
  check(out.includes('tabela nodes/leaves: false'))

  // 2. A ARVORE REAL. O fswatch observando o proprio iodb — nao um tmpdir com
  //    tres arquivos. O store e um `.dash` legivel, e nenhum `.sqlite` nasce
  //    quando o backend e o iodb.
  check(out.includes('store: metadata.dash'))
  check(out.includes('sqlite criado: false'))
  check(Number(out.match(/entries: (\d+)/)[1]) > 100)

  // 3. DURABILIDADE. Um processo NOVO le o que o anterior gravou, com a mesma
  //    contagem. Isto e o que separa "escreveu" de "persistiu" — e e o unico
  //    caminho de leitura confiavel hoje, porque a leitura VIVA da projecao
  //    paginada devolve undefined (achado desta feature, requisito da 2.5,
  //    reproducao em 6.1.bug-projecao-viva.probe.js).
  const n = Number(out.match(/entries: (\d+)/)[1])
  check(Number(out.match(/apos reopen: (\d+)/)[1]), n)

  // 4. O CUSTO QUE A DECISAO DE BUFFERIZAR COMPROU. Sem buffer, `io.in()` faz
  //    um fsync por registro (~1.0ms) e uma arvore grande fica inviavel. A
  //    varredura bufferiza porque ela e RECONSTRUTIVEL — e uma leitura do
  //    filesystem, que e a fonte de verdade. O caminho ao vivo nao bufferiza.
  check(Number(out.match(/custo por registro: ([\d.]+)/)[1]) < 1.0)
})

// 5. A SUITE, no runner do projeto. Migrou de `bun:test` para utest, que e o
//    que o `scripts.test` do package.json ja dizia e nao rodava. Inclui os
//    dois testes que o SQLite nunca teve: o flip dir<->file sem `size`
//    residual (a armadilha do `merge` raso) e as duas fabricas respondendo a
//    mesma interface.
eval("utest fswatch/fswatch.t.js --force", (out) => {
  check(out.includes('14'))
  check(!out.includes('✘'))
})
