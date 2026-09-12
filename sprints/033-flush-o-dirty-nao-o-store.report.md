---
sprint: 33
date: 2026-09-12
features: [1.6]
thread: null
---
# 033 — flush-o-dirty-nao-o-store

Intro: `flushPages()` (keyed) parava de reler o store inteiro a cada flush — o
re-render agora e proporcional ao sufixo deslocado pela menor chave dirty, nao
ao tamanho total da projecao.

## Objetivo

`allKeyed()` decodificava TODA pagina a cada `flushPages()`, so para descobrir
onde uma chave dirty entra numa lista ordenada. Como a projecao e ordenada,
inserir/remover uma chave so pode deslocar chaves DEPOIS dela — o prefixo
(chaves menores que a menor chave suja) nunca muda de valor nem de posicao.

## O que foi feito

- **`src/paged-projection.js`** — `keyIndex`: array ordenado de chaves mantido
  vivo entre flushes (`ensureKeyIndex`, lazy na primeira chamada). `flushPages()`
  (branch keyed) agora:
  1. acha a menor chave em `pending` (`minKey`);
  2. faz lower-bound em `keyIndex` para achar o corte (`cut`);
  3. acha a pagina que contem `idx[cut]` via `pageForKey` — tudo ANTES dessa
     pagina e copiado como texto CRU (`store.readPage`), sem decode nem
     re-encode;
  4. so as paginas a partir dali sao decodificadas, mescladas com `pending`
     (aplicando deletes) e re-ordenadas;
  5. `keyIndex` e atualizado incrementalmente (prefixo + sufixo novo), sem
     rebuild do zero no proximo flush.
- Corte por PAGINA, nao por chave: `splitKeys` so marca o INICIO de cada
  pagina, entao o corte tem que ser a pagina que contem a chave, nao a pagina
  anterior — descoberto pelo teste de tombstone (`'b' in q` voltando `true`
  apos delete: a pagina inteira, com a chave deletada dentro, estava sendo
  copiada crua por engano quando o calculo usava `idx[cut-1]` em vez de
  `pageForKey(idx[cut])`).

## Verificacao

- `utest .` — 2703 checks verdes, 0 falhas (mesma baseline do
  sprint 020: `paged-projection.t.js`, `fswatch.t.js` (14 checks) inclusos).
- Bench isolado (`src/paged-projection.bench.js`, fixture sintetica em
  tmpdir, N=400/800/1600/3200):

  | N | add no FIM (ms) | add no INICIO — pior caso (ms) |
  |---|---|---|
  | 400 | 8.18 | 10.62 |
  | 800 | 20.49 | 15.83 |
  | 1600 | 16.83 | 30.48 |
  | 3200 | 13.55 | 41.94 |

  "add no fim" fica ~flat conforme N cresce 8x (8 a 1600 → 13 a 3200) — a
  assinatura de custo esperada quando o re-render e proporcional ao sufixo
  deslocado, nao ao store inteiro. "add no inicio" (pior caso: nenhuma chave
  fica intacta, sufixo = store inteiro) cresce com N, como esperado — nao e
  regressao, e o caso em que o corte realmente nao ajuda.

  Baseline antes da correcao (mesmo script, codigo pre-1.6): ambos os casos
  cresciam com N sem distincao clara entre fim/inicio (24→87ms fim, 13→67ms
  inicio de 400 a 3200) — a assinatura O(store) que a issue 002 do utest
  documentou primeiro.

## O que fica para depois

- O ganho medido aqui e sobre o RE-RENDER lógico; a leitura do PREFIXO cru
  ainda usa `store.readPage` por pagina (I/O, sem decode) — nao foi medido
  separadamente o quanto isso pesa num store muito maior que RAM. Se
  `pagesBefore` for grande, ainda ha custo de I/O proporcional a ele, so nao
  ha mais custo de CPU (decode/sort/encode) sobre esse prefixo.
- Nao ataca o `open()` custando 1.8s ao reabrir um baseline existente
  (`sprint 020` do utest) — esse custo e de replay do log, fora do escopo de
  `flushPages()`.
- `utest/ISSUES/002-iodb-flush-o-store.md` deve ser fechado/atualizado
  referenciando este sprint.
