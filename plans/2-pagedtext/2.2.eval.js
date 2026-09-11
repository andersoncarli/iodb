// Roteiro de avaliacao — feature 2.2: projecao tabular, csv tipado com indice
// por pagina.
//
// A prova e em PAGINAS LIDAS e em ferramenta de terceiro. Grep nao serve aqui:
// a feature promete que um range CUSTA menos, e custo so se mostra medindo.
// (A 2.5 ja foi rebaixada uma vez por ter passado por metrica-proxy.)

// 1. O IDA-E-VOLTA COM OS QUATRO TIPOS E COM NULL, e o schema na primeira
//    linha do proprio arquivo. Os dois criterios literais da feature.
//
//    O schema na linha 1 e o que a 2.1 tornou possivel: enquanto a pagina 0
//    era JSON de header e metade do arquivo era byte NUL, a primeira linha ja
//    estava ocupada e o arquivo nem sequer era texto.
eval("bun plans/2-pagedtext/2.2.probe.js", (out) => {
  check(out.includes('roundtrip identico: true'))
  check(out.includes('primeira linha e o schema: true'))
  check(out.includes('schema relido: name:str,age:int?,score:float,active:bool,note:str?'))

  // 2. O INDICE POR PAGINA, que e a razao de a feature morar nesta frente.
  //    O numero e reportado, nao so comparado — a feature pede a medicao.
  const varredura = Number(out.match(/paginas: varredura=(\d+)/)[1])
  const range = Number(out.match(/paginas: varredura=\d+ range=(\d+)/)[1])
  check(Number(out.match(/registros: (\d+)/)[1]), 20000)
  check(varredura > 50)              // um arquivo de muitas paginas, nao um brinquedo
  check(range < varredura / 10)      // ordem de grandeza, nao uma pagina a menos
  check(out.includes('range correto: true'))

  // 3. A COLUNA SEM INDICE continua CORRETA, so mais cara. O indice muda o
  //    custo; nunca a resposta.
  const semIdx = Number(out.match(/sem indice: paginas=(\d+)/)[1])
  check(semIdx, varredura)
  check(out.includes('correto=true'))

  // 4. O DESCARTE E PELO MIN/MAX, e nao um filtro depois de ler tudo. Uma
  //    faixa fora de todo o intervalo abre ZERO paginas — o que um filtro
  //    pos-leitura nao conseguiria.
  check(out.includes('faixa fora de tudo: paginas=0'))

  // 5. O ARQUIVO CONTINUA SENDO DE TERCEIRO (a doutrina da 2.1): file(1) diz
  //    CSV, o alinhamento de pagina se mantem, e um DictReader que nao conhece
  //    o formato le os 20000 registros.
  check(out.includes('file -b: CSV ASCII text'))
  check(out.includes('alinhado a 4096: true'))
  check(out.includes('python DictReader: 20000 n0 n19999'))
})

// 6. SUITE VERDE, com contagem exata. Os dois alvos rodam em comandos
//    SEPARADOS: `utest a b` roda so o primeiro e descarta o segundo em
//    silencio (registrado em UTEST-ISSUE.md), entao um eval que os juntasse
//    daria verde sobre codigo nunca executado.
eval("bun ../utest/utest.js src --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(Number([...clean.matchAll(/✔\s*(\d+)/g)].pop()[1]) >= 395)
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
})
eval("bun ../utest/utest.js pagedtext --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(Number([...clean.matchAll(/✔\s*(\d+)/g)].pop()[1]) >= 71)
  check(!clean.includes("✘"))
})
