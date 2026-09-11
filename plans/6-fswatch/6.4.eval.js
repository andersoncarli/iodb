// Roteiro de avaliacao — feature 6.4: fswatch vira fonte do ultimo estado
// conhecido para utest e sprint-cli, com contrato escrito (nao so codigo).

eval("test -f fswatch/docs/utest-sprint-prep.md && echo existe", (out) => {
  check(out.includes('existe'))
})

// A entidade .fswatch/PROJECT esta nomeada e definida, nao so mencionada de passagem.
eval("grep -c '.fswatch/PROJECT' fswatch/docs/utest-sprint-prep.md", (out) => {
  check(Number(out.trim()) >= 3)
})

// O shape do entry (a chave dev:ino, kind, path) esta escrito.
eval("grep -c \"id: 'dev:ino'\" fswatch/docs/utest-sprint-prep.md", (out) => {
  check(Number(out.trim()) === 1)
})

// O criterio de staleness existe — nao e so "le o arquivo e confia".
eval("grep -c 'Staleness' fswatch/docs/utest-sprint-prep.md", (out) => {
  check(Number(out.trim()) >= 1)
})

// As duas pontas de consumo (utest, sprint-cli) estao referenciadas, nao redesenhadas aqui.
eval("grep -c 'sprint-cli' fswatch/docs/utest-sprint-prep.md", (out) => {
  check(Number(out.trim()) >= 2)
})
eval("grep -c 'git ls-files' fswatch/docs/utest-sprint-prep.md", (out) => {
  check(Number(out.trim()) >= 2)
})
