---
sprint: 37
date: 2026-09-16
features: [6.6]
thread: null
---
# 037 — cli de pesquisa e totais por diretorio

Da a `fswatch` um ponto de entrada de linha de comando (`scan`/`watch`/`find`/`totals`)
e totais agregados por diretorio, calculados como campo computado memoizado nas
arvores existentes (`typedtree.js`/`lazytree.js`), sem re-escanear o disco.

## Objetivo

`fswatch.js` (6.1-6.5) e uma biblioteca pura, sem CLI. Este sprint adiciona
`fswatch/cli.js` — camada fina de argv sobre `FSWatch`/`TypedScanner`/`MetadataStore`
— e `totals()` nas duas arvores: sincrono em `typedtree.js` (sobre registros ja
materializados, o caso de ler um `MetadataStore` existente) e assincrono/lazy em
`lazytree.js` (scan ao vivo, memoizado como `stat()`/`hash()` ja sao).

## O que foi feito

- `totals(node)` em `typedtree.js`: agrega files/dirs/bytes via `walk()`, memoizado
  por instancia.
- `totals()` por node em `lazytree.js`: soma filhos concorrentemente (mesma
  concorrencia que o `TypedScanner` da 6.5 ja usa para `stat()` em lote).
- `fswatch/cli.js`: quatro verbos (`scan [--totals]`, `watch`, `find`, `totals`),
  reaproveitando a biblioteca existente sem modifica-la.
- Bug corrigido durante a implementacao: `cli.js` executava o dispatch de argv no
  top-level do modulo. O `utest` importa o arquivo-alvo companion de um `.t.js` para
  injetar seus exports como contexto do teste — isso disparava `usage()` e
  `process.exit(2)` fora de qualquer teste, quebrando a suite. Corrigido com um
  guard `import.meta.main` (so executa quando rodado diretamente, nao quando
  importado) e removendo exports de funcao desnecessarios do modulo CLI.

## Verificacao

`sprint eval 6.6 --yes` — 9 passos, todos verdes: paridade com `find`/`du -sb` sobre
um diretorio conhecido, guard de pureza das bibliotecas, suite completa (2750 ✔).
