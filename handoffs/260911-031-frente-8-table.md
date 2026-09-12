# Handoff — 2026-09-11 — frente 8 (table), as sete features implementadas

Sessão longa, uma frente inteira. **Todas as 7 features de `8 table` têm código,
testes e roteiro de avaliação**: 8.1–8.3 confirmadas (🔵, commitadas — sprints 025,
026, 027). 8.4–8.7 estão 🟢 (avaliadas por máquina), **staged mas não commitadas**,
aguardando `sprint eval N.F` passo a passo do usuário antes de `sprint close`.

O pedido original foi simples — *"vamos implementar a frente 8 - table"*, depois
*"vamos continuar fazendo tudo junto ao mesmo tempo... pensando em termos de factory
closures"* — mas a sessão girou em torno de **três descobertas de defeito real**, não
só da implementação em si. As três estão documentadas em `ISSUES/003` e neste
handoff, e pelo menos uma (o fixture) **ainda não está resolvida** — o usuário a
identificou e reverteu do stage no fim da sessão.

---

## TL;DR para quem reabrir

1. **Rode `sprint eval 8.4`, `8.5`, `8.6`, `8.7`** (passo a passo, sem `--yes`) —
   nessa ordem, cada um seguido de `sprint close` se você concordar com a evidência.
2. **Antes de fechar 8.4**: revise `src/fixtures/tabular-pre-8.2.csv`. Eu o
   regenerei nesta sessão (73→30 linhas, era 2633) porque a primeira geração usou o
   `pageSize` default (4096) e virou quase todo enchimento de página. O novo usa
   `pageSize: 128`. **Isso já está staged (`M`), não commitado** — o commit
   `d0d3f9c` ainda tem a versão de 2633 linhas. Se você concorda com o fixture
   pequeno, o próximo commit da 8.4 (ou um `FIX` avulso) precisa incluir essa
   mudança; `plans/8-table/8.4.eval.js:29` já foi atualizado com o novo md5
   (`a32adc3199b302d5c321d65b49c09845`).
3. **Leia `ISSUES/003`** antes de rodar `utest . --force` cru — o
   exit code bruto pode vir 1 mesmo com tudo verde, por um bug real no `utest`
   (agregado `grand` conta checks entre arquivos concorrentes). Os `eval.js` desta
   frente já filtram por `--json`/`state`/`fails`, não por exit code.

---

## 1. O que foi construído — sete factories, um contrato

Todas seguem o mesmo padrão: `xTable(backing, ...) -> {schema, scan, get?, find?,
range?, count?, filter?, group?}`, capacidade condicionada ao que o schema/backing
realmente sustenta — nunca "presente e lento".

| feature | arquivo | nível típico | o que prova |
|---|---|---|---|
| 8.1 | `src/table/{cursor,mem-table,contract,conformance}.js` | L0 | o contrato em código; `conform()` reprova o que deveria reprovar |
| 8.2 | `src/table/schema.js` + `tabular-projection.js` (`!`/`=`) | — | SOML e CSV normalizam pro mesmo POJO; 5ª lei de conformidade |
| 8.3 | `src/table/page-cursor.js` | — | scan preguiçoso sobre `PagedText`, `pagesRead`/`livePages` como prova |
| 8.4 | `src/table/tabular-table.js` | L4 (get+find+range+count) | veste o contrato sobre a projeção CSV já existente |
| 8.5 | `src/table/io-table.js` | L1 (get+count) | o `.dash` vira Table; find/range **ausentes de propósito** |
| 8.6 | `src/table/sqlite-table.js` | L5 (+filter+group) | push-down real para SQL, com fallback pras 3 armadilhas |
| 8.7 | `src/table/catalog.js` + `db-factory.js` (`factory.table`) | — | `db.users` resolve preguiçosamente, sem syscall no acesso |

### 8.4 — nível é 4, não 3

O plano original (sprint 023) dizia "capabilities() devolve level:3" pra get+find+
range. Como `count()` fica **sempre presente** (é O(1) via índice de página — não
faz sentido escondê-lo), a fórmula acumulativa da 8.1 (`contract.js`) dá nível 4, não
3. Documentei isso no código e nos testes — não é regressão, é a fórmula fazendo o
que ela sempre fez.

### 8.5 — a tensão entre "stream" e "row = entidade fundida"

Esta foi a decisão de design mais delicada da sessão. O `.dash` é um log de
**patches**, não de registros independentes (diferente do CSV paginado da 8.3/8.4).
`io.in({a: {age: 27}})` pode alterar uma entidade `a` criada muitas linhas antes.

Perguntei ao usuário como modelar a identidade da row; a resposta: *"a tabela é uma
projeção do log. e seus registros têm o id do registro de criação. todos os outros
são patches localizados por scan ou índice."*

Isso definiu: `_key` de uma row é a **chave de usuário do registro de criação** (o
`a` de `{a: {...}}`), não a shortKey do log. `scan()` faz um único passe streaming
sobre o `.dash` (nunca `readFileSync` inteiro como `records()`), acumulando por
chave de usuário; só ao esgotar o log as rows fundidas são cedidas. O motor de
leitura (`dashLineCursor`) é genuinamente streaming — 64KB por bloco, nunca duas
linhas cruas decodificadas ao mesmo tempo (`linesLive<=1`) — mas o RESULTADO só sai
depois do passe completo, porque um patch tardio pode mudar uma entidade cedo.

Um teste `.skip` existe para a promoção pós-2.4 (índice paginado chave→offset):
quando a 2.4 chegar, `find`/`range` são somados sem editar a suíte de conformidade.

### 8.6 — dois defeitos reais encontrados e corrigidos no adapter sqlite

Ao escrever o teste de reentrância (dois `scan()` concorrentes), a lei 1 da 8.1
**reprovou de verdade**: `db.query(sql).iterate()` compartilha a mesma `Statement`
cacheada entre chamadas com o mesmo texto SQL — dois scans viam a posição um do
outro. Troquei `col.iterate()` (novo método no adapter) para usar `db.prepare()` em
vez de `db.query()`. Corrigido, testado, sem afetar `query()`/`all()` existentes.

Segundo: o índice AUTOMÁTICO da PK (`sqlite_autoindex_*`, `origin:'pk'` no
`PRAGMA index_list`) estava sendo contado como `indexed`, então **toda tabela com
PK virava L5 de graça** mesmo sem nenhum índice de usuário. Filtrado por
`origin==='pk'`.

Terceiro (não bug, mas documentado): NULL em SQL não é `null` em JS —
`WHERE x = ?` com `null` bindado nunca casa nada (`NULL = NULL` é `unknown`, não
`true`). `find`/`filter` com `eq`+`null` viram `IS NULL` explicitamente, pra bater
com o fallback `scan()|>filter(r => r.x === null)` da 8.1.

### 8.7 — integrado com `db-factory.js`

Perguntei se a integração com `factory.table(name)` fazia parte do escopo (o plano
original sugeria, mas era opcional); o usuário confirmou. `factory.table()` (que
hoje era só upsert-by-id em yaml, zero chamadores reais medidos) agora resolve via
`catalogExecutor`. O preset `table:` de `BACKENDS` continua existindo pra quem pede
a assinatura por string.

`catalog.js` usa `require('fs')` em vez de `import` de propósito: exports de módulo
ES são somente-leitura mesmo com `writable:true` no descriptor — um teste que
espiona `existsSync` pra provar "sem syscall" precisa do objeto de exports mutável
do CommonJS.

Não envolvi `factory` inteiro num `Proxy` pra ter `db.users` como acesso de
propriedade direto — isso exigiria tocar um arquivo grande e compartilhado
(`db-factory.js`, já usado pela 7.1 e outras) de um jeito mais invasivo do que o
requisito testável pedia. `catalog(dir).users` (o módulo standalone) já cobre isso.

---

## 2. Três defeitos de ferramenta/processo encontrados nesta sessão

### 2.1 — `ISSUES/003`: `utest` vaza contagem de checks entre arquivos concorrentes

`page-cursor.t.js` + `tabular-table.t.js` (ou + `sqlite-table.t.js`, etc) rodando
juntos fazem o agregado global `grand` (que decide o exit code, `utest.js:1124-1129`)
contar `failed`/`exception` que não bateram com nenhum `state` individual. Sintoma:
`checks:2018` num arquivo de 8 testes, ou exit code 1 com todo `state:"passed"` e
`fails:[]`. **Contornado** nos `.eval.js` desta frente: filtram por
`bun ... --json` + `state`/`fails`, não por `check(r.exitCode, 0)`.

### 2.2 — meu próprio bug: `withTempDir(...)` sem `return`

Todos os testes que escrevi usando `withTempDir(dir => {...})` estavam **sem
`return`** antes da chamada. Como `withTempDir` é assíncrono e o runner só `await`s
quando a função de teste devolve uma Promise (`runner.js:84`), os testes terminavam
"vazios" — o corpo real, com os `check()`, rodava solto, sem ser aguardado.
Reproduzi isolado: `check(1, 2)` (deliberadamente errado) dentro desse padrão
quebrado reporta ✔ com exit code 0.

Isso **mascarou o defeito do `utest` acima** por um tempo — só ficou visível depois
de eu corrigir o `return` em todos os arquivos (`page-cursor.t.js`,
`tabular-table.t.js`, `io-table.t.js`) e a suíte passar a rodar de verdade. Duas
features já promovidas a 🟢 (8.3, 8.4) precisaram de re-avaliação com a evidência
corrigida — o CÓDIGO de produção estava sempre certo (os `.probe.js` standalone, que
não usam `withTempDir`, bateram idênticos antes/depois), só a evidência de teste era
falsa.

**Lição pra quem escrever testes `.t.js` neste projeto**: `test(name, ({check,
withTempDir}) => { return withTempDir(dir => {...}) })` — o `return` não é opcional.

### 2.3 — o fixture `tabular-pre-8.2.csv` some intermitentemente do disco

Durante a sessão, `src/fixtures/tabular-pre-8.2.csv` desapareceu do disco pelo menos
duas vezes sem eu ter rodado nada que o apagasse explicitamente — uma vez ANTES do
commit 026 (o `git diff --cached --stat` mostrou "2633 insertions" mas o commit
resultante não tinha o arquivo; corrigi com o commit `d0d3f9c`), outra durante uma
rodada da suíte completa (`ENOENT` num teste que o lê). **Não isolei a causa raiz** —
suspeito de um teste concorrente que faz `rm -rf` num `withTempDir` cujo path colide,
mas não confirmei. Fica como item aberto pra próxima sessão: rodar a suíte completa
repetidas vezes com um watcher no arquivo (fiz isso uma vez, não reproduziu) até
pegar o culpado, ou aceitar o risco e documentar "sempre `md5sum` o fixture antes de
confiar nele".

### 2.4 — (achado do usuário, fim da sessão) o fixture tinha 2633 linhas de nada

O fixture original foi gerado com `TabularProjection(file, {schema})` sem passar
`pageSize` — herdou o default de 4096 bytes. Com só 3 linhas de dado real (~60
bytes), a página ficou quase toda enchimento (`stripFill`/padding do formato
paginado — ver `pagedtext.js`). **O usuário notou isso e reverteu o arquivo do
stage.** Regenerei com `pageSize: 128` → 30 linhas, ainda com enchimento (é
estrutural ao formato de página fixa) mas legível. **Ainda staged, não commitado —
decisão de merge pendente do usuário.** Novo md5:
`a32adc3199b302d5c321d65b49c09845` (já propagado pro `8.4.eval.js`; `schema.t.js`
não hardcoda o hash, só lê campos, então não precisou mudar).

---

## 3. Estado exato do git

```
Commitados (main branch, sprint-013-projecao-paginada-4k):
  afef299  025 [8.1]: contrato-table
  c21101f  026 [8.2]: schema-normalizado
  d0d3f9c  FIX 026 [8.2]: fixture de retrocompatibilidade faltou no commit original
  01a0152  027 [8.3]: cursor-preguicoso

Staged, aguardando confirmação humana + sprint close:
  028 [8.4] tabular-table   -- sprint 028, arquivos + fixture regenerado (M)
  029 [8.5] io-table         -- sprint 029
  030 [8.6] sqlite-table     -- sprint 030 (+ src/adapters/sqlite.js: iterate())
  031 [8.7] catalogo-table   -- sprint 031 (+ src/db-factory.js: factory.table())

Untracked (esqueci de git add, não afeta nada):
  plans/8-table/8.7.eval.js
  plans/8-table/8.7.probe.js
```

`git status --porcelain` no início da próxima sessão vai mostrar tudo isso — não é
scope drift, é o resultado normal de 4 sprints ainda não fechados em sequência.

---

## 4. Roteiro pro reboot

1. `sprint fronts 8` — confirma o board (deveria mostrar `[🔵🔵🔵🟢🟢🟢🟢]`).
2. **Decidir o fixture primeiro** (seção 1, item 2 do TL;DR) — antes de fechar 028.
   `md5sum src/fixtures/tabular-pre-8.2.csv` deve bater
   `a32adc3199b302d5c321d65b49c09845` se você aceitar a versão pequena.
3. `sprint eval 8.4` (interativo) → `sprint close` se ok.
4. `sprint eval 8.5` (interativo) → `sprint close`.
5. `sprint eval 8.6` (interativo) → `sprint close`.
6. `sprint eval 8.7` (interativo) → `sprint close`.
7. Cada `sprint close` vai pedir pra adicionar manualmente o `.t.js`/`.probe.js` de
   cada feature ao stage — o escopo declarado na sprint 023 (planejamento) nunca
   listou os arquivos de teste/probe, só os de produção. Já aconteceu em 025, 026,
   027 nesta sessão; o padrão se repete. `git add src/table/*.t.js
   plans/8-table/*.probe.js` antes de `git commit -F .git/SPRINT_COMMIT_MSG`.
8. Depois da frente 8 fechada: a frente 9 (álgebra sobre `Table`) é o próximo passo
   natural — mencionada em `table/TABLE.md` mas sem sprint de planejamento ainda.

---

## Regras do método — não esquecer

- **`sprint boot` PRIMEIRO** numa sessão nova.
- Estado do workflow → SEMPRE `sprint`, nunca `git log`/`ls`/`grep` pra descobrir "o
  que falta".
- **`sprint test` ≠ `sprint eval`** — o primeiro roda `verify_tests` literal (exit
  code cru), o segundo interpreta a DSL do `.eval.js`.
- **`utest --force` sozinho não basta como critério** nesta frente — ver
  `ISSUES/003`. Use `--json` e filtre por `state`/`fails`.
- **`withTempDir(...)` dentro de `test()` PRECISA de `return`** — sem isso o
  `check()` roda solto e nunca reprova nada (ver seção 2.2).
- **🔵 é do humano.** O agente chega a 🟢 e para.
- **`sprint close` é do usuário** — ele encena só os arquivos do sprint (e
  historicamente esquece os `.t.js`/`.probe.js` — confira antes de commitar).
- Achou problema fora do escopo? **Reporte, não conserte** — `ISSUES.md` +
  `ISSUES/NNN-slug.md`.
