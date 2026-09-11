# 020 — projecao-tabular

Feature 2.2: a projecao tabular — csv tipado com indice por pagina.

## O desenho

A tabular e a TERCEIRA leitura da mesma projecao, e nao um storage novo. Keyed le as
paginas como mapa, sequential as le como ordem, tabular as le como tabela com schema.
Os tres sao codecs sobre o mesmo PagedText — que e literalmente a tese do
`docs/04-projecao-tabular-hierarquica.md`: hierarquica e tabular sao duas
interpretacoes, nao dois arquivos.

Por isso ela nasce em modulo proprio (`src/tabular-projection.js`) em vez de virar um
terceiro ramo dentro do `paged-projection.js`. O que os separa e o modelo logico, e o
que os une ja esta no primitivo. Um terceiro ramo no Proxy existente daria a ele uma
terceira personalidade, que e exatamente o que a 2.0 recusou quando se decidiu nao
fundir as duas faces.

## O que a 2.1 tornou possivel

O schema so pode morar na primeira linha porque a 2.1 tirou o header de la. Enquanto a
pagina 0 era JSON e metade do arquivo era byte NUL, a linha 1 ja estava ocupada e o
arquivo nem sequer era texto. A ordem 2.1 -> 2.2 era pre-requisito, nao preferencia.

## O escopo

1. A gramatica `campo : tipo [nullabilidade] [indice]` do `docs/05`, com `?` e `@`.
2. Quatro tipos: str, int, float, bool. Restritos de proposito — e o conjunto com
   representacao textual canonica e ORDEM TOTAL, e e a ordem que sustenta o range.
3. Campo vazio = null, unica codificacao. Obriga o str vazio a viajar como `""`.
4. Indice min/max POR PAGINA nas colunas `@`; um range descarta paginas sem abri-las.
5. `pagesRead` exposto — sem a medida, "le menos paginas" e afirmacao sem prova.

## Fora do escopo

O indice persistido em estrutura propria (B-tree) e da 2.4. Aqui o min/max viaja no
mesmo slot `keys` do trailer que o keyed ja usa para as chaves de corte.
