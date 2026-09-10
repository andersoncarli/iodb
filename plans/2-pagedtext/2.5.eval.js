// Roteiro de avaliacao — feature 2.5: a projecao paginada remove o teto de RAM
// e continua sendo a MESMA projecao.
//
// Esta feature ja foi reaberta uma vez por ter passado com metrica-proxy: o eval
// antigo checava alinhamento de pagina, que e condicao necessaria e nao
// suficiente. Por isso aqui a afirmacao central e de EQUIVALENCIA observada —
// o caminho paginado contra o caminho plano, nos tres reducers — e nao um
// numero interno do proprio modulo.

eval("bun plans/2-pagedtext/2.5.probe.js", (out) => {
  // 1. A MESMA PROJECAO EM TODOS OS REDUCERS. O criterio literal da feature.
  //    O `append` e o caso critico e o "risco numero um" declarado no plano:
  //    nele a ordem E a identidade, entao paginar sem preservar ordem de
  //    aplicacao muda o resultado em silencio.
  check(out.includes('assign: identico=true'))
  check(out.includes('merge: identico=true'))
  check(out.includes('append: identico=true'))

  // 2. A PROJECAO SEQUENCIAL RESPONDE COMO ARRAY. Havia uma lista branca de
  //    cinco metodos e todo o resto caia no ramo keyed, que itera a pagina como
  //    pares [chave,valor] — numa pagina sequencial isso estoura. 16 metodos
  //    medidos aqui; o numero que importa e zero.
  check(out.includes('metodos que estouram: 0'))
  // `toJSON` estava entre os quebrados, o que fazia JSON.stringify de um store
  // append lancar excecao — o caminho por onde a projecao seria salva ou vista.
  check(out.includes('stringify ok: true'))
  // E os metodos delegados tem que ver a MESMA sequencia que a iteracao,
  // atravessando fronteira de pagina: senao concordam entre si e discordam do
  // arquivo.
  check(out.includes('iter == map: true'))

  // 3. O YAML SOB DEMANDA. Ele existe desde a genese, entao "existe?" nao prova
  //    nada; o que se afirma e que ele PARA de acompanhar as escritas ate
  //    alguem pedir. Antes, um stringify O(n) rodava a cada 100 flushes para
  //    alimentar um arquivo que nenhum readFileSync do src/ le de volta.
  check(/yaml apos 250 escritas: bytes=(\d+)/.test(out))
  check(Number(out.match(/yaml apos 250 escritas: bytes=(\d+)/)[1]) < 200)
  check(out.includes('cresceu=true'))
})

// 4. A SUITE, com contagem exata. Dois comandos e nao um: o utest honra so o
//    primeiro caminho posicional e descarta o segundo EM SILENCIO (registrado em
//    UTEST-ISSUE.md), entao `utest src pagedtext` afirmaria verde sobre um dos
//    dois sem te-lo executado. A contagem fecha essa porta: um run vazio deixa
//    de passar por ausencia de "✘".
//
//    O bench nao entra aqui — disputam CPU, medido em 2.2.eval.js:69-75.
eval("bun ../utest/utest.js src --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
  check(Number([...clean.matchAll(/🧪(\d+)/g)].pop()[1]) >= 75)
})

eval("bun ../utest/utest.js pagedtext --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
  check(clean.includes("pagedtext.t.js"))
})
