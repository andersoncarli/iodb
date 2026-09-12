---
sprint: 14
date: 2026-09-10
features: [5.2]
thread: null
---
# 014 — reorganizar-frentes-e-consertar-evals

As cinco frentes passam a dizer do que tratam, as features de lock migram para uma frente
de concorrencia propria, e os evals confirmados que a reorganizacao da 5.1 deixou
vermelhos em silencio voltam a passar.

## Objetivo

Arrumar a arvore antes do trabalho de paginacao comecar. Refactoring puro: nenhuma linha
de logica mudou, e o criterio foi equivalencia da suite.

## A estrutura resultante

| frente | keyword | conteudo |
|---|---|---|
| 1 | core | 1.1–1.5 confirmadas — ganhou nome e intro, `state: confirmed` |
| 2 | pagedtext | 2.0 (nova), 2.4, 2.5 (rebaixada) |
| 3 | nutshell | intocada |
| 4 | concorrencia | 4.1–4.3 (ex 2.1–2.3, confirmadas) + 4.4–4.7 novas |
| 5 | refactorings | 5.1 (ex 4.1), 5.2 (este sprint) |

## Achados

**Duas frentes tinham a mesma keyword `core`.** As frentes 1 e 4 eram ambas `core` e
ambas stubs de auto-bootstrap nunca nomeados — a frente 1 com cinco features confirmadas
e sem nome. Consequencia operacional: `sprint rename core <novo>` resolve para a **menor**
frente que casa, entao mirava a 1 e nao a 4. Verificado em dry-run antes de aplicar.

Nao ha como desambiguar pelo tool: renomear por numero so renumera (`sprint rename 4
concorrencia` responde "destino nao e um numero de frente"), `4-core` nao e reconhecido, e
o caminho `plans/4-core` e recusado por ser diretorio. A keyword foi editada no
frontmatter, e com ela unica o tool passou a mirar certo e renomeou o diretorio sozinho.

**Tres evals confirmados estavam vermelhos ha semanas.** A reorganizacao da 5.1 (sprint
012) moveu `io-append.js` e `io-engine.js` para `src/` e `src/adapters/`, mas os evals das
features de lock continuaram assertando caminhos de raiz — **10 passos falhando por
caminho morto**, numa frente inteira marcada 🔵. Confirmado por `git show HEAD:` que as
assercoes ja estavam assim no commit.

Isso e o custo direto de a 5.1 nunca ter tido eval de equivalencia, e e a razao de a
frente 5 nascer com essa regra escrita no `_front.md`.

**Tres assercoes assertavam coordenada, nao invariante**, e envelheceram calado:

- `sed -n '340,355p' io-engine.js` — numero de linha fixo, e o bloco andou;
- `grep -A2 'export function ensureLock'` procurando `'wx'` — o `ensureLock` virou stub
  (`return true`) e o `'wx'` migrou para `acquireLock` na 2.3/4.3;
- `LOCK_TIMEOUT` esperando `1000` — hoje e `3000`.

As tres foram reescritas para assertar o invariante. Numero de linha e coordenada, e
coordenada envelhece.

## Reportado, NAO consertado

Pela regra da frente 5: refactoring nao carrega conserto junto.

- **`src/io-engine.bench.js:423`** — a assercao de que o `open()` paginado e sub-linear no
  tamanho do store (8x os registros nao podem custar 8x o tempo) **falha na arvore limpa**,
  confirmado por `git stash`. E a manchete da 2.5 ("remove o teto de RAM") medida, e ela
  nao passa. E o unico vermelho remanescente do `sprint eval 4.1`.
- **O flag `dirty` do pagedtext** e escrito em quatro lugares e nunca lido em posicao de
  decisao; `ftruncateSync` e importado e nunca chamado. A escrita O(paginas sujas)
  prometida no comentario `pagedtext.js:18` nao existe.
- **`io-engine.js:477`** usa `{ ...projection }` sem o ramo `Array.isArray` que `:439`
  tem — o conserto que a 2.5 declarou ficou pela metade.

Os tres foram registrados nos planos da 2.0 e da 2.5, que e onde serao consertados.

## Consequencia para a 2.5

Rebaixada de 🟢 para ⚫. O criterio de aceitacao declarado dela — "escrita O(paginas
sujas)" — nao esta implementado, e o eval passou por **metrica-proxy**: checou alinhamento
de pagina, que e condicao necessaria e nao suficiente. A evidencia do bench acima e
independente e mede a manchete diretamente.

## Testes

`utest . --force`: **399 checks, 19 arquivos, 97 testes, zero falhas** —
identico ao estado anterior. `sprint docs`: ok. `sprint eval 4.2`: 16 passos ✓.
`sprint eval 4.3`: 12 passos ✓. `sprint eval 4.1`: 9 de 10, com o vermelho pre-existente
descrito acima.

## Duvida / fora de escopo — reportada, nao decidida

A **5.1 continua ⚫** de proposito. O trabalho dela foi feito e commitado no sprint 012,
mas ela nunca teve requisitos nem roteiro de avaliacao — e o degrau e derivado de
evidencia, nao de memoria. Forjar um eval so para promove-la seria exatamente o erro que
rebaixou a 2.5. Para subir, ela precisa de um `5.1.eval.js` que asserte o que a
reorganizacao prometeu.
