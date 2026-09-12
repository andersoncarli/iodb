---
sprint: 21
date: 2026-09-11
features: [6.3]
thread: null
---
# 021 — bench-scan-vs-persistencia

`fswatch/bench.js` reconstroi os quatro repositorios listados guardando os dados em dois
formatos — iodb paged text e o baseline sqlite — com o scan da arvore separado do storage e
comum aos dois. Nao e um benchmark: e o log de uma reconstrucao, as duas engines lado a
lado.

## O que foi entregue

**Uma ferramenta permanente, `bun fswatch/bench.js`.** Por repositorio: um scan da arvore
inteira (uma vez, reportado sozinho), depois a construcao do corpus nos dois formatos a
partir do MESMO `found`, depois lookups (por chave, por path) e buscas (por predicado)
dentro de cada corpus construido. Stores num `os.tmpdir()`; nenhum `.fswatch/` real tocado.

**Scan separado de storage, e igual para os dois.** O `scanTree` do bench faz a recursao
usando o `describe` exportado do `fswatch.js` (o `lstat` + montagem da identidade
`dev:ino`, com `path`). O `Scanner` do fswatch NAO foi exportado — ele nao threada `path`, e
a recursao local e trivial. O que se compartilha e o `describe`, nao o loop.

**O baseline sqlite roda num bulk load honesto.** O build do sqlite envolve as entries numa
transacao (`db.exec('BEGIN'/'COMMIT')` pelo `.db` exposto). Sem isso o `bun:sqlite` faz
fsync por linha e uma execucao chegou a 112000ms para 22k entries — um espantalho, nao um
baseline. `SqliteStore` em si nao mudou.

## O que a reconstrucao mostrou

Numeros de uma execucao (soml, 24511 entries). Rodar de novo move construcao e
lookup-por-path; `corpus em disco`, `lookup por chave` e as buscas ficam.

| fase                    | iodb        | sqlite      | estavel? |
| ----------------------- | ----------- | ----------- | -------- |
| scan (comum aos dois)   | 2299 ms     | —           | —        |
| construcao do corpus    | 5326 ms     | 370 ms      | nao (~10x entre runs) |
| **corpus em disco**     | **7.5M**    | **11.4M**   | **sim** |
| lookup por chave (200)  | 0.1 ms      | 1.0 ms      | sim     |
| lookup por path (200)   | 693 ms      | 370 ms      | nao     |
| busca `name ~ .js`      | 25 ms       | 1.6 ms      | ~sim    |
| busca `kind = dir`      | 4.3 ms      | 1.2 ms      | ~sim    |

**O que se le disso, com honestidade:**

1. **iodb guarda menos** — o `.dash` + derivados fica em ~66% do `.sqlite`, nos quatro
   repos, sem balancar. E o unico numero forte, e e a favor do formato texto paginado.
2. **iodb constroi mais devagar** — o build bufferizado do `.dash` paginado mais a
   manutencao do `mirror` (o espelho em RAM do baseline, workaround do defeito de leitura
   viva do sprint 017) custa mais que uma transacao unica do sqlite. Quanto exatamente,
   esta execucao nao diz — varia 10x. Que e mais devagar, diz.
3. **iodb busca mais devagar em arvore grande** — `all().filter(...)` materializa as 24k
   linhas do `mirror` a cada chamada. O sqlite varre a tabela. Para `name ~ .js` no soml
   sao 25ms contra 1.6ms. Isto e exatamente o teto de RAM e o `find()` linear que as
   frentes 2 e 4 existem para remover.
4. **lookup por chave e empate** — resolver 200 ids amostrados custa <1ms nos dois. A
   projecao chaveada e o indice por PK fazem a mesma coisa aqui.

## Fora de escopo, reportado

- **Rodei `sprint test 6.1` e derrubei a 6.1 de 🔵 para 🟠/🔴.** O `verify_tests` da 6.1
  tem uma entrada malformada — `bun plans/6-fswatch/6.1.eval.js` — que nao roda como script
  (o `eval("cmd", ...)` e DSL de `sprint eval`, nao JS executavel). `sprint test` executa a
  string literal e quebra; `sprint eval` a interpreta e passa. A evidencia real nunca
  quebrou: `sprint eval 6.1 --yes` roda verde. **Desfiz o dano**: `git checkout` no
  frontmatter da 6.1 (que tinha virado `state: evaluated`, `verify_confirmed: false`) —
  6.1 esta de volta em 🔵 como estava. A convencao certa foi aplicada na 6.3 desde o
  inicio. Registrado em detalhe em `ISSUES.md/sprint-test-eval-js-em-verify-tests.md`.
- **`sprint close` e `sprint docs` crasham `EISDIR`.** O loop da raiz em
  `docs-check.js` nao filtra diretorios (o `walk()` recursivo filtra); um diretorio `.md`
  na raiz — `ISSUES.md/` — quebra o `readFileSync`. Bloqueia `close` para 020 e 021. Por
  isso os arquivos do 021 foram estagiados a mao (`git add <lista>`). Registrado em
  `ISSUES.md/sprint-close-docs-check-eisdir.md`.
- **`ISSUES.md/` vira o registro dos defeitos de ferramenta desta thread** — os dois acima,
  mais um README e ponteiros para os `*-ISSUE.md` da raiz. Marcado como system file.
  Estagiado junto do 021 porque documenta o crash que bloqueia o proprio `close` do sprint.
- **O defeito de leitura viva da projecao paginada** (sprint 017, requisito na 2.5)
  aparece de novo aqui: o `mirror` e o que torna `all()` O(n) em materializacao. Nao e
  regressao nova, e o mesmo custo ja registrado.
- **Um hook de telemetria no iodb** — instrumentar a superficie compartilhada para que
  comparacoes como esta parem de ser feitas a mao. Registrado como feature **7.2**
  (planejada, sem sprint), na frente adapter-parity, porque o valor e a paridade da
  observacao entre engines.

## Verificacao

- `utest fswatch/fswatch.t.js --force` — ✔14 (a suite do fswatch, intacta).
- `sprint eval 6.3 --yes` — 1 passo, ✓ → 🟢. O `6.3.eval.js` afirma so sobre a estrutura da
  saida (os quatro repos rodaram, o scan e destacado, as duas colunas tem numero em cada
  fase), nunca sobre um tempo — um teto reintroduziria a moldura de benchmark que foi
  rejeitada.
