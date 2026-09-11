---
sprint: 20
date: 2026-09-10
features: [2.2]
thread: null
---
# 020 — projecao-tabular

A projecao tabular entrou como o terceiro codec sobre o PagedText, em modulo proprio.
Os dois criterios da feature foram medidos, nao afirmados.

## O numero

Sobre 20000 registros em 73 paginas:

| consulta | paginas abertas |
|---|---|
| varredura completa | 73 |
| range sobre coluna `@` | 2 |
| range fora de todo o intervalo | 0 |
| range sobre coluna sem `@` | 73 |

O zero e a linha que prova o mecanismo: uma faixa fora de todo o intervalo abre
NENHUMA pagina. Um filtro aplicado depois da leitura nao conseguiria isso — ele teria
que ler as 73 para descobrir que nenhuma serve. O descarte e pelo min/max, antes de
abrir.

A ultima linha e a contrapartida honesta: sem `@` a resposta e a MESMA, so que custa a
varredura inteira. O indice muda o custo, nunca a correcao.

## O arquivo continua sendo de terceiro

A doutrina da 2.1 se manteve: `file -b` diz `CSV ASCII text`, o tamanho segue multiplo
de 4096, e um `csv.DictReader` do Python que nao conhece o formato le os 20000
registros. Um parser comum ve a DECLARACAO como nome da coluna (`id:int@`) — e isso e
o desenho, nao um defeito: a primeira linha e ao mesmo tempo CSV valido e schema.

## Dois achados durante a implementacao

**O `""` colidia com o null.** O campo vazio e a unica codificacao de null, entao a
string vazia tem que viajar entre aspas. Mas o split de CSV desaspa antes do decode, e
`""` chegava como `''` — indistinguivel do vazio cru. O `splitCsv` passou a marcar
quais campos vieram entre aspas. Sem isso, toda string vazia gravada voltava como null.

**Null nao entra no min/max.** Ele nao tem posicao na ordem total, e fingir que tem
responderia errado a um range. Uma pagina que contem null numa coluna indexada e
sempre candidata. Coberto por teste proprio.

## Os testes desceram para a ordem dos milissegundos

Pedido do usuario no meio do sprint, e a causa raiz do timeout intermitente que
aparecia no `pagedtext.t.js`: **prova-se no menor tamanho que ainda exibe a
propriedade, e so escala quando a escala E a afirmacao.**

O diagnostico: tres testes do `pagedtext` escreviam 300-400 linhas write-through e
mediam 440-890ms contra um orcamento de 1000ms por teste. Passavam na maquina livre e
estouravam sob carga de suite, num timeout que nao dizia respeito a nada que o teste
afirma. O `io-engine.paged.t.js` tinha a mesma doenca e a contornava levantando o teto
para `{ timeout: 5000 }` em tres testes — o que esconde o problema em vez de resolve-lo,
e faz um teste de CORRECAO passar despercebido quando fica lento.

A contagem alta nunca foi o que eles precisavam. O que cada um exige e um arquivo de
VARIAS PAGINAS, e pagina e uma razao entre bytes e `pageSize`. Encolhendo a pagina,
tres paginas custam doze registros em vez de trezentos.

| arquivo | antes | depois |
|---|---|---|
| `pagedtext.t.js` | 2s, 🐢2-5, timeout intermitente | ~0-1s, 🐢0 |
| `io-engine.paged.t.js` | 6.2s, `timeout: 5000` em 3 testes | ~0.9s, sem teto levantado |
| `tabular-projection.t.js` | 301ms | 93ms |

Os tres testes do pagedtext que eu converti sairam de 440-890ms para 56ms, 25ms e 20ms.

**O que NAO desceu, e por que.** Dois numeros ficaram onde estavam porque ali a
contagem E a condicao, e nao um proxy de esforco:

- o teste de checkpoint precisa parar ENTRE checkpoints para que o rodape fique
  atrasado; com `checkpointEvery: 50`, 37 appends garantem isso, e um numero que
  flutuasse cairia em cima de um checkpoint metade das vezes;
- o teste do yaml sob demanda precisa PASSAR de 100 flushes, senao "nao cresceu
  sozinho" nao afirma nada. Desceu de 250 para 120, que cruza o limiar com folga.

Um caminho intermediario foi tentado e descartado: um fence de TEMPO (a regra da 4.2)
em lugar do contador. Ele funciona, mas resolve o problema errado — continua gastando o
orcamento inteiro, so que de proposito. E um fence de 900ms dentro de um teto de 1000ms
deixa 100ms para reabrir o arquivo e afirmar, o que transforma o timeout em certeza. O
fence e a ferramenta certa para BENCH, onde medir o custo e o objetivo; num teste de
correcao, o menor caso que exibe a propriedade e melhor que qualquer fence.

## Suites

`src` 395 checks (era 340, +55 do arquivo novo); `pagedtext` 72 (era 71).

## Um bug encontrado por encolher os testes

Baixar o `pageSize` fez o `io-engine.paged.t.js` devolver **o dobro** dos registros. O
dobro nao era do teste.

`src/io-engine.js:273` guarda o replay do log com
`statSync(f.proj).size > 4096` — um literal, e nao o `pageSize` com que o store foi
aberto. Com pagina de 256 bytes, uma projecao de OITO paginas ocupa 2048 bytes: o
guarda a le como vazia, o log inteiro e reaplicado por cima do que ja estava la, e todo
registro duplica. Medido em 2048/1024/512/256/128; so o 4096 escapa, porque ai tudo
cabe numa pagina. O comentario que fica logo acima do guarda ja descreve a consequencia
exata: *"replaying the whole log over it would DOUBLE every record"*.

Nenhum teste via isso porque todos usam `pageSize: 4096`, e o defeito mora exatamente
na faixa que nenhum visitava: varias paginas, menos de 4096 bytes no total.

E o **D.10** do plano (`.proj` stale na abertura), com um agravante que o plano nao
previa: na faixa multi-pagina abaixo de 4096 bytes o gap nao e so *stale*, ele
**duplica** — perda de integridade, e nao atraso. Registrado em `PROJ-REPLAY-ISSUE.md`,
reportado e nao consertado.

Consequencia para este sprint: os testes que passam pelo `io-engine` nao podem encolher
a pagina enquanto o guarda for um literal, entao ali encolheu a CONTAGEM (400 -> 80, o
minimo que ainda da duas paginas). Os do `pagedtext` e da tabular, que nao passam pelo
engine, usam pagina pequena de fato.

## Reportado, nao consertado

O `"test"` do `.sprint/config.json` aponta para `utest/utest.js`, e o runner esta em
`../utest/utest.js`. `sprint test` falha com `Module not found` por isso, e a falha e
pre-existente e independente desta feature. Os evals daqui usam o caminho certo.

Segue valendo o bug de multi-alvo do utest registrado em `UTEST-ISSUE.md`: `utest a b`
roda so o primeiro e descarta o segundo em silencio. Por isso o eval desta feature roda
os dois alvos em comandos SEPARADOS, com contagem exata em cada um.
