---
sprint: 17
date: 2026-09-10
features: [6.1]
thread: null
---
# 017 — Report: metadatastore-iodb

Feature 6.1. O fswatch parou de depender de SQLite: a persistencia de metadados agora e um
store `iodb` chaveado por `dev:ino`, e o SQLite continua disponivel como backend opcional.

## O que foi entregue

**A troca cabe numa fabrica, e coube.** `Scanner`, `reconcile`, `watchTree`, `snapshot` e o
baseline nao mudaram na sua logica — so o argumento de `MetadataStore`, o campo `database`
de `stats()` e a saida do `db:` da API. O criterio de que a fabrica era o unico ponto de
acoplamento se confirmou.

**O SQLite virou escolha, nao ausencia.** `BACKENDS = { iodb, sqlite }`, selecionado por
`backend:` na config, default `iodb`. Os dois respondem a MESMA interface —
`put/remove/flush/all/close/path`. O `flush` do SQLite e no-op de proposito: existe para
que nenhum chamador precise saber qual backend esta embaixo. O `SqliteStore` e UMA tabela
`entries`, nao o split `nodes`/`leaves` (feature 6.4).

**`.fswatch/` por projeto**, um dominio por arvore, nunca compartilhado.

## Os quatro achados

**1. O bug da projecao viva — e ele e do engine, nao do fswatch.** Com `pageSize > 0`,
`io.get('#1').chave` devolve `undefined` depois de escrever, embora `Object.keys` liste a
chave; reabrir o store le certo. Nao e escrita bufferizada, nao e formato de chave, nao e
valor objeto — com `pageSize: 0` nao acontece. O dado esta durável e o log esta correto; a
visao em memoria do processo que escreveu e que nao enxerga. Reproducao em 4 linhas:
`plans/6-fswatch/6.1.bug-projecao-viva.probe.js`. **Registrado como requisito da 2.5**, nao
consertado aqui.

O custo ja foi pago: o `MetadataStore` mantem um espelho em RAM do baseline porque nao pode
reler o que gravou. Isso e exatamente o teto de RAM que a frente 2 existe para remover, e e
a frente 6 provando o seu proprio ponto — um consumidor externo achou em um dia o que os
testes do engine nao pegaram.

**2. O loop de realimentacao.** O store mora DENTRO da arvore observada, entao o watcher
via as escritas do proprio engine, gravava, e escrevia de novo. Isso nao falhava: pendurava
o processo. Filtrar no `emit` nao resolve — o callback grava ANTES de emitir. O guard tem
que estar no topo do callback do watcher, e `.fswatch/` e excluido estruturalmente, nao por
config do usuario.

**3. O estado vazava entre os testes, e o SQLite escondia.** A config POJO ancorava o banco
no cwd, entao todo `FSWatch` do processo compartilhava um store. Com ids sempre novos (inode
fresco) o SQLite nunca acusou; o log append-only acusou no primeiro teste. A ancora do POJO
passou a ser o primeiro target.

**4. A suite dependia do cwd.** `bun test` rodado de `fswatch/` pendurava; da raiz,
completava. Era o sintoma que a 6.2 previu antes de existir.

## As decisoes

**A varredura bufferiza; o caminho ao vivo nao.** `io.in()` faz fsync real (~1.0ms/rec) e
um `put` por arquivo tornava as arvores grandes inviaveis. A varredura e reconstrutivel por
definicao — e uma leitura do filesystem, que e a fonte de verdade — entao perder registros
bufferizados num crash custa um rescan, nao correcao. Um evento ao vivo e observacao unica:
esse nao bufferiza. Medido: 0.18–0.42ms/rec, contra ~1.0 sem buffer.

**`.git` e `node_modules` sao contados e conhecidos, nao caminhados.** O entry do diretorio
e gravado — existe, tem `dev:ino`, tem `mtime`, entao "mudou algo aqui dentro" sobrevive —
e a travessia para ali. Reduz o soml de 23135 para 8479 entries.

## As arvores reais

| alvo       | entries | scan   | ms/rec | open  | .dash  | readback |
| ---------- | ------- | ------ | ------ | ----- | ------ | -------- |
| iodb       | 251     | 63ms   | 0.25   | 26ms  | 55K    | ok       |
| utest      | 199     | 36ms   | 0.18   | 23ms  | 47K    | ok       |
| sprint-cli | 464     | 105ms  | 0.23   | 43ms  | 107K   | ok       |
| soml       | 8479    | 3327ms | 0.39   | 766ms | 1830K  | ok       |

## Verificacao

`utest fswatch/fswatch.t.js --force` — 14 checks verdes. A suite migrou de
`bun:test` para **utest**, que e o runner do projeto; o `scripts.test` do `package.json`
apontava para `utest` e nao rodava, e agora roda.

`bun plans/6-fswatch/6.1.eval.js` — 8 afirmacoes verdes, incluindo os negativos estruturais
(sem tabela nodes/leaves, nenhum `.sqlite` criado) e o custo abaixo de 1ms/rec.

Testes somados que o SQLite nunca teve: o flip dir<->file sem `size` residual (a armadilha
do `merge` raso) e a paridade das duas fabricas na mesma interface.

## Fora de escopo, reportado

`pagedtext.t.js` tem timeouts intermitentes (1 a 3 por corrida) que **precedem** este
sprint — reproduzidos com as mudancas guardadas. E limiar de tempo da frente 2, nao regressao
daqui.

As tres lacunas do README do fswatch continuam abertas e declaradas no `_front.md`:
`{baseline:false}` vs `baselineFirst`, `content_changed` nunca emitido, e o `exclude` do
usuario nao podar a varredura em geral.
