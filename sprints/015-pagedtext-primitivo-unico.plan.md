# 015 — Plano: pagedtext-primitivo-unico

Plano do sprint 015 (feature 2.0).

## Objetivo

Fazer do pagedtext o **unico primitivo de armazenamento paginado**, com escrita
**O(paginas sujas)** de verdade — a promessa que o comentario `pagedtext.js:18` faz e que
o codigo nunca cumpriu.

## A ordem do trabalho

O commit posicional vem primeiro porque tudo depende dele. A convergencia do
paged-projection vem depois, porque so faz sentido migrar para um store que ja cumpre o
contrato.

1. **Invariante de alinhamento.** `renderPage` passa a devolver sempre um multiplo de
   `pageSize`. Linha maior que a pagina ocupa `k` paginas contiguas, e `k` e declarado no
   header (`extents[]`). Sem isso `pageOffset(i)` e indefinido e escrita posicional e
   incorreta.

2. **Offset por prefixo, nao por indice.** Com extents, a pagina `i` nao esta mais em
   `pageSize * (1 + i)`. Um prefixo acumulado da o offset em O(1) apos O(paginas) de
   preparo — e recomputado so quando um extent muda.

3. **Conjunto sujo real.** `flush()` para de reler tudo: percorre so as paginas marcadas
   e as escreve com `writeSync` posicionado. O header e reescrito sempre (ele e o
   arbitro). `ftruncateSync` passa a ser chamado quando o arquivo encolhe.

4. **Mutacao page-local.** `push`/`pop`/`splice`/`[i]=` localizam a pagina e mutam so ela.
   Repaginacao local (cascata) so quando a pagina transborda.

5. **Cache com teto.** `CACHE_PAGES` com eviccao que respeita sujas, no molde do
   paged-projection.

6. **Header v3.** magic unico `PAGEDTEXT`, `kind` distinguindo text/proj-keyed/proj-seq,
   `keys[]` e `logOffset` no header comum, `headerPages` para o header multi-pagina.
   Versao desconhecida = desfecho DISTINTO de nao-ter-header: nao cai no migrador de texto
   legado (que hoje reescreveria um `.proj` v1 destrutivamente).

7. **paged-projection vira codec + indice** sobre o store: mantem
   `encodeKeyed`/`decodeKeyed`, `splitKeys`, tombstone e a face Proxy; para de abrir fd,
   padear e renomear.

8. **Conserto do meio-conserto da 2.5:** `io-engine.js:477` passa a usar `_projCopy()`.

## A armadilha que este sprint tem que evitar (D.4 do plano)

`readPageCached` (`:300-302`) devolve `[]` para pagina nao cacheada, e e chamado dentro do
`flush()` para calcular `byteLens`. Hoje e seguro **por acidente**: o `flush()` logo acima
le todas as paginas. **No momento em que o flush virar O(sujas) ele para de ler tudo, e o
byteLen da ultima pagina vira 0.** E a via mais provavel de este sprint introduzir
corrupcao silenciosa. Com o invariante de alinhamento o `byteLens` deixa de existir como
estado derivado do tamanho do arquivo.

## Criterio de pronto

- escrever 1 linha num store de 1000 paginas escreve **2** paginas, medido em bytes;
- suite verde;
- `io-engine.paged.t.js` roda **sem** batching;
- `src/io-engine.bench.js:423` (sub-linearidade do open paginado) passa a valer.
