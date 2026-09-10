---
sprint: 15
date: 2026-09-10
features: [2.0]
thread: null
---
# 015 — pagedtext-primitivo-unico

O pagedtext passa a ser o unico primitivo de armazenamento paginado do projeto, e a
escrita vira **O(paginas sujas)** de verdade. Apendar uma linha num arquivo de 3.9MB
escreve **12KB — 0.312% do arquivo**, contra a reescrita total de antes.

## O numero

```
store: 960 data pages, 3940352 bytes on disk
pages written: 3        (1 pagina suja + 2 de header)
bytes written: 12288
full rewrite would be:  3940352 bytes
ratio: 0.312% do arquivo
mid-file overwrite — pages written: 3, bytes: 12288
```

O criterio declarado dizia "2 paginas". O numero honesto e **3**, e a diferenca nao e
folga: com 960 paginas de dados, `counts[]` e `extents[]` nao cabem em 4096 bytes, entao o
header ocupa duas paginas. O `headerPages` existe exatamente para isso. Uma suja mais o
header e o minimo estrutural, e e o que o eval asserta.

O caso do **meio** custa o mesmo do caso da **cauda** — e o que separa "append barato" de
"escrita local". Uma sobrescrita no meio do arquivo nao cascateia.

## O que mudou

**Invariante de alinhamento.** Toda pagina de dados ocupa um multiplo exato de `pageSize`.
Linha maior que a pagina ocupa `k` paginas contiguas, com `k` declarado em `extents[]`.
Sem isso o offset de uma pagina nao e calculavel e escrita posicionada e simplesmente
incorreta — `renderPage` devolvia buffer curto e deixava todo offset posterior indefinido.

**Conjunto sujo real.** O `flush()` percorre so as paginas marcadas e as escreve com
`writeSync` posicionado, mais o header, que e sempre reescrito por ser o arbitro. O flag
`dirty`, que era escrito em quatro lugares e nunca lido em posicao de decisao, agora
governa o que se escreve. O `ftruncateSync`, importado e nunca chamado, passa a rodar
quando o arquivo encolhe.

**Durabilidade sem rename.** O commit e `writeSync` posicionado + `fsyncSync` no proprio
fd, nao temp+rename — rematerializar o arquivo para renomear e exatamente o custo que a
feature remove. Pagina rasgada se resolve por reconstrucao a partir do `.dash`, que e a
doutrina que o projeto ja aplica a pagina corrompida.

**Mutacao page-local.** `push`/`pop`/`shift`/`unshift`/`splice`/`[i]=` localizam a pagina
e mutam so ela; a cauda so e repaginada quando a pagina transborda. Antes cada mutacao
unitaria fazia `allLines()` + `replaceAll()`.

**A projecao escreve so as paginas que mudaram.** O `flushPages` chamava `replaceAll`, que
marca TODA pagina suja e devolvia ao store uma reescrita completa — jogando fora
exatamente o que esta feature compra. Agora as paginas novas sao comparadas com as que
estao em disco e so as diferentes sao gravadas. O re-render das LINHAS continua O(store) e
tem que continuar: numa projecao keyed as chaves sao ordenadas, entao inserir uma pode
deslocar todas as seguintes.

**A convergencia.** O `paged-projection.js` nao abre fd, nao calcula offset, nao padeia e
nao renomeia: zero `openSync`/`renameSync`/`fsyncSync` fora de prosa. Ele ficou com o que
e genuinamente sobre projecao — codec, indice de chaves, tombstone e a face Proxy. O magic
`PAGEDPROJ` deixou de existir.

**Header v3** reduzido ao genesis. Versao
desconhecida agora e um desfecho **distinto** de nao-ter-header: o arquivo e apresentado
vazio e sinalizado para rebuild. Antes ele caia no migrador de texto legado, que o
reinterpretava como linhas e chamava `flush()` — um `.proj` v1 aberto por leitor v2 era
**destruido**. Ha teste que confere que os bytes originais ficam intactos.

**Teto de cache** no pagedtext, que era um `Map` sem eviccao: uma varredura completa
materializava o arquivo inteiro, que e precisamente o teto de RAM que a 2.5 dizia remover.

**O meio-conserto da 2.5 fechou:** o recompute dentro do lock passou a usar `_projCopy()`.
Havia um unico dono da copia e um call-site que o ignorava.

## O batching saiu dos testes

O `io-engine.paged.t.js` batchava com `{ flush: 0 }` e o comentario admitia por que: "the
paged flush is a full-file rewrite, so per-record here is O(n^2)". Era a confissao do
defeito dentro do codigo de teste. Os tres sitios de batching sairam e os testes rodam uma
escrita por registro. O `paged-projection.t.js` saiu de **3466ms com um timeout** para
**278ms verde**.

## O custo do append e PLANO — e chegar la exigiu tres consertos

O criterio da feature e que escrever nao custe o tamanho do arquivo. Medido no caso que os
docs definem como fundamental — CSV append-only, fence de 900ms por celula:

| linhas | arquivo | paginas | ms/append | **paginas/append** |
|---|---|---|---|---|
| 5.000 | 0.3MB | 80 | 1.589 | **1.01** |
| 50.000 | 3.0MB | 765 | 2.169 | **1.01** |
| 200.000 | 12.3MB | 3159 | 6.350 | **1.02** |

Arquivo 39x maior, **1.01x** o custo por append. Uma pagina de dados por escrita, em
qualquer tamanho.

Chegar nesse numero passou por tres defeitos, e nenhum estava onde eu procurei primeiro.

**1. O header carregava estatistica.** `counts[]` e `extents[]` tem uma entrada por pagina,
entao o header crescia com o arquivo e era reescrito inteiro a cada commit — 55 paginas por
append num arquivo de 12MB. Tentei diffar as paginas do header e nao funciona: e um JSON
denso de numeros, e uma pagina a mais desloca todos os digitos seguintes.

A correcao veio de separar duas naturezas que estavam misturadas. **O header e o genesis do
arquivo** — magic, version, pageSize, layout, kind — e nada ali muda depois que o arquivo
existe, entao em condicao normal ele **nao e reescrito**: uma pagina, gravada uma vez. O
que muda a cada escrita e estatistica derivada e foi para o **rodape**, no fim do arquivo,
onde crescer so anda para frente e nao empurra pagina nenhuma.

**2. O rodape tambem nao precisa ser gravado sempre.** Ele tem dois regimes agora:
`volatil` (padrao, reconstruido a cada flush) e `checkpoint` (`checkpointEvery: N`, gravado
a cada N flushes). Entre checkpoints o append escreve **uma pagina de dados e mais nada**.
Isso e seguro porque o rodape **nunca foi fonte de verdade**: as paginas sao
autodescritivas — o alinhamento diz onde cada uma comeca, o filling diz onde o conteudo
acaba — entao o que o checkpoint deixa para tras e reconstruido na abertura lendo as
paginas. Ha teste que grava 37 appends depois do ultimo checkpoint, reabre e confere que os
337 registros voltam.

**3. O defeito de verdade estava no transbordo da cauda**, e so apareceu porque as duas
correcoes acima limparam o ruido. Quando a ultima pagina enchia, o `spliceLines` caia no
ramo generico de "a contagem de paginas mudou, tudo depois se desloca" e marcava a cauda
inteira como suja — 73 paginas por transbordo num arquivo de 12MB, contra 2 num pequeno.
Mas num **append** nada que ja existe se move: as paginas anteriores ficam nos mesmos
offsets. O caso ganhou ramo proprio, e e ele que faz o numero ser 1.01.

**A projecao escrevia demais tambem.** O `flushPages` chamava `replaceAll`, que marca TODA
pagina suja e devolvia ao store uma reescrita completa. Agora as paginas novas sao
comparadas com as em disco e so as diferentes sao gravadas. O re-render das LINHAS continua
O(store) e tem que continuar: numa projecao keyed as chaves sao ordenadas, entao inserir
uma pode deslocar todas as seguintes.

## O preco de tirar o batching, medido

Os tres testes de volume do `io-engine.paged.t.js` passaram a levar `{ timeout: 5000 }`, e
o arquivo saiu de ~1s para ~8s. Sem batching cada registro faz um commit **real**, com
fsync, e centenas deles nao cabem no default de 1000ms.

A troca vale porque o caminho que o engine usa de verdade e uma escrita por registro, e
era exatamente ele que ficava sem cobertura enquanto os testes batchavam para contornar o
defeito.

## Reportado, NAO consertado — e por que nao e desta feature

A assercao de sub-linearidade do `open()` paginado (`src/io-engine.bench.js:423`)
**continua vermelha**, e a 2.0 nao e quem a conserta. Ela pressupoe que paginar a projecao
torna o `open()` sub-linear. Medido, isso e falso — e falso pelo **mesmo numero nos dois
caminhos**:

| registros | open() plano | open() paginado |
|---|---|---|
| 1000 | 14.8ms | 9.0ms |
| 8000 | 152.9ms | 144.2ms |

Paginar a projecao nao mexe nisso porque nao e a projecao que custa. O `open()` rele o
`.dash` inteiro e reconstroi a cadeia de chaves com um `makeFullKey` — um SHA — **por
registro**, em `io-engine.js:290`. Esse replay e do indice e do bitmap, roda identico com
`pageSize: 0`, e e linear por construcao.

O que tornaria o `open()` sub-linear e retomar o replay de onde o derivado parou, usando o
`logOffset` que esta agora no header. Isso e a **2.4**, e nao esta nesta feature. O
diagnostico ficou escrito no lugar da assercao, com os numeros, em vez de escondido atras
de um fator generoso.

## Testes

`bun ../utest/utest.js . --force`: **408 checks, 19 arquivos, 100 testes, zero falhas** —
os 399 de antes mais 9 novos (teto de cache, versao desconhecida, rodape de checkpoint e
o round-trip de cada um). `sprint eval 2.0 --yes`: **18 passos ✓**.
