// Roteiro de avaliacao — feature 6.3: a reconstrucao comparativa dos quatro
// repositorios listados, guardando os dados em dois formatos.
//
// Isto NAO e um benchmark. E um uso comparativo: as duas engines rodam lado a
// lado sobre a MESMA entrada e o bench registra o tempo de cada uma. Sem
// warmup, sem repeticao, sem media. Os numeros sao o log de uma reconstrucao
// real, nao uma afirmacao sobre desempenho em regime.
//
// Por isso o eval nao poe teto em tempo nenhum — um teto reintroduziria a
// moldura de benchmark. Ele afirma que a comparacao RODOU e que as duas
// engines produziram numero em cada fase.

eval("bun fswatch/bench.js", (out) => {
  // 1. OS QUATRO REPOSITORIOS FORAM RECONSTRUIDOS. (Um que nao exista na
  //    maquina e pulado com aviso; o RESUMO lista os que rodaram, e tem que
  //    haver ao menos um.)
  check(out.includes('RESUMO'))
  check(out.includes('repositorios reconstruidos:'))
  const reconstruidos = out.match(/\w[\w-]*\(\d+\)/g) || []
  check(reconstruidos.length >= 1)
  check(/\b(iodb|utest|sprint-cli|soml)\b/.test(out))

  // 2. O SCAN E REPORTADO SOZINHO, UMA VEZ POR REPO, comum aos dois formatos.
  //    A varredura da arvore nao entra no numero de nenhuma das duas engines —
  //    e a separacao scan/storage que a feature pede.
  check(out.includes('scan (arvore inteira, 1x, comum aos dois)'))

  // 3. AS DUAS ENGINES LADO A LADO, COM NUMERO EM CADA FASE. Para cada repo:
  //    construcao, corpus em disco, lookup por chave, lookup por path, e as
  //    duas buscas — todos com um valor na coluna iodb E na coluna sqlite.
  check(/iodb\s+sqlite/.test(out))
  check(out.includes('construcao do corpus'))
  check(out.includes('corpus em disco'))
  check(out.includes('lookup por chave'))
  check(out.includes('lookup por path'))
  check(out.includes('busca  name ~ .js'))
  check(out.includes('busca  kind = dir'))

  // Cada linha de fase tem DOIS tempos (um por engine). Conta as ocorrencias
  // de "N ms   M ms" no bloco de fases — tem que haver varias.
  const doisTempos = out.match(/[\d.]+ ms\s+[\d.]+ ms/g) || []
  check(doisTempos.length >= 6)

  // 4. O RESUMO REGISTRA, NAO JULGA. Ele so ecoa o que rodou e os piores
  //    tempos observados no iodb — como registro, sem teto.
  check(/iodb construcao pior ms\/entry:\s+[\d.]+/.test(out))
  check(/iodb lookup-por-chave pior:\s+[\d.]+ ms/.test(out))
})
