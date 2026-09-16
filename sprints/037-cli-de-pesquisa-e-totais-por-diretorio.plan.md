# 037 — Plano: cli de pesquisa e totais por diretorio

## Objetivo

`fswatch.js` ja e o servidor de observacao 24x7 (features 6.1-6.5), mas e uma
biblioteca pura — sem ponto de entrada de linha de comando. Este sprint adiciona um
CLI (`fswatch/cli.js`) com verbos de scan/busca/watch/totais, e a peca que faltava:
totais agregados por diretorio (arquivos, subdirs, bytes), calculados como campo
computado memoizado na propria arvore — nao um script separado, nao mantido
incrementalmente no MetadataStore.

## Passos

1. `totals()` em `fswatch/typed/typedtree.js` (sincrono, sobre registros ja
   materializados — o caso de ler um `MetadataStore` existente via `store.all()`).
   Percorre via `walk()` somando files/dirs/bytes, memoizado por node id na instancia.

2. `totals()` em `fswatch/typed/lazytree.js` (assincrono, lazy — o caso de escanear
   um diretorio ao vivo). Cada node de diretorio soma os totais dos filhos
   recursivamente (paralelo via `Promise.all`), memoizado como `stat()`/`hash()` ja
   sao.

3. `fswatch/cli.js` — novo arquivo, camada fina sobre `fswatch.js`/`typed/`:
   - `scan <dir> [--totals]`
   - `watch <config.yaml|dir>`
   - `find <termo> [dir]`
   - `totals <dir|.fswatch-db>`

4. Testes: cobertura de `totals()` em `typedtree.t.js` e um novo `lazytree.t.js`;
   verbos do CLI cobertos em `fswatch.t.js` ou `cli.t.js`.

5. `sprint test` -> `sprint eval 6.6 --yes` (🟢) -> `sprint eval 6.6` com o humano (🔵).

## Arquivos criticos

- `fswatch/typed/typedtree.js`, `fswatch/typed/lazytree.js` — `totals()`.
- `fswatch/cli.js` — novo.
- `fswatch/typed/test/typedtree.t.js`, novo `fswatch/typed/test/lazytree.t.js`,
  `fswatch/fswatch.t.js` ou `fswatch/cli.t.js`.

## Verificacao

- `totals()` bate com `du -sb`/`find | wc -l` sobre um diretorio conhecido.
- `fswatch/cli.js watch <dir>` detecta um `touch`/`rm` externo e imprime o evento.
- `sprint test` verde.
