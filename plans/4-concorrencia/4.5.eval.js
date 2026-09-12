// Roteiro de avaliacao — feature 4.5: o `.proj` deixa de ser arbitrado por
// tamanho de arquivo e passa a ser arbitrado por OFFSET do log.
//
// A prova e em REGISTROS CONTADOS depois de reabrir, e nao em grep: o defeito
// era de comportamento, e so contar o que sobrevive ao round-trip o mostra.

// 1. A DUPLICACAO, QUE ESTAVA VIVA. O guarda era
//    `statSync(f.proj).size > 4096` — um literal, e nao o `pageSize` do store.
//    Com pagina menor, uma projecao de VARIAS paginas ainda mede menos que 4096
//    bytes: o guarda a lia como vazia, o log inteiro era reaplicado por cima do
//    que ja estava la e todo registro duplicava.
//
//    O varrimento de pageSize e o argumento: o defeito nao era de um tamanho,
//    era de toda a faixa abaixo de 4096 — e 4096 escapava por acidente, porque
//    ali tudo cabia numa pagina.
eval("bun plans/4-concorrencia/4.5.probe.js", (out) => {
  const linhas = [...out.matchAll(/ps=\s*(\d+) paginas=\s*(\d+) registros=\s*(\d+) esperado=(\d+) ok=(\w+)/g)]
  check(linhas.length, 6)
  for (const [, ps, paginas, , , ok] of linhas) {
    check(ok, 'true')
    // Multi-pagina de verdade: e a condicao que fazia o guarda antigo errar.
    if (Number(ps) <= 1024) check(Number(paginas) >= 2)
  }
  check(out.includes('sem duplicacao em nenhum pageSize: true'))

  // 2. O NUMERO QUE SUBSTITUIU O TAMANHO. Sem o offset persistido no rodape
  //    nao ha o que arbitrar — "ja absorvido" deixa de ser respondivel.
  check(out.includes('cobre o log inteiro=true'))

  // 3. O GAP QUE O CODIGO ANTIGO DECLARAVA E NAO FECHAVA. Um `.proj` atrasado
  //    era pulado por inteiro e o delta sumia em silencio. Aqui ele tem 12KB
  //    (bem acima do limiar antigo, entao o guarda antigo o daria por em dia) e
  //    ainda assim o que faltava e reaplicado.
  check(out.includes('> 4096: true'))
  check(/chaves apos reabrir: 100 esperado=100 sem duplicata=true/.test(out))
})

// 4. A HEURISTICA SUMIU DO CODIGO, e o `catch` mudo do close junto (os dois sao
//    requisitos literais da feature).
//
//    O grep ignora COMENTARIO: a linha que explica por que a heuristica saiu
//    cita a heuristica, e uma assercao que nao distingue os dois passaria a
//    exigir que a explicacao fosse apagada junto com o defeito.
eval("grep -v '^\\s*//' src/io-engine.js | grep -c 'statSync(f.proj).size > 4096'", (out) => check(out.trim(), "0"))
// O `catch {}` que ENGOLIA a gravacao final da projecao. Os outros catches mudos
// do arquivo sao de `releaseLock` e de parse, pre-existentes e de outro assunto
// — a assercao e sobre ESTE, e nao sobre a contagem global.
eval("grep -c '__flushPages() } catch { }' src/io-engine.js", (out) => check(out.trim(), "0"))
// Um dono do flush da projecao: o offset anda junto com os bytes, sempre. Um
// offset atualizado em so alguns caminhos e pior que nenhum.
eval("grep -c 'function flushProjection' src/io-engine.js", (out) => check(out.trim(), "1"))
eval("grep -c 'flushProjection()' src/io-engine.js", (out) => check(Number(out.trim()) >= 4))

// 5. SUITE VERDE, com contagem exata. Os dois alvos em comandos SEPARADOS:
//    `utest a b` roda so o primeiro e descarta o segundo em silencio.
eval("utest src --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(Number([...clean.matchAll(/✔\s*(\d+)/g)].pop()[1]) >= 406)
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
})
eval("utest pagedtext --force", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b/g, "")
  check(Number([...clean.matchAll(/✔\s*(\d+)/g)].pop()[1]) >= 72)
  check(!clean.includes("✘"))
})
