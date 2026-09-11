# `sprint test` executa `bun <arquivo>.eval.js` como script e quebra — e derruba o degrau

<!-- system file -->

Encontrado em `~/iodb`, thread do sprint 021 (feature 6.3). `sprint` 0.18.0, Bun 1.3.12.

Rodar `sprint test 6.1` numa feature 🔵 **confirmada** a derrubou para 🟠/🔴. A evidencia
real nunca quebrou — so uma entrada malformada em `verify_tests` que `sprint test` executa
literalmente e `sprint eval` interpreta.

---

## Sintoma

A feature 6.1 tinha, no frontmatter:

```yaml
verify_tests:
  - "bun ../utest/utest.js fswatch/fswatch.t.js --force"
  - "bun plans/6-fswatch/6.1.eval.js"
```

`sprint test 6.1` roda cada string como comando de shell. A segunda:

```
$ bun plans/6-fswatch/6.1.eval.js
13 | eval("bun plans/6-fswatch/6.1.probe.js", (out) => {
     ^
SyntaxError: Unexpected identifier 'plans'
  6.1: 🔵 → 🟠 implementando (verify_tests vermelhos — degrau derivado da evidencia)
```

O `.eval.js` nao e um script executavel: `eval("comando", (out) => {...})` e a DSL que
`sprint eval` faz parse. Passado ao `bun` direto, o `eval()` global tenta EXECUTAR a string
`"bun plans/..."` como JavaScript — `bun` vira identificador, `plans` vem logo depois sem
operador, e e `SyntaxError`.

`sprint eval 6.1 --yes` roda os MESMOS arquivos e passa verde: ele interpreta a DSL, nao a
executa.

## Diagnostico

Duas coisas se cruzam:

1. **A convencao real** (vista em 2.1, 2.5, ambas 🔵): `verify_tests` contem so a suite
   utest (`bun ../utest/utest.js . --force`). O `plans/N-front/N.F.eval.js` NAO entra em
   `verify_tests` — ele e descoberto pelo NOME por `sprint eval N.F`.

2. **6.1 e 6.2 violam a convencao** — ambas listam `bun plans/6-fswatch/6.N.eval.js` em
   `verify_tests`. Provavelmente copiado de um exemplo antigo. `sprint eval` tolera (ignora
   entradas que nao reconhece como suite? ou roda e o parser da DSL aceita?). `sprint test`
   nao tolera: executa e quebra.

3. **`sprint test` move o degrau a partir do resultado.** Um `verify_tests` que quebra por
   estar malformado e indistinguivel, para o `sprint test`, de um que quebra por
   regressao real. O degrau desce.

## Contorno

- **Nao rodar `sprint test` em 6.1 nem 6.2** enquanto o `verify_tests` delas tiver a linha
  do `.eval.js`. Usar `sprint eval <N.F> --yes`, que e o runner correto.
- Se ja tiver rodado e derrubado o degrau: `sprint eval <N.F> --yes` restaura ate 🟢; o 🔵
  (o `ok` humano) volta com `sprint eval <N.F>` passo a passo. Se o `git diff` mostrar o
  frontmatter mudado (`state: confirmed → evaluated`, `verify_confirmed: true → false`),
  `git checkout <arquivo>` desfaz — a evidencia nao mudou, so o metadado.

## Correcao

Duas frentes, nenhuma nesta thread (arquivo commitado, fora do escopo de 021):

1. **No projeto** — tirar a linha `bun plans/.../N.F.eval.js` de `verify_tests` em 6.1 e
   6.2. Fica so a suite utest; o `.eval.js` continua rodando por `sprint eval`. Isto foi
   feito na 6.3 desde o inicio.

2. **No `sprint`** — `sprint test` podia reconhecer que um caminho `*.eval.js` em
   `verify_tests` e a DSL, nao um script, e ou pular com aviso ou roda-lo pelo mesmo
   interpretador que `sprint eval` usa. Hoje ele so faz `exec` da string.
