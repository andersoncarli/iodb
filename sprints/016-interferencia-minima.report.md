---
sprint: 16
date: 2026-09-10
features: [2.1]
thread: null
---
# 016 — interferencia-minima

O arquivo paginado voltou a ser um arquivo do formato dele: zero bytes NUL, a genese saiu
da pagina 0 para o rodape, e o enchimento virou sintaxe do formato em vez de lixo tolerado.

## O que mudou, medido

| | antes | depois |
|---|---|---|
| bytes NUL (CSV de 200 registros) | 8030 de 16384 | 0 de 12288 |
| `file(1)` | `data` | `CSV ASCII text` |
| `grep` sem `-a` | exit 1 (nao encontrado) | encontra |
| primeira linha | `{"magic":"PAGEDTEXT",...}` | `id,name,email` |
| tamanho apos aparar fim de linha | 12288 → 8119 | 12288 → 12288 |
| leitor de CSV do Python | 302 registros, ultimo = lixo | 200 registros, limpos |

## As tres partes

**A genese viaja no rodape.** Guardar magic/version/pageSize/layout/kind na pagina 0 custava
a primeira linha do arquivo. No rodape ela nao ocupa lugar que o formato precise, e
`loadHeader()` passou a ler pelo fim. O rodape stale nao e mais truncado: a genese dele
continua valida, e o `pageSize` declarado e a unica coisa que nao se reconstroi das paginas.

**O enchimento e sintatico.** Em csv/jsonl e um campo extra delimitado (` ,`); nos formatos
com comentario, uma linha de comentario. A virgula e o comentario ancoram o fim da linha
contra um editor que apara espaco — que era o modo de falha real, medido em 12288 → 8119
bytes com o enchimento antigo de um espaco solitario.

**O enchimento nao e neutro em todo lugar, e o kind declara isso.** Dentro de um bloco
escalar de YAML nao existe comentario, e qualquer linha de enchimento vira conteudo da
string. Nao ha byte que seja enchimento e nada ao mesmo tempo ali. `kindRestrictions('yaml')`
devolve a restricao em runtime; quebrar a pagina fora do bloco e do chamador.

## Deteccao, nao prevencao

Nada impede um editor de apagar o enchimento, e prometer que impede seria mentira. O que se
pode e perceber: `validate(file)` confere alinhamento, ausencia de NUL e se as paginas que o
rodape declara cabem no arquivo. Num arquivo ferido ele acusa
`tamanho 6454 nao e multiplo de 4096`.

## Estado

Suite verde: 310 checks em `src`, 71 em `pagedtext` (66 → 71 nesta feature). Bench sem
regressao: 1.01–1.02 paginas por append num intervalo de 41x de tamanho de arquivo.

## Fora de escopo, reportado

- `fswatch.test.js` falha por resolucao de modulo. Pre-existente e sem relacao — verificado
  que falha identico no commit anterior; `fswatch/` nao esta versionado.
- Enchimento em blocos de tamanho fixo (`"\s{128}\n"`), pedido pelo usuario e por ele proprio
  marcado como secundario. Nao implementado; fica registrado para uma feature propria.
