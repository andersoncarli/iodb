---
front: 2
keyword: pagedtext
title: pagedtext — o primitivo paginado sob stream, projecao e indice
state: active
updated: 2026-09-10
---
# [2] pagedtext — o primitivo paginado sob stream, projecao e indice

O `iodb` reescreve estruturas inteiras a cada escrita, o que e inviavel para um log
crescente. A projecao precisa caber inteira na RAM, `open()` custa o log inteiro, e a
escrita e O(n) no tamanho do store.

A resposta desta frente e **paginas de 4096 bytes legiveis**: padded com espacos,
mantidas em **texto**, de forma que `cat` continua mostrando o estado e `sed -n` mostra
uma pagina. So e possivel porque o `iodb` passa a gerenciar a escrita manualmente, em vez
de delegar ao `stringify` do YAML — que so sabe emitir o documento inteiro e e a origem
do O(n).

## O pagedtext e a figura central

Stream, projecao e indice **se apoiam** num unico primitivo paginado. Ele e dono do
header, dos offsets, do cache com eviccao, do conjunto de paginas sujas e do commit; e
nao sabe o que e chave, projecao ou `.dash`. Quem sabe disso e o codec que mora em cima.

Hoje isso **nao** e verdade, e a 2.0 existe para torna-lo verdade: `pagedtext/pagedtext.js`
nao e importado por nada em `src/`, enquanto o engine usa uma segunda implementacao
paralela (`src/paged-projection.js`) que reinventa a mesma primitiva com outro magic.

## Inspiracao: SQLite

Adotar: header versionado na pagina 1 (magic + versao + page_size — barato agora,
impossivel de retrofitar); **slotted page** (array de offsets no topo, celulas do fim
para o inicio, o que permite inserir sem memmove); freelist de paginas liberadas.

**Nao** adotar o WAL: o SQLite precisa dele porque faz update-in-place. O `.dash` **ja e**
o write-ahead log e a fonte de verdade da qual tudo e derivavel. Regra de recuperacao mais
simples: **pagina corrompida = descarta e reconstroi do `.dash`**. Crash-safety vira
problema de **deteccao** (checksum), nao de rollback. Essa mesma doutrina e o que a frente
4 usa para resolver conflito de escrita concorrente.

## O que esta frente NAO muda

**A cadeia de chaves fica.** `makeFullKey = sha64(payload) XOR sha64(prevKey)`
(`hash.js:94`) mais alocacao de prefixo contra o `prefixSet` global: escritas concorrentes
nao podem ser chaveadas independentemente. Decisao da frente 1: a integridade verificavel
por `verify()` vale mais que o paralelismo. Paginar nao remove essa serializacao.

**O lock saiu.** Medir a secao critica, encurta-la e desacoplar o mutex do dado nasceram
aqui (eram 2.1, 2.2 e 2.3) porque a paginacao foi o que os motivou, mas sao disciplina de
concorrencia e migraram para a **frente 4**. O que sobra aqui e o formato e o acesso.

## Ordem das features

**2.0** (o primitivo unico, com escrita O(paginas sujas)) → **2.1** (interferencia minima)
→ **2.2** (projecao tabular, CSV tipado) → **2.4** (indice paginado) → **2.5** (projecao
paginada, reimplementada como codec sobre o 2.0).

A **2.0 fechou** em 2026-09-10 (sprint 015): o pagedtext virou o primitivo unico, a
projecao converteu-se em codec sobre ele, e o custo de append ficou plano — uma pagina de
dados por append, com o arquivo 39x maior. O que destravou isso foi separar a **genese**
(magic, versao, pageSize, layout, kind — nunca muda) das **estatisticas derivadas**
(contagens, extents, chaves), que passaram para um rodape no fim do arquivo.

A **2.1 e a 2.2 nasceram do que a 2.0 deixou aberto**, e nessa ordem porque a segunda
depende da primeira. A 2.0 entregou o custo mas nao a outra metade da promessa desta
frente: que o arquivo **continua sendo texto do formato dele**. Medido num CSV de 200
registros, metade dos bytes e NUL, `file(1)` classifica o arquivo como `data` e `grep`
sem `-a` nao encontra o que esta la. A 2.1 conserta isso; a 2.2 so entao pode por o schema
na primeira linha, porque hoje ela esta ocupada pelo header.

As duas seguem desenho que **ja estava escrito nos docs** e nao foi inventado agora:
`docs/05-csv-tipado-formato-texto.md` (o CSV tipado, e o enchimento como campo extra
sintatico em vez de linha em branco tolerada) e `docs/04-projecao-tabular-hierarquica.md`
(tabular e hierarquica sao duas interpretacoes da mesma projecao, nao dois storages).

A 2.5 foi **rebaixada** de 🟢 em 2026-09-10: o criterio dela ("escrita O(paginas sujas)")
nunca foi implementado, e o eval passou por metrica-proxy checando alinhamento no lugar de
bytes escritos. Ela volta a subir depois da 2.0.
