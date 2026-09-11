# O guarda de replay do `.proj` usa um literal 4096, e nao o `pageSize` do store

Encontrado ao encolher os testes para a ordem dos milissegundos (a "regra dos 3"):
ao baixar o `pageSize` dos testes, o `io-engine.paged.t.js` passou a devolver **o
dobro** dos registros. O dobro nao era do teste — e um defeito de codigo em uso.

## O sintoma

Com `reduce: append`, 40 escritas, fechar e reabrir:

| pageSize | paginas | registros lidos | esperado | duplicou |
|---|---|---|---|---|
| 4096 | 2 | 40 | 40 | nao |
| 2048 | 2 | 80 | 40 | **sim** |
| 1024 | 3 | 80 | 40 | **sim** |
| 512 | 4 | 80 | 40 | **sim** |
| 256 | 8 | 80 | 40 | **sim** |
| 128 | 15 | 80 | 40 | **sim** |

Sao duplicatas de verdade (`new Set(seqs).size !== seqs.length`), e nao registros
a mais. So o 4096 escapa.

## A causa

`src/io-engine.js:273`:

```js
const projHasContent = existsSync(f.proj) && statSync(f.proj).size > 4096
if (!(offset === 0 && projHasContent && !_pagedSynced)) {
  for (const rec of recs) { try { _reduce(projection, rec) } catch { } }
  projection.__flushPages()
}
```

O comentario logo acima ja descreve a consequencia exata: *"replaying the whole log
over it would DOUBLE every record"*. O guarda existe para evitar isso.

O defeito e que o limiar e o **literal 4096**, e nao o `pageSize` com que o store foi
aberto. Com pagina de 256 bytes, uma projecao de OITO paginas ocupa 2048 bytes — o
guarda a le como vazia, o `if` nao se aplica, o log inteiro e reaplicado por cima do
que ja estava la, e todo registro duplica.

O `> 4096` era um proxy para "tem mais que o cabecalho". Desde a 2.1 a genese viaja no
rodape e a pagina 0 e dado, entao o proxy nao descreve mais nem o que descrevia.

## Por que nao aparecia

Todo teste do caminho paginado usa `pageSize: 4096`. Nesse tamanho, os volumes dos
testes ou cabem numa pagina (e o guarda acerta por acidente) ou passam dos 4096 bytes
(e o guarda acerta de verdade). O defeito mora exatamente na faixa que nenhum teste
visitava: **varias paginas, menos de 4096 bytes no total**.

Consequencia pratica hoje: qualquer store aberto com `pageSize` menor que 4096
duplica a projecao ao reabrir.

## O conserto, quando for a hora

Nao e trocar o literal pelo `pageSize` — isso so move o mesmo proxy para outro numero.
O guarda pergunta "esta projecao ja absorveu estes registros?" e responde por TAMANHO.
A resposta correta e um **offset**: quanto do log o `.proj` ja absorveu. O `logOffset`
ja existe no rodape do pagedtext (`serializeTrailer`), e a 2.4 ja declara fecha-lo.

Isto e o **D.10** do plano `foamy-baking-rabin` ("`.proj` stale na abertura, gap
declarado e nao fechado"), que previu a heuristica de tamanho e o offset como cura. O
que este achado acrescenta e que o gap nao e so *stale*: na faixa multi-pagina abaixo
de 4096 bytes ele **duplica**, que e perda de integridade e nao so atraso.

## Escopo

Fora da feature 2.2 (projecao tabular). Reportado, nao consertado, conforme a regra do
projeto. Enquanto durar, os testes que passam pelo `io-engine` nao podem encolher o
`pageSize`; eles encolheram a CONTAGEM. Os testes do `pagedtext` e da projecao
tabular, que nao passam pelo engine, usam pagina pequena sem tocar neste caminho.
