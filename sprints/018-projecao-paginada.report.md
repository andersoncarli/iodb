---
sprint: 18
date: 2026-09-10
features: [2.5]
thread: null
---
# 018 — projecao-paginada

A projecao paginada passou a responder como o caminho plano nos tres reducers, e o `.yaml`
deixou de custar O(n) recorrente. O achado central do sprint foi um bug vivo que nenhum
teste pegava.

## O bug: a projecao em modo append nao serializava

`JSON.stringify` de um store `append` com `pageSize` lancava `{} is not iterable`. A causa
esta numa unica linha do Proxy: no layout sequencial havia uma lista branca de cinco metodos
e todo o resto caia em `getKeyed`, que itera a pagina como pares `[chave,valor]`. Numa
pagina sequencial nao ha pares, e a iteracao estoura.

Nao era um metodo, eram 22 medidos: `toJSON`, `join`, `indexOf`, `find`, `some`, `every`,
`at`, `includes`, `sort`, `entries`, `pop` e o resto. `toJSON` e o que dava o dano maior —
e o caminho por onde a projecao seria salva ou inspecionada.

**A lista branca era a forma errada.** Ela enumera o que funciona, entao todo metodo que
ela nao previu nasce quebrado. A correcao delega a lista materializada: o que a Array sabe
fazer, a projecao sabe.

| reducer | paginado vs plano, antes | depois |
|---|---|---|
| assign | identico | identico |
| merge | identico | identico |
| append | **CRASH ao serializar** | identico |

## Por que nenhum teste pegava

O unico teste de serializacao era sobre um store **keyed**, e o teste de layout sequencial
usava so `length`, indices e o iterador — exatamente os tres casos que a lista branca ja
tratava. O buraco era o complemento dela. O teste novo cobre de proposito metodos de fora
da lista antiga, e foi verificado contra o codigo anterior: falha la com o mesmo
`{} is not iterable`, passa aqui.

## O `.yaml` sob demanda

Ele era reescrito a cada 100 flushes, com um `stringify` O(n) sobre a projecao inteira, para
produzir um arquivo que **ninguem le de volta** — nao ha um so `readFileSync(f.yaml)` no
`src/`. Agora quem quer olhar pede, via `io.yaml()`, e o `close()` grava a versao final.

Medido em 250 escritas: o arquivo fica parado nos 44 bytes da genese e vai a 3574 quando
alguem pede.

## Estado

Suite verde: 325 checks, 75 testes em `src` (era 310/73); 71 em `pagedtext`.

## Fora de escopo, reportado

- `utest src pagedtext` executa so o primeiro caminho e descarta o segundo
  em silencio. Registrado em `UTEST-ISSUE.md`; por isso o eval desta feature usa dois
  comandos com contagem exata.
- Um timeout apareceu no `io-engine.paged.t.js` durante a suite cheia. Investigado: o
  arquivo passa 17/17 sozinho e ficou mais RAPIDO com a mudanca (11.7s → 6.4s), e a suite
  cheia rodou verde tres vezes seguidas. E ruido de carga da maquina, nao regressao.
