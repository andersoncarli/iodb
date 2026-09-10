// Roteiro de avaliacao — feature 2.5: a projecao ganhou paginas 4K e deixou
// de precisar caber inteira na RAM.
//
// A tese: hoje `projection` e uma variavel de closure viva, reconstruida do
// log a cada open() — o store nao pode exceder a memoria do processo. Esta
// feature poe a projecao canonica em paginas de 4096 bytes alinhadas, escritas
// manualmente (nao pelo stringify do YAML, que so emite o documento inteiro),
// das quais so a pagina que contem a chave e carregada.
//
// Ponto de partida: pagedtext/pagedtext.js, evoluido no lugar para nucleo
// sincrono com cache de paginas (decisao do usuario). Os dois layouts vem da
// armadilha central: merge/assign sao mapas ordenados por chave, append e
// lista ordenada por posicao — layouts de pagina diferentes.

// 1. O nucleo paginado e SINCRONO. O io-engine escreve dentro da secao critica
//    do lock (2.2/2.3); um `await` ali dentro reabre a secao critica. Nenhum
//    fs/promises no pagedtext.
eval("grep -c \"from 'node:fs/promises'\" pagedtext/pagedtext.js", (out) => check(out.trim(), "0"))
eval("grep -c \"writeSync\\|readSync\\|fsyncSync\" pagedtext/pagedtext.js", (out) => check(Number(out.trim()) >= 3))

// 2. HEADER VERSIONADO na pagina 0: magic + versao + pageSize. Um arquivo cujo
//    header nao reconhecemos nao e parseado — reconstroi da fonte.
eval("grep -n \"MAGIC\\|HEADER_VERSION\" pagedtext/pagedtext.js", (out) => {
  check(out.includes("PAGEDTEXT"))
})
eval("grep -c \"version !== HEADER_VERSION\\|h.version !== HEADER_VERSION\" pagedtext/pagedtext.js", (out) => check(Number(out.trim()) >= 1))

// 3. PAGINAS ALINHADAS EM 4096. Offset da pagina i = pageSize + i*pageSize,
//    escrita com writeSync posicionado. Sem isso nao ha "escrita O(paginas
//    sujas)". A prova roda de verdade: gera store, checa alinhamento.
eval("bun ../utest/utest.js pagedtext/pagedtext.t.js", (out) => {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "")
  check(!clean.includes("✘"))
  check(!clean.includes("💥"))
  check(clean.includes("45"))
})

// 4. CACHE DE PAGINAS VISITADAS, nao o arquivo inteiro. Um point read carrega
//    UMA pagina, nao todas. O teste "page cache does not load every page"
//    afirma cache.size === 1 apos um at().
eval("grep -c \"_cache\\|cache.set\\|cache.has\" pagedtext/pagedtext.js", (out) => check(Number(out.trim()) >= 3))

// 5. PADDING SINTATICO sobrevive a editor que remove trailing space. O teste
//    "filling survives an editor that trims trailing whitespace" roda
//    `s/ +$//` sobre o arquivo e reabre — as fronteiras vem do header, nao
//    dos espacos.
eval("grep -c \"trims trailing whitespace\" pagedtext/pagedtext.t.js", (out) => check(out.trim(), "1"))

// 5b. O DEMO DOS BASICOS roda com paginas pequenas (128B) e sai limpo:
//     array logico, 3 paginas alinhadas, edicao, cursor, filling, sobrevivencia
//     a trim. E o "hello world" do pagedtext, executavel.
eval("bun pagedtext/hello-paged.js", (out) => {
  check(out.includes("physically stored in 3 pages of 128 bytes"))
  check(out.includes('"magic":"PAGEDTEXT"'))
  check(out.includes("pages loaded to read line") && out.includes("1 of 3"))
  check(out.includes("✓ hello-paged"))
})

// 6. OS DOIS LAYOUTS no io-engine. keyed para merge/assign, sequential para
//    append. O layout e derivado de initial (Array => sequential).
eval("grep -n \"_pagedLayout\" src/io-engine.js", (out) => {
  check(out.includes("sequential"))
  check(out.includes("keyed"))
})

// 6b. A INTERFACE e um so eixo: `pageSize: N`. > 0 liga com esse tamanho; 0 ou
//     ausente = plain, byte-identico. Nenhuma flag booleana `paged` na
//     assinatura publica de IO(). E tudo que o usuario do iodb precisa saber.
eval("sed -n '/^export function IO(/p' src/io-engine.js", (out) => {
  check(out.includes("pageSize"))
  check(!/\bpaged\b/.test(out))
})
eval("grep -c \"pageSize: 4096\\|pageSize })\" src/io-engine.paged.t.js", (out) => check(Number(out.trim()) >= 6))

// 7. BUG PRE-EXISTENTE corrigido: o ramo de re-verificacao usava { ...projection }
//    onde o caminho normal usa _projCopy(). Num store append isso convertia o
//    array em objeto. Agora _projCopy() cobre os dois, e o paged path usa
//    materialize().
eval("grep -c \"paged ? materialize(projection)\" src/io-engine.js", (out) => check(Number(out.trim()) >= 1))

// 8. .proj E DERIVADO, escrito no yield periodico e no close() — NAO por
//    append. Flush por append poria o rewrite O(store) de volta na hot path,
//    que e o que a 2.2 removeu.
eval("sed -n '/if (yieldFlush) {/,/}/p' src/io-engine.js", (out) => {
  check(out.includes("__flushPages"))
})
eval("grep -c \"paged && existsSync(f.dash)\" src/io-engine.js", (out) => check(Number(out.trim()) >= 1))

// 9. PROJECAO IDENTICA ANTES/DEPOIS EM TODOS OS REDUCERS. A prova roda: o teste
//    "matches the plain path key-for-key" compara paged vs plain registro a
//    registro para merge, e ha casos para assign e append.
eval("bun ../utest/utest.js src/io-engine.paged.t.js", (out) => {
  check(!out.includes("✘"))
  check(!out.includes("💥"))
  check(/17\b/.test(out.replace(/\x1b\[[0-9;]*m/g, "")) || out.includes("17"))
})

// 10. TOMBSTONE sobrevive a paginacao (merge, null deleta) e ORDEM preservada
//     em append. Ambos no paged-projection.t.js, rodando.
eval("bun ../utest/utest.js src/paged-projection.t.js", (out) => {
  check(!out.includes("✘"))
  check(/29\b/.test(out.replace(/\x1b\[[0-9;]*m/g, "")) || out.includes("29"))
})

// 11. A SUITE INTEIRA, verde — o caminho plain (matrix 1.3, concurrency 1.2,
//     equivalencia 1.4) intacto. O paged e opt-in: sem `pageSize` nada muda.
eval("bun ../utest/utest.js .", (out) => {
  check(!out.includes("✘"))
  check(!out.includes("💥"))
  check(out.replace(/\x1b\[[0-9;]*m/g, "").includes("19"))
})

// 12. O BENCH MOSTRA O PROBLEMA onde nao e rapido. `--paged` compara open() e
//     get() plain vs paged. ACHADO honesto: paged open() NAO e flat — ainda
//     le o .dash inteiro para reconstruir os bitmaps do alocador. open() flat
//     precisa do indice real, que e a 2.4. O bench e a evidencia disso.
eval("grep -c \"FINDING: paged open\" src/io-engine.bench.js", (out) => check(out.trim(), "1"))
eval("grep -c \"PAGED_MAX_PROCS\" src/io-engine.bench.js", (out) => {
  check(Number(out.trim()) >= 1)   // concorrencia limitada a 3 workers (regra do usuario)
})
