# `renderPage()` do pagedtext preenche pagina repetindo uma unidade pequena
(` ,\n`) em vez de um unico campo largo — proposta de melhoria, nao defeito

<!-- system file -->

Encontrado em `~/iodb`, thread da frente 8 (feature 8.2), ao revisar
`src/fixtures/tabular-pre-8.2.csv` (ver `ISSUES/004`). Nao e um bug — e uma decisao de
design que vale reconsiderar, levantada pelo usuario.

## Observacao

`pagedtext/pagedtext.js:153-186`, `renderPage()`, preenche o espaco livre de uma pagina
repetindo a unidade de enchimento do `kind` (`' ,\n'` pra CSV, 3 bytes) num loop:

```js
while (free >= unitLen) {
  out += unit
  free -= unitLen
}
```

Pra uma pagina de 4096 bytes com pouco conteudo real, isso produz centenas de linhas
` ,\n` identicas — o que aconteceu no fixture da 8.2 antes de ser regenerado com
`pageSize` menor (`ISSUES/004`).

## Proposta do usuario

Em vez de repetir a unidade linha a linha, usar **um unico campo largo** terminado em
`,\n` — para CSV, algo como uma linha `,,,,,,,,,,...,\n` (ou um campo de espacos seguido
de virgula) que ocupa o espaco livre inteiro de uma vez. Reduziria um arquivo paginado
com pouco conteudo de N linhas de enchimento pra 1.

## Por que nao foi feito nesta sessao

`pagedtext.js` e nucleo compartilhado por seis features ja `🔵` confirmadas (2.0, 2.1,
2.2, 2.4, 2.5, 4.7) e consumido pela 8.3/8.4 desta frente. `sprint files --drift` (com os
sprints 028-031 abertos) confirmou: **FORA do escopo** de qualquer sprint aberto —
mudar `renderPage()` e a semantica de `isFill()` junto (o padrao de deteccao de
enchimento na leitura tem que continuar reconhecendo o novo formato) e trabalho de
sprint proprio, nao ajuste dentro da frente 8.

## Se for adiante

Precisa decidir, ANTES de tocar o codigo:

1. O novo formato de enchimento e compativel com `isFill()` pra CSV/JSONL (que hoje
   casa `/^\s*,\s*$/`)? Um campo largo `,,,,...,\n` ainda casa esse regex — mas um campo
   de ESPACOS seguido de virgula (`'   ...   ,\n'`) tambem precisa casar, e casa (o
   regex permite `\s*` antes da virgula).
2. Arquivos JA GRAVADOS com o formato antigo (enchimento repetido) — que sao a maioria
   dos `.dash`/`.csv` paginados em producao hoje — continuam legiveis? `isFill()` no
   leitor teria que aceitar OS DOIS formatos (retrocompatibilidade), ou a mudanca quebra
   todo arquivo paginado existente.
3. Vale abrir como feature nova na frente 2 (pagedtext), ja que a frente inteira esta
   `🔵` e um sprint de planejamento (`sprint new`) definiria o criterio de aceite e a
   lei de compatibilidade — o mesmo padrao usado na 8.2 pro fixture-pre-mudanca.

## Contorno atual

Fixtures novos pequenos (como o da 8.2): usar `pageSize` pequeno (64-128) ao gerar, nao
o default de producao — `ISSUES/004` ja documenta isso.
