# `src/fixtures/tabular-pre-8.2.csv` foi gerado com 2633 linhas quando 4 bastavam —
enchimento de pagina do PagedText nao foi levado em conta

<!-- system file -->

Encontrado em `~/iodb`, thread da frente 8 (feature 8.2, `schema-normalizado`). Achado
pelo USUARIO no fim da sessao, revisando o stage antes de fechar o sprint 028.

## Sintoma

`src/fixtures/tabular-pre-8.2.csv` — o oraculo de retrocompatibilidade da 8.2, commitado
no sprint 026 (corrigido em `d0d3f9c` apos um problema separado, ver `ISSUES/003`
"Nota") — tinha 2633 linhas, das quais so 4 sao dado real (o cabecalho de schema + 3
linhas: Ana, Bob, Cid). As outras 2629 sao ` ,` — enchimento de pagina.

## Diagnostico

O fixture foi gerado com `TabularProjection(file, { schema })` SEM passar `pageSize`,
herdando o default de `src/tabular-projection.js:34` (`PAGE_SIZE = 4096`). Com so ~60
bytes de dado real, uma unica pagina de 4096 bytes fica quase toda vazia — e o formato
paginado do `pagedtext.js` PREENCHE a pagina ate o tamanho fixo (`stripFill`/padding),
entao o enchimento vira ~4000 bytes de linhas ` ,` no arquivo fisico.

Nao e um bug do `pagedtext`/`tabular-projection` — enchimento de pagina e o preco do
formato (permite acesso O(1) por indice de pagina sem reler tudo). O erro foi meu, ao
gerar o fixture: nao escolhi um `pageSize` proporcional ao conteudo.

## Contorno / correcao aplicada

Regenerado com `pageSize: 128` (o menor que ainda comporta as linhas de dado + o
trailer de metadados do PagedText sem quebrar). Resultado: 30 linhas, legivel.
Md5 mudou de `263583b04e33a06ffdec61025ac4fbf7` para `a32adc3199b302d5c321d65b49c09845`
— `plans/8-table/8.4.eval.js` ja foi atualizado com o novo hash.

**Estado no fim da sessao 2026-09-11**: o arquivo regenerado esta STAGED (`git status`
mostra `M`), NAO commitado — o commit `d0d3f9c` ainda tem a versao de 2633 linhas. Fica
pendente de decisao/commit do usuario na proxima sessao (ver handoff
`handoffs/260911-031-frente-8-table.md`).

## Licao para gerar fixtures paginados no futuro

Ao commitar um fixture de `TabularProjection`/`PagedText` no repo (nao um arquivo de
teste temporario em `withTempDir`), passar um `pageSize` pequeno e deliberado (64-256
bytes, proporcional ao conteudo de teste) — nunca o default de producao (4096), que
existe para otimizar acesso a arquivos grandes, nao para minimizar o tamanho de um
fixture pequeno.
