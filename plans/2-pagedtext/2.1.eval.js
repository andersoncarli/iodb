// Roteiro de avaliacao — feature 2.1: interferencia minima.
//
// O criterio desta feature nao e interno. Ela promete que o arquivo continua
// sendo um arquivo do formato dele, e quem julga isso sao ferramentas que nao
// sabem nada de pagedtext: file(1), grep(1) e um leitor de CSV comum. Por isso
// o eval afirma sobre a saida delas, e nao sobre estado do proprio modulo.

// 1. O VEREDITO DAS FERRAMENTAS EXTERNAS. Antes desta feature: `file` dizia
//    `data`, `grep` sem -a saia com 1 (detecta binario e desiste) e a primeira
//    linha do arquivo era o JSON da genese, que um parser de CSV lia como
//    registro. Os quatro fatos abaixo sao exatamente esses quatro, invertidos.
eval("bun plans/2-pagedtext/2.1.probe.js", (out) => {
  check(out.match(/bytes NUL: (\d+)/)[1], '0')      // zero NUL: o arquivo e texto
  check(out.includes('alinhado: true'))              // e continua paginado
  check(out.includes('primeira linha: id,name,email'))  // pagina 0 e dado, nao genese
  check(/file\(1\): .*text/.test(out))               // file(1) classifica como texto
  check(out.includes('grep sem -a: 1'))              // grep acha sem precisar de -a

  // 2. O LEITOR DE CSV COMUM, que e a promessa central. Ele nao trata nada de
  //    especial: le 2147 linhas fisicas, das quais o enchimento e uma coluna
  //    extra vazia, e sobram os 200 registros — sem erro de parse e sem um
  //    registro de lixo no fim, que era o que o rodape produzia antes de vestir
  //    a roupa do formato.
  check(out.includes('registros: 200'))
  check(out.includes('ultimo id: 200'))
  check(out.includes('email 137: nome137@exemplo.com'))  // round-trip do conteudo

  // 3. DETECCAO, NAO PREVENCAO. Nada impede um editor externo de remover o
  //    enchimento, e prometer que impede seria mentira. O que se pode e
  //    perceber: sem o enchimento o arquivo deixa de ser multiplo de pageSize,
  //    e o alinhamento e justamente o invariante do qual toda a aritmetica de
  //    offset depende.
  check(out.includes('validate intacto: ok=true problemas=0'))
  check(out.includes('validate ferido: ok=false'))
  check(out.includes('nao e multiplo de 4096'))
})

// 4. A SUITE, EM DOIS COMANDOS E COM CONTAGEM EXATA. Dois porque o utest
//    honra so o primeiro argumento de caminho: `utest src pagedtext` roda `src`
//    e ignora `pagedtext` EM SILENCIO, sem erro e sem aviso — um eval que
//    chamasse assim afirmaria verde sobre o arquivo que esta feature mais
//    mudou, sem nunca te-lo executado. A contagem exata e o que fecha essa
//    porta: um run vazio deixa de passar por ausencia de "✘".
//
//    O bench nao entra aqui — eles disputam CPU, e a regra ja esta medida e
//    documentada em 2.2.eval.js:69-75.
eval("utest src --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
  check(Number([...clean.matchAll(/🧪(\d+)/g)].pop()[1]) >= 73)
})

eval("utest pagedtext --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
  check(clean.includes("pagedtext.t.js"))     // o arquivo da feature rodou mesmo
  check(Number([...clean.matchAll(/🧪(\d+)/g)].pop()[1]) >= 20)
})
