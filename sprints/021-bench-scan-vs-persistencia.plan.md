# 021 — Plano: bench-scan-vs-persistencia

Feature 6.3. `fswatch/bench.js` — a reconstrucao comparativa dos quatro repositorios
listados, guardando os dados em DOIS formatos e comparando o iodb paged text contra o
baseline sqlite.

## O que o bench mede (e o que NAO mede)

**Mede**, para cada um de `~/iodb`, `~/utest`, `~/sprint-cli`, `~/soml`:

1. **O que tem no repositorio** — a varredura da arvore inteira, UMA vez. Quantos entries,
   quanto tempo. Este numero e do scan, nao do storage, e e **o mesmo para os dois
   formatos** (o mesmo `found` alimenta os dois stores).
2. **Construcao do corpus** — o custo de gravar aquele `found` no iodb (paged text) e no
   sqlite. Dois numeros, mesma entrada.
3. **Lookups** — achar um entry por `dev:ino` (a chave) e por `path`, nos dois corpora
   construidos.
4. **Buscas** — varrer o corpus por um predicado (ex.: todos os `.js`, todos os `dir`),
   nos dois.

**NAO mede:** nada alem disso. Sem loop de reconcile, sem micro-benchmark sintetico de
ms/registro isolado, sem passada com store nulo para subtrair. A separacao scan/storage se
faz cronometrando as duas fases **na mesma execucao**, nao em passadas repetidas.

## As decisoes que este sprint escreve ANTES de codar

### 1. Um scan, dois stores

`Scanner` roda uma vez por repositorio e devolve `found` (Map de `dev:ino` -> entry). Esse
mesmo Map e escrito no `MetadataStore` (iodb) e no `SqliteStore` (sqlite). O tempo de scan
e reportado sozinho, uma vez. O tempo de construcao e por formato.

Isso e a instrucao do usuario: *"a primeira [scan] deve ser igual para os dois formatos"*.
O `Scanner` do `fswatch.js` e exportado e usado como esta — nao reimplementado.

### 2. A arvore inteira, incluindo `.git` e `node_modules`

O usuario quer saber *"o que tem em cada repositorio"* — a arvore inteira. O `pruned` do
bench e `() => false`: caminha tudo. (O `fswatch.js` em producao poda; o bench nao, porque
a pergunta aqui e outra.)

### 3. Lookups e buscas, dentro do corpus JA construido

Depois de construir, com o store aberto:
- **lookup por chave**: `N` ids sorteados do `found`, cada um resolvido no corpus. iodb:
  `io.get('#1')[id]` (ou o `mirror`); sqlite: `SELECT ... WHERE id=?`.
- **lookup por path**: `N` paths sorteados, resolvidos. Nenhum dos dois tem indice por
  path — iodb varre `all()`, sqlite idem sem indice. Numero honesto para os dois.
- **busca por predicado**: contar entries cujo `name` termina em `.js`, e contar `kind ===
  'dir'`. iodb: filtro sobre `all()`; sqlite: `SELECT count(*) WHERE name LIKE '%.js'` e
  `WHERE kind='dir'`.

Cada um cronometrado, os dois formatos lado a lado.

### 4. Ferramenta, nao teste, nao benchmark

`bun fswatch/bench.js`. Stores num `os.tmpdir()`, nunca num `.fswatch/` real. Repositorio
alvo que nao existe: pula com aviso. `soml` e grande (arvore inteira, ~24k entries) — o
bench pode levar minutos; e aceitavel para uma ferramenta rodada a mao.

**Nao e benchmark, e uso comparativo.** As duas engines rodam lado a lado sobre a mesma
entrada e o bench registra o tempo de cada uma. Sem warmup, sem repeticao, sem media. Os
numeros sao o log de uma reconstrucao real. Medido: `construcao do corpus` e `lookup por
path` variam ~10x entre execucoes (estado do cache de disco); `corpus em disco`, `lookup
por chave` e as buscas sao estaveis. O bench reporta todos; quem le sabe quais confiar
pelo cabecalho.

O `6.3.eval.js` INVOCA `bun fswatch/bench.js` e afirma sobre a ESTRUTURA da saida, nunca
sobre um tempo:
- os quatro repositorios aparecem com contagem de entries > 0 (a reconstrucao rodou);
- o scan e reportado sozinho, uma vez por repo, marcado como comum aos dois formatos;
- construcao, corpus em disco, lookup (chave e path) e as duas buscas tem numero para os
  DOIS formatos em cada repo (a comparacao existe).

Nenhum teto de tempo — um teto reintroduziria a moldura de benchmark que o usuario
rejeitou.

## Passos

1. `fswatch/fswatch.js`: somar `describe` ao `export {}` (hoje interno). O `Scanner` NAO
   e exportado — o bench precisa de um walk que carregue `path` (o `Scanner` nao o
   threada), entao ele faz a propria recursao usando o `describe` exportado. O que se
   compartilha e o `describe` (o `lstat` + montagem da identidade), nao o loop.
2. `fswatch/bench.js`: `import { describe, MetadataStore, SqliteStore } from './fswatch.js'`.
   Por repositorio: `scanTree` uma vez (recursao com `describe`, carregando `path`);
   construir os dois corpora do mesmo `found`; rodar lookups e buscas nos dois; imprimir a
   tabela. O build do sqlite roda dentro de UMA transacao (`store.db.exec('BEGIN'/'COMMIT')`
   pelo handle exposto) — e o que um consumidor real faz num bulk load; sem isso o
   `bun:sqlite` faz fsync por linha e o baseline seria um espantalho.
3. `plans/6-fswatch/6.3.eval.js`: `eval("bun fswatch/bench.js", (out) => {...})` no formato
   de `plans/2-pagedtext/2.1.eval.js`, checks so de estrutura.
4. `plans/6-fswatch/6.3-*.md`: `files:` = `fswatch/fswatch.js`, `fswatch/bench.js`,
   `plans/6-fswatch/6.3.eval.js`. `verify_tests` = `bun plans/6-fswatch/6.3.eval.js`.

## Criterio de pronto

`bun fswatch/bench.js` reconstroi os quatro repositorios (ou os que existem), reporta o
scan uma vez por repo e construcao/lookup/busca para iodb e sqlite lado a lado; o bench usa
o `describe` exportado do `fswatch.js` (nao reimplementa o `lstat`+identidade); nenhum
`.fswatch/` em arvore real; `6.3.eval.js` afirma so sobre a estrutura da saida, sem teto de
tempo.
