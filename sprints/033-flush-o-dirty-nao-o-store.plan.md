# 033 — Plano: flush-o-dirty-nao-o-store

## Objetivo

`flushPages()` (keyed) reconstruia a lista ordenada de chaves inteira a cada
flush via `allKeyed()` — decodifica TODA pagina so para achar onde UMA chave
dirty entra. Medido em `utest/ISSUES/002-iodb-flush-o-store.md`: 86ms para
adicionar uma entry a um store de 400. Isso e o que ainda impede o fswatch de
ser fonte de arvore padrao de um runner (`utest/sprints/020-fswatch.report.md`).

Uma projecao keyed e ordenada: inserir/remover uma chave so pode deslocar
chaves DEPOIS dela. Chaves antes da menor chave dirty nao mudam de valor nem
de posicao — nao precisam ser relidas nem re-escritas.

## Passos

1. `src/paged-projection.js`: manter `keyIndex` (array ordenado de chaves)
   vivo entre flushes, construido lazy na primeira vez (`ensureKeyIndex`).
2. Em `flushPages()` (branch keyed, `pending.size > 0`): achar a menor chave
   dirty (`minKey`), fazer lower-bound em `keyIndex` para achar o corte
   (`cut`), achar a pagina que contem `idx[cut]` (`pageForKey`) e copiar como
   RAW TEXT (sem decode/encode) todas as paginas estritamente antes dela —
   essas nunca mudam de conteudo.
3. Decodificar e mesclar com `pending` (aplicando deletes) so as paginas a
   partir dai; reordenar e recodificar so esse sufixo.
4. Atualizar `keyIndex` incrementalmente (prefixo + sufixo novo), sem rebuild.
5. Provar com fixture sintetica (300/600/1200+ entries): "add no fim" deve
   ficar ~flat conforme N cresce; "add no inicio" (pior caso: sem chave antes
   dela, sufixo = store inteiro) pode crescer com N — esperado, nao regressao.

## Criterio de pronto

- Suite completa do iodb (`bun ../utest/utest.js .`) verde, sem regressao —
  em particular `paged-projection.t.js` (inclui tombstone/delete, que e o caso
  onde o corte por PAGINA (nao por chave individual) podia incluir uma chave
  deletada no prefixo copiado cru).
- Bench isolado mostra "add no fim" descolado de N (nao mais O(store)).
