---
sprint: 18
date: 2026-09-10
features: [2.5]
thread: null
---
# 018 — Plano: projecao-paginada

Sprint da feature **2.5 — Projecao paginada 4K: remove o teto de RAM, mantem o cat**,
reaberta apos a 2.0 e agora desbloqueada por ela.

## Ponto de partida: o que a 2.0 ja pagou

A 2.0 absorveu boa parte do escopo original. Verificado no codigo, nao suposto:
`paged-projection.js` importa o `pagedtext` e nao abre mais fd proprio; o meio-conserto do
`{ ...projection }` esta fechado (`io-engine.js:477` usa `_projCopy()`); a escrita ja e
page-local. O que sobrou sao dois itens — e um deles so apareceu porque foi medido.

## Passos

1. **A projecao sequencial responde como Array.** Havia uma lista branca de cinco metodos
   (`reduce/map/filter/forEach/slice`) e TODO o resto caia no ramo keyed, que itera a pagina
   como pares `[chave,valor]`. Numa pagina sequencial isso e `for (const [k,v] of {})` e
   estoura. Delegar a `allSeq()` inverte a logica: o que a Array sabe fazer, a projecao sabe.
2. **O `.yaml` vira sob demanda.** Sai do `% 100` e ganha porta propria na API (`io.yaml()`).
   O `close()` continua gravando a versao final.
3. **Teste para os dois**, cobrindo metodos de FORA da antiga lista branca — o buraco, e nao
   o que ela ja acertava.

## Criterio de pronto

Projecao identica ao caminho plano nos tres reducers (`assign`, `merge`, `append`); zero
metodos de Array que estouram; `JSON.stringify` de um store append funciona; o `.yaml` fica
parado ate alguem pedir; suite verde.
