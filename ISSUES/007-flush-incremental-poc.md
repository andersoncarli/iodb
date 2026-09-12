# flush-o-dirty-nao-o-store — feature 1.6, sprint 033

## Sintoma

`flushPages()` (layout keyed) custava ~86ms para acrescentar UMA entry a um
store de 400, medido primeiro em `utest/ISSUES/002-iodb-flush-o-store.md`. O
custo crescia com o tamanho total do store, nao com o tanto que de fato mudou
— e era o motivo documentado em `utest/sprints/020-fswatch.report.md` para o
fswatch nao virar fonte de arvore padrao de um runner (indexar custava
~2.5ms/entry contra 0.03ms de um `readdirSync`).

## Diagnostico

`src/paged-projection.js:209-235` (antes da 1.6). `flushPages()` chamava
`allKeyed()` (`:151-161`) a cada flush — decodifica TODA pagina, monta um Map
global, aplica `pending` por cima — e so entao `[...merged.keys()].sort()
.map(encodeKeyed)` reordenava e re-codificava TODAS as chaves, dirty ou nao.

O comentario no proprio codigo (`:198-201`) assumia isso como "by nature":
> "The re-render of the LINES walks the whole logical content, and it has to:
> a keyed projection is sorted, so inserting one key can shift every later
> one across page boundaries."

A premissa e so PARCIALMENTE verdadeira: o efeito cascata so se propaga PARA
FRENTE (chaves depois da menor chave suja). Chaves antes dela nao mudam de
valor nem de posicao — nao precisavam ser relidas, e muito menos re-encodadas.

`replacePagesDiffed()` (`:181-193`), que recebe o resultado, ja era O(dirty)
na ESCRITA fisica (so grava paginas que mudaram) — o gargalo era so no
RE-RENDER logico que a alimenta.

## Correcao (feature 1.6, sprint 033)

`keyIndex`: array ordenado de chaves mantido vivo entre flushes (lazy na
primeira chamada, via `ensureKeyIndex()`). No flush:

1. acha a menor chave em `pending` (`minKey`);
2. lower-bound em `keyIndex` para o corte (`cut`);
3. acha a PAGINA que contem `idx[cut]` (`pageForKey`) — tudo ANTES dessa
   pagina e copiado como texto cru (`store.readPage`), sem decode/encode;
4. so as paginas a partir dali sao decodificadas, mescladas com `pending`
   (aplicando deletes) e re-ordenadas;
5. `keyIndex` atualizado incrementalmente (prefixo + sufixo novo).

**Cuidado descoberto na implementacao**: o corte tem que ser pela PAGINA que
contem a chave (`pageForKey(idx[cut])`), nao pela chave anterior
(`idx[cut-1]`) — `splitKeys` so marca o INICIO de cada pagina, entao usar a
chave anterior podia incluir, no prefixo copiado cru, a propria pagina que
contem a chave deletada, "ressuscitando" um delete. Pego pelo teste de
tombstone existente (`paged-projection.t.js`).

## Medido

Bench isolado (`scratch/quickfix-flush-bench.js`, fixture sintetica em
tmpdir, nao commitado — script de prova, nao parte da suite):

| N | add no FIM (ms) — antes | depois | add no INICIO, pior caso — antes | depois |
|---|---|---|---|---|
| 400 | 24.70 | 8.18 | 13.86 | 10.62 |
| 3200 | 87.51 | 13.55 | 67.29 | 41.94 |

"add no fim" ficou ~flat (razao 1.44x para N crescendo 8x) — a assinatura
esperada quando o custo e proporcional ao sufixo deslocado, nao ao store
inteiro. "add no inicio" (pior caso: nenhuma chave fica intacta) ainda cresce
com N — nao e regressao, e o caso em que o corte genuinamente nao ajuda
(chave nova menor que tudo o que ja existe desloca tudo).

Suite completa (`utest .`): 2703 checks verdes, mesma
baseline de antes — `paged-projection.t.js` e `fswatch.t.js` (14 checks)
inclusos.

## O que fica para depois

- O prefixo cru ainda usa `store.readPage` por pagina — I/O sem decode, mas
  ainda proporcional ao tamanho do prefixo num store maior que RAM. Nao
  medido separadamente.
- Nao ataca o `open()` custando 1.8s ao reabrir um baseline existente
  (sprint 020 do utest) — e replay de log, fora do escopo deste flush.
- `utest/ISSUES/002-iodb-flush-o-store.md` deveria ser atualizado/fechado
  referenciando este sprint.
