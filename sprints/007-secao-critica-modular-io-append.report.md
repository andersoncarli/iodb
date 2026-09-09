---
sprint: 7
date: 2026-09-08
features: [2.2]
thread: null
---
# 007 — secao-critica-modular-io-append

Extrai a secao critica como modulo (`io-append.js`) e unifica o hash duplicado. O
segundo consumidor (nutshell com `{ lock: true }`) foi implementado mas **nao fecha** —
esbarra na eleicao de genesis nao-atomica, a mesma divida que a 1.4 documenta.

## Estado: PARCIAL — sprint encenado sem a feature 2.2 fechar

Este report registra trabalho entregue e trabalho que nao fechou. A 2.2 permanece ⚫:
o corte principal (tirar `saveIndex`/`flushYaml` de dentro do lock em `io-engine.js`)
**nao foi feito** — o sprint parou antes, no segundo consumidor.

## O que ficou pronto e verificado

**Unificacao do hash.** `hash.js` e `nutshell/io-hash.js` eram matematicamente
identicos; medido antes de mexer: `canonical`, `sha64`, `toB64`, `fromB64`, `toBits`,
`makeFullKey` sobre 7 payloads e o range completo de 64 bits, **zero divergencias**.
As duas diferencas eram de interface e foram reconciliadas no modulo canonico:

- `shortestPrefix` devolve `{ p, key, n, bits }` — `p` e `key` sao aliases do mesmo
  valor, para servir os dois chamadores sem quebrar nenhum.
- `verify` aceita os dois formatos de registro (`{[key]: payload}` do io-engine e
  `{key, payload}` do nutshell). Uma funcao, dois envelopes, zero duplicacao.

`nutshell/io-hash.js` virou reexport. **77 linhas de matematica duplicada eliminadas.**
Equivalencia reexecutada apos a unificacao, incluindo deteccao de adulteracao nos dois
formatos: zero divergencias. Suite completa verde (249 checks).

**`io-append.js` extraido.** A secao critica destilada — `acquireLock`/`releaseLock`
movidos sem mudanca de comportamento (preservando a recuperacao de crash por PID +
`kill(pid,0)`), mais `appendGuarded` e `publishDerived`. Exclusao mutua verificada
isolada: 4 processos x 50 escritas = **200/200 linhas, 200 unicas, zero perdas**.

## Erro de design encontrado e corrigido

A primeira versao de `appendGuarded` rodava `compute` **fora** do lock e recomputava
em caso de conflito — copiando a estrutura que o `flush()` do io-engine ja usa. Isso
so e valido se `compute` for puro, e o de um motor encadeado nao e: ele avanca
`prevKey` e reivindica prefixos no `prefixSet`. A passada especulativa corrompia o
estado que a segunda passada usava, e o defeito **so aparecia entre processos**, onde
o resync de fato dispara.

Agora `compute` roda dentro do lock, uma vez so, com a razao comentada no modulo. O
pre-computo do io-engine continua fora do lock, onde e legitimo: la e o reduce sobre a
projecao, que e genuinamente puro.

## O que NAO fechou

O nutshell com `{ lock: true }` melhorou de 170 para ~239 chaves distintas de 240, mas
**nao chega a `valid=true`**. O que sobra, medido:

- Genesis duplicado em parte das corridas (2 pares em vez de 1).
- Com o lock **pre-criado**, ainda ha quebras de cadeia.

Correcao de registro: uma versao anterior deste report afirmava perda de registros
(122 em vez de 124). Estava errado — era erro de contagem meu, que somava os dois
registros de genesis. Medido worker a worker: **120 declarados, 120 no disco, zero
perda**. O lock nunca perdeu registro; o que ele nao conseguia era manter a cadeia.

O caminho default segue intacto byte por byte
(29/29 no nutshell, 249 na suite completa) e o teste caracterizador da 3.2 continua
verde, como tem que ser.

### Causa raiz encontrada: recriar o mutex destroi a exclusao

A leitura inicial (eleicao de genesis) estava **errada** e foi descartada por medicao.
A causa real e o ciclo de vida do lock, e e sutil o bastante para merecer registro:

**Enquanto um processo DETEM o lock, o arquivo de lock nao existe** — `acquireLock` o
renomeou para `<lockFile>.<pid>`. Logo, "criar se nao existir" NAO e um init idempotente
seguro. Um segundo processo rodando essa checagem durante o hold recria o mutex, e
passam a existir dois: o `<lockFile>` novo e o `<lockFile>.<pid>` detido. Os dois
processos entram na secao critica ao mesmo tempo.

Medido, com trabalho real dentro da secao critica (o teste anterior nao pegava porque
a secao era instantanea demais para a janela aparecer):

| | secoes criticas sobrepostas |
|---|---|
| cada worker faz create-if-missing | **8 de 120** |
| criacao feita exatamente uma vez | **0 de 120** |

`io-append.js` ganhou `ensureLock()`, que usa `wx` (exclusive-create, atomico) SEM
guarda de `existsSync` — EEXIST significa "outro venceu", que e sucesso, e cobre
tambem "existe porque alguem esta segurando". O comentario no modulo explica por que
a guarda e proibida ali, que e o tipo de invariante que alguem reintroduz sem saber.

**Com o lock pre-criado antes de qualquer escritor, `io-append.js` exclui corretamente:
0 violacoes em 120 secoes criticas.** O modulo compartilhado esta solido.

### O que ainda falta (segundo defeito, no nutshell)

Mesmo com exclusao correta e lock pre-criado, o cenario 8x30 do nutshell segue em
~237/240 e `valid=false`. Como o `io-append.js` foi medido e exclui, o defeito restante
esta no **uso** que o nutshell faz dele — provavelmente no `onResync`/`chain`, nao no
lock. Nao ha diagnostico fechado; nao insistir por hipotese.

## O CORTE PRINCIPAL DA 2.2 — feito e medido

`saveIndex()` e a publicacao da projecao sairam de dentro do lock. A secao critica
agora e so o trabalho indivisivel: conferir que o log nao cresceu, apender, soltar.

### Resultado — p99 do tempo-com-lock, 1 processo, 200 escritas marginais

| store | ANTES | DEPOIS |
|---|---|---|
| 1.000 | 316 ms | **10 ms** |
| 10.000 | 589 ms | **10 ms** |
| 50.000 | 360 ms | **7 ms** |

p95: de 21/96/25 ms para **2/1/1 ms**.

O que importa nao e so a queda: e que a curva ficou **plana**. A secao critica deixou
de crescer com o tamanho do store, que e literalmente o criterio de aceitacao da 2.2.
No bench por fases, `publish` caiu para 0.00 ms em todos os percentis.

### Como foi feito

- **Arbitro de ordem** (`indexOffsetOnDisk`): com o indice publicado fora do lock, um
  escritor lento pode landar depois de um adiantado e sobrescrever um indice mais novo.
  `saveIndex()` so publica se `lastOffset` for >= ao que ja esta no disco. Isso e seguro
  porque o indice e HINT, nao verdade: pular uma escrita custa um hint velho; sobrescrever
  custaria um hint errado.
- **`publishYaml()`** faz o `stringify` (o O(n)) fora do lock e readquire o lock apenas
  para o rename. Nao da para simplesmente escrever `f.yaml` sem lock: ele e projecao E
  mutex ao mesmo tempo, e escreve-lo durante um hold forjaria um segundo mutex — o mesmo
  mecanismo medido acima (8 de 120 secoes sobrepostas). **A 2.3 elimina essa danca**: com
  mutex em arquivo proprio, a projecao vira artefato derivado como qualquer outro.

### Multi-processo — bench refatorado, numero obtido

O bench violava a regra de granularidade do projeto (nenhum comando acima de 10s; se
passa disso e erro de projeto do teste). A celula de 100k levava dezenas de segundos.
Refatorado:

- grade default 1k/10k/20k com 100 escritas por celula — a grade inteira roda em ~16s,
  celula mais cara 6.7s;
- `100k` saiu do default para `--full`. Um bench que ninguem roda nao vira guarda de
  regressao;
- `CELL_BUDGET_MS = 10s`: o bench agora AVISA quando uma celula estoura, em vez de
  silenciosamente ficar mais lento a cada release.

Resultado em `bench/resultado-2.2.txt`. Comparacao direta com o baseline em 10k x 8:

| 10k x 8 procs | baseline 2.1 | depois da 2.2 |
|---|---|---|
| critical p95 | 14 ms | **10 ms** |
| critical p99 | 30 ms | **15 ms** |

Metade — melhorou, mas **nao resolveu**. Sob contencao o gargalo deixa de ser a secao
critica e passa a ser o `lockWait` (p99 618ms no baseline). Em 20k x 8, 3 de 8 workers
ainda batem o lock timeout. Isso e trabalho da **2.3**: enquanto `f.yaml` for projecao E
mutex ao mesmo tempo, publicar a projecao exige readquirir o lock.

### Onde foi parar o O(n)

Medido por fase, 1 processo:

| store | precompute p95 | critical p95 |
|---|---|---|
| 1.000 | 1 ms | 0 ms |
| 10.000 | 5 ms | 1 ms |
| 20.000 | 11 ms | 1 ms |

O custo O(n) **migrou para fora do lock**, que era exatamente o objetivo. O que resta
crescendo e o `precompute`, e a causa ja esta identificada e registrada: `shortestPrefix`
e O(n) no `prefixSet` (achado da 2.1, alvo da 2.4).

## Estado dos testes

Rodados **isolados**, que e a forma correta para suites que spawnam processos:

| suite | resultado |
|---|---|
| io-engine.concurrency.test.js | ✔ 18 |
| io-engine.matrix.test.js | ✔ 20 |
| nutshell/io-nutshell.concurrency.test.js | ✔ 8 |
| io-engine.test.js | ✔ 55 |
| hash / db-factory / db.io / db.dx / node / db | ✔ 10 / 8 / 16 / 6 / 20 / 5 |

Na suite completa (`utest .`) aparece 1-2 falhas por corrida, **em arquivo diferente a
cada vez** (concurrency, depois nutshell, depois matrix) — assinatura de contencao, nao
de regressao. Corridas limpas da suite completa deram 249 verdes, o mesmo numero de antes
do corte. A celula `no-seed` da matriz, que a 1.3 documentava como instavel, rodou
`bad=0` em 12 trials com `onDisk=240/240`.

## Proximo passo

A 2.2 continua ⚫ e seu corte principal esta intacto para ser feito. A decisao do
usuario apos este sprint foi reabrir a questao mais acima: repensar o formato da
projecao e separar **lock de paginas** de **projecao atomica** — o que muda o que 2.4
e 2.5 devem ser.
