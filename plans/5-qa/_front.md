---
front: 5
keyword: qa
title: QA & Refactorings — mudancas de forma e manutencao do trilho que nao mudam comportamento de produto
state: confirmed
updated: 2026-09-11
---
# [5] qa & refactorings — mudancas de forma e manutencao do trilho que nao mudam comportamento de produto

A frente das mudancas cujo criterio de sucesso e **nada mudou**: a arvore fica mais
legivel, os imports fazem sentido, os nomes dizem o que a coisa e — e a suite continua
exatamente igual, teste por teste, falha por falha.

Refactoring tem uma disciplina propria e por isso merece frente propria: ele nao pode ser
avaliado por "a feature funciona", porque nao ha feature nova. Ele e avaliado por
**equivalencia** — de preferencia medida contra a arvore anterior, nao afirmada.

## A regra desta frente

**Nenhum refactoring carrega conserto junto.** Se no meio da mudanca de forma aparece um
bug, ele e reportado e vira sprint proprio. Misturar os dois destroi a unica propriedade
que torna um refactoring revisavel: a de que a saida devia ser identica.

## Features

**5.1 reorganizar-arvore-src-adapters** (⚫) — saiu de uma raiz plana com ~38 arquivos
`.js` misturando nucleo e adapters, para `src/` (nucleo) e `src/adapters/` (os 21
adapters). Segunda rodada removeu os prefixos numericos e centralizou a ordem de
carregamento em `src/adapters/index.js`.

O trabalho **foi feito e commitado** (sprint 012), mas a feature nunca ganhou requisitos
nem roteiro de avaliacao — por isso segue ⚫: o degrau e derivado de evidencia, e nao ha
evidencia executavel registrada. Para subir, ela precisa de um `5.1.eval.js` que assegure
o que a reorganizacao prometeu (nenhum `.js` solto na raiz, `db-factory` achando os
adapters pelo index, imports resolvendo).

Efeito colateral ja observado: evals de sprints anteriores asseguravam caminhos de raiz
(`io-append.js`, `io-engine.js`) que a reorganizacao moveu, e ficaram vermelhos calados
ate 2026-09-10, quando foram corrigidos para `src/`. E exatamente o custo que um eval de
equivalencia teria pego na hora.
