# 012 — Plano: reorganizar-arvore-src-adapters

Plano do sprint 012 (feature 5.1).

## Objetivo

Rodada 2 da reorganizacao de `src/adapters/`: remover os prefixos numericos
dos nomes de arquivo (`0-folder.js`, `01-file.js`, ... `60-transition.js`) e
substituir a ordem-por-nome-de-arquivo por um carregamento explicito via
`src/adapters/index.js`, preservando a mesma ordem que os prefixos indicavam.

## Passos concretos

1. `git mv` de cada adapter para o nome sem prefixo (ver tabela completa em
   `plans/4-core/5.1-reorganizar-arvore-src-adapters.md`, secao "Rodada 2").
   Excecao: `60-node.js` -> `node-adapter.js` (nao `node.js`, que ja existe
   como nucleo em `src/node.js`).
2. Criar `src/adapters/index.js`: import explicito de cada adapter na ordem
   numerica original, array `ADAPTERS` de `{ handle, module }` + exports
   nomeados `sqlite`, `NodeAdapter`, `TransitionBus` — replicando a mesma
   forma de consumo que `src/db-factory.js` ja fazia (resolucao de factory
   por `${Cap}Collection`/`${Cap}Factory`/`module[handle]`/`module.default`).
3. Atualizar `src/db-factory.js`: remover o `readdirSync(ADAPTERS_PATH)` +
   regex `^\d+-` + `sort` por prefixo numerico; iterar `ADAPTERS` importado
   de `./adapters/index.js`. `BACKENDS['sqlite']` e `NodeAdapter` tambem via
   index.
4. Corrigir imports relativos quebrados pelas renomeacoes: `node-core.js`,
   `node.t.js`, e dentro de `src/adapters/*.t.js`/`folder.js` que apontavam
   para nomes com prefixo.
5. Verificar `command-engine.js` — tem `loadAdapters()` proprio, mas e outro
   conceito (skills), nao adapters de storage; confirmar que nao precisa
   mudar.
6. `utest .` — conferir que nao ha regressao nova (as 7
   falhas de `io-engine.matrix.test.js`/`.concurrency.test.js` sao
   pre-existentes, do 1.4, fora de escopo).
7. `sprint update 5.1` para trocar os nomes antigos com prefixo na lista
   `files:` pelos nomes novos + `index.js`.
8. `sprint files --drift` sobre os arquivos tocados e `sprint docs`.

## Criterio de pronto

- Nenhum arquivo em `src/adapters/` com prefixo numerico.
- `src/adapters/index.js` existe e e a unica fonte de ordem/registro dos
  adapters (nada mais faz `readdirSync` sobre a pasta por convencao de nome).
- Suite de testes sem regressao nova.
- `sprint files --drift` limpo (tudo dentro do escopo da 5.1) e
  `sprint docs` com `docs:check — ok`.
- `.report.md` e `sprint close` ficam com o usuario.
