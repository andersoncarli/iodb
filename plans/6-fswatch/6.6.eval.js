// Roteiro de avaliacao — feature 6.6: cli de pesquisa e totais por diretorio.

// cli.js e a unica camada com argv/process.exit — fswatch.js/typed/ continuam puros.
eval("grep -c 'process.argv\\|process.exit' fswatch/fswatch.js fswatch/typed/typedtree.js fswatch/typed/lazytree.js | awk -F: '{s+=$2} END{print s}'", (out) => {
  check(out.trim() === '0')
})
eval("grep -c 'import.meta.main' fswatch/cli.js", (out) => {
  check(Number(out.trim()) === 1)
})

// totals() existe nas duas arvores.
eval("grep -c 'totals' fswatch/typed/typedtree.js", (out) => {
  check(Number(out.trim()) >= 1)
})
eval("grep -c 'totals' fswatch/typed/lazytree.js", (out) => {
  check(Number(out.trim()) >= 1)
})

// totals bate com find/du sobre um diretorio conhecido, construido ao vivo.
eval("rm -rf /tmp/eval-6.6 && mkdir -p /tmp/eval-6.6/sub && printf '12345' > /tmp/eval-6.6/a.txt && printf '1234567890' > /tmp/eval-6.6/sub/b.txt && bun fswatch/cli.js scan /tmp/eval-6.6 --totals", (out) => {
  check(out.includes('2 files, 2 dirs, 15B'))
  check(out.includes('sub/  1 files, 1 dirs, 10B'))
})
eval("find /tmp/eval-6.6 -type f | wc -l", (out) => {
  check(out.trim() === '2')
})
eval("du -sb /tmp/eval-6.6 | cut -f1", (out) => {
  check(out.trim() === '15')
})

// find localiza por nome na arvore.
eval("bun fswatch/cli.js find b.txt /tmp/eval-6.6", (out) => {
  check(out.includes('sub/b.txt'))
})

// A suite inteira do projeto continua verde com as mudancas.
eval("utest . 2>&1 | tail -3", (out) => {
  check(out.includes('coverage'))
  check(!/✘\s*[1-9]/.test(out))
})
