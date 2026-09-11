# `utest` acumula `failed`/`exception` do agregado global (`grand`) entre arquivos
concorrentes, derrubando o exit code mesmo com todo `state` individual `passed`

<!-- system file -->

Encontrado em `~/iodb`, thread da frente 8 (feature 8.4, `tabular-table`). `utest` local
(`../utest/utest.js`), Bun 1.3.12.

## Sintoma

`bun ../utest/utest.js src/table --force` roda 4 arquivos de teste. `--json` mostra os
quatro com `"state":"passed"` e `"fails":[]` — nenhuma asserção falhou. Mesmo assim o
processo sai com exit code 1, e o relatorio humano mostra um `✘1` pendurado em
`tabular-table.t.js`, cujo `"checks"` tambem aparece inflado (18 em vez dos 10 reais —
exatamente os 8 checks de `page-cursor.t.js` a mais).

Isolado (`bun ../utest/utest.js src/table/tabular-table.t.js`), o mesmo arquivo reporta
`checks:10, failCount:0`, limpo. O sintoma so aparece quando `page-cursor.t.js` e
`tabular-table.t.js` rodam na mesma invocacao (ambos usam `withTempDir` + `PagedText`
sobre arquivos temporarios proprios, nunca o mesmo path).

## Diagnostico

`utest.js:1124-1129`:

```js
const grand = phaseResults.reduce((a, { main }) => {
  const s = summary(main); a.failed += s.failed; a.exception += s.exception; return a
}, { failed: 0, exception: 0 })

if (!watch) {
  process.exitCode = grand.failed > 0 || grand.exception > 0 ? 1 : 0
}
```

O exit code vem de `grand`, um agregado SEPARADO do `state` por-arquivo que o `--json`
imprime (`utest.js:812`, `state: t.state`). `summary()` (`viewer.js:384`) recursa
`t.checks`/`t.tests` — se dois arquivos rodando concorrentemente (workers do runner)
compartilham por engano a mesma referencia de array de checks/tests em algum objeto de
teste global mal isolado, um incrementa o contador do outro. A contagem de checks vazando
de `page-cursor.t.js` (8) para `tabular-table.t.js` (10→18) e o rastro: os NUMEROS
migram, nao so o resultado agregado — o que aponta pra um array compartilhado por
referencia, nao so uma race no contador `grand` em si.

Nao foi possivel isolar mais fundo sem instrumentar o proprio `utest` (fora do escopo
deste projeto — `utest` e ferramenta irma, nao codigo do `iodb`).

## Contorno

`--json` e a fonte de verdade por-arquivo: filtrar por `state !== 'passed' || fails.length
> 0` em vez de confiar no exit code bruto quando a suite roda `src/table` (ou qualquer
combinacao que inclua `page-cursor.t.js` junto de outro arquivo que tambem crie muitos
`PagedText`/`withTempDir` temporarios). O `plans/8-table/8.4.eval.js` desta feature usa
esse filtro em vez de `check(r.exitCode, 0)` sozinho, por causa deste defeito.

## Correcao

Desconhecida — pediria isolar `grand`/`summary()` por worker/arquivo dentro do `utest`,
fora do escopo do `iodb`.
