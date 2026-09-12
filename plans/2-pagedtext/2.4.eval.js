// Roteiro de avaliacao — feature 2.4: indice plugavel, contrato modular com
// text-pages e sqlite como implementacoes de primeira classe.
//
// A prova central e CONCORDANCIA entre implementacoes distintas sobre o mesmo
// contrato — nao performance (essa e a promessa da 4.6/bench, nao desta
// feature) e nao grep de estrutura (grep prova forma, nao comportamento).

// 1. AS DUAS IMPLEMENTACOES CONCORDAM byte a byte em get/put/del/range, e uma
//    terceira se registra sem editar consumidores — a prova de que o contrato
//    e honesto e de que "plugavel" nao e so um adjetivo no plano.
eval("bun plans/2-pagedtext/2.4.probe.js", (out) => {
  check(out.includes('implementacoes conhecidas: text-pages, sqlite'))
  check(out.includes('gets identicos: true'))
  check(out.includes('range identico: true'))
  check(out.includes('del concorda: true'))
  check(out.includes('terceira implementacao plugavel: true'))
  check(out.includes('registro cresceu sem editar consumidores: true'))
  check(out.includes('rebuild descarta estado antigo: true'))
  check(out.includes('rebuild aplica o novo: true'))
})

// 2. NENHUMA IMPLEMENTACAO CONCRETA VAZA PARA FORA DO REGISTRO — quem cria um
//    indice usa createIndex(nome, ...), nunca importa TextPagesIndex/SqliteIndex
//    diretamente fora dos proprios modulos de implementacao e dos testes.
eval("grep -rl 'TextPagesIndex\\|SqliteIndex' src --include='*.js' | grep -v '.t.js'", (out) => {
  const files = out.trim().split('\n').filter(Boolean)
  // index-textpages.js/sqlite.js DEFINEM as implementacoes; index-registry.js
  // importa TextPagesIndex so para registrar o default. Nenhum OUTRO consumidor
  // deve aparecer aqui — se aparecer, alguem furou o registro.
  check(files.length, 3)
  check(files.some(f => f.includes('index-textpages.js')))
  check(files.some(f => f.includes('adapters/sqlite.js')))
  check(files.some(f => f.includes('index-registry.js')))
})

// 3. O CONTRATO E ESTRUTURAL E VERIFICAVEL: assertIndexShape existe e os dois
//    nomes default estao registrados por efeito colateral de import.
eval("grep -c 'INDEX_METHODS\\|assertIndexShape' src/index-contract.js", (out) => {
  check(Number(out.trim()) >= 2)
})

// 4. SUITE VERDE, com contagem exata. Os dois alvos rodam em comandos
//    SEPARADOS (UTEST-ISSUE.md: `utest a b` descarta o segundo em silencio).
eval("utest src --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(Number([...clean.matchAll(/✔\s*(\d+)/g)].pop()[1]) >= 451)
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
})
eval("utest pagedtext --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(Number([...clean.matchAll(/✔\s*(\d+)/g)].pop()[1]) >= 71)
  check(!clean.includes("✘"))
})
