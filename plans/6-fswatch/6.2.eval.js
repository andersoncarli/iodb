// Roteiro de avaliacao — feature 6.2: o package.json para de mentir.
//
// Duas promessas, nenhuma delas "os testes passam" isolado:
// 1. O RUNNER DECLARADO E O RUNNER QUE RODA. `fswatch/package.json` dizia
//    `utest` sem esse bin existir ali; hoje declara `utest fswatch.t.js --force`,
//    e `utest` e o CLI global (bun link em ../utest), nao um caminho relativo
//    saindo do pacote.
// 2. O ACOPLAMENTO SOBREVIVE AO CWD. O import `../src/io-engine.js` so e
//    seguro porque a decisao (opcao a) foi ESCRITA: fswatch e subpacote do
//    repo, nao pacote independente. O teste real e rodar de fora de fswatch/.

eval("cd fswatch && utest fswatch.t.js --force", (out) => {
  check(out.includes('14'))
  check(!out.includes('✘'))
})

// De um cwd fora de fswatch/ e fora do repo — o caso que a 6.2 existe para
// cobrir. package.json some deste comando de proposito: e o import relativo
// dentro de fswatch.js que precisa sobreviver, nao o script do pacote.
eval("cd /tmp && utest /home/bittnkr/iodb/fswatch/fswatch.t.js --force", (out) => {
  check(out.includes('14'))
  check(!out.includes('✘'))
})

// A decisao (a) esta escrita no proprio package.json, nao em commit message.
eval("grep -o 'A subpackage of iodb' fswatch/package.json", (out) => {
  check(out.includes('A subpackage of iodb'))
})
