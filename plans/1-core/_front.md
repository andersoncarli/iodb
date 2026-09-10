---
front: 1
keyword: core
title: Core — o DB reativo, a cadeia de chaves e o indice
state: confirmed
updated: 2026-09-10
---
# [1] core — o DB reativo, a cadeia de chaves e o indice

O nucleo do `iodb`: o que um `db` **e** antes de qualquer discussao de formato, de
pagina ou de lock. Tres coisas moram aqui.

**O DB reativo** (1.1) — `db.js`, `node.js`, models e os adapters de storage
(`file`, `yaml`, `json`, `sqlite`, `dash`). A arvore de nos e a face publica; o
adapter e so a codificacao dela em disco.

**A cadeia de chaves** (1.5) — `makeFullKey = sha64(payload) XOR sha64(targetKey)`
(`hash.js:94`) mais a alocacao de prefixo curto contra o `prefixSet` global. E daqui
que sai a propriedade que o projeto inteiro se apoia: o log e **verificavel**, cada
patch é amarrado no seu target. E daqui tambem que sai o custo: escritas concorrentes
**nao podem** ser chaveadas independentemente, entao os escritores serializam por
construcao. Decisao registrada: integridade verificavel vale mais que paralelismo.

**A equivalencia entre formatos** (1.4) — o formato e uma codificacao, nao semantica.
O mesmo store lido como `yaml`, `json` ou `dash` responde igual. E o que permite que
paginacao (frente 2) seja uma decisao de armazenamento sem virar uma decisao de
modelo.

## O que esta frente NAO cobre

A **concorrencia como disciplina** saiu para a frente 4. O que ficou aqui foram os
dois episodios em que a concorrencia apareceu como **bug do nucleo**, nao como
mecanismo: o `saveIndex` corrompendo sob multi-processo (1.2) e a matriz que
estabeleceu os eixos `format`/`reduce`/`close`/`seed` (1.3). O lock em si — medir,
encurtar, desacoplar — e frente 4.

A **paginacao** e frente 2. Aqui a projecao ainda e uma variavel viva em memoria; o
teto de RAM que isso impoe e o problema que a frente 2 existe para remover.
