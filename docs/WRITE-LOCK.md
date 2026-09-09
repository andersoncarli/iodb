# O write lock do iodb

> Estado: vigente desde o sprint 008 (feature 2.3, 🔵 confirmada em 2026-09-09).
> Implementacao: `io-append.js`. Consumidores: `io-engine.js`, `nutshell/io-nutshell.js`.

Este documento explica **por que** o lock e assim, nao so como ele funciona. As
tres formas anteriores estao descritas no fim, porque cada uma morreu de uma
causa especifica, e e a causa que justifica a forma atual.

## O protocolo, em cinco linhas

```
livre    → nao existe nenhum  <base>.lock.*
detido   → existe             <base>.lock.<PID>
acquire  → writeFileSync('<base>.lock.<PID>', '', {flag:'wx'})
release  → unlinkSync('<base>.lock.<PID>')
orfao    → varre <base>.lock.<pid>, process.kill(pid,0), unlink se morto
```

E so isso. Nao ha arquivo de estado, nao ha conteudo, nao ha inicializacao.

## As tres decisoes

### 1. Ausencia significa livre

Esta e a decisao central, e ela foi tomada no meio do sprint 008 a partir de uma
pergunta do usuario. O desenho original ia manter a polaridade herdada: o
arquivo **existe** = livre, e detem-se renomeando ele para longe.

A polaridade antiga obriga o mutex a **nascer**. Alguem tem que criar o arquivo
uma vez, e exatamente uma vez, antes que qualquer processo possa toma-lo. E ali
que a exclusao mutua morre em silencio, porque durante a posse o arquivo esta
ausente — indistinguivel de "ainda nao nasceu". Um `create-if-missing` rodando
naquele instante forja um segundo mutex e admite dois escritores ao mesmo tempo.
O sprint 007 mediu isso: **8 de 120 secoes criticas sobrepostas**.

Com ausencia = livre, o estado livre e o estado vazio. Um diretorio recem-criado
ja esta correto. Nao ha cerimonia de nascimento para errar, nao ha corrida de
inicializacao, e nada a limpar depois de um crash exceto o arquivo do proprio
morto. A classe de bug deixa de ser escrivel, o que e diferente de uma instancia
dela ser corrigida.

O custo aparente: `create` e `unlink` parecem mais trabalho que dois renames. Na
pratica sao menos, e a medicao esta na secao de performance.

### 2. O PID vai no nome, nunca no conteudo

A recuperacao de crash precisa saber **quem** detem o lock, para poder testar se
esse alguem ainda existe. A informacao poderia morar dentro do arquivo. Nao mora,
e a razao e uma janela.

`writeFileSync(nome, '', {flag:'wx'})` cria o arquivo **ja identificado**, num
unico syscall atomico. Se o PID fosse escrito num segundo passo, existiria um
intervalo entre criar e preencher no qual a varredura de orfaos encontra um
arquivo vazio. Vazio nao distingue *recem-nascido* de *corrompido*: a varredura
ou rouba um lock vivo, ou trava esperando para sempre. O nome fecha a janela por
construcao, sem codigo defensivo.

### 3. E arquivo, e nao mutex em memoria compartilhada

Um mutex em memoria compartilhada seria mais rapido. Foi descartado, e o criterio
nao e negociavel: **um bit de mutex nao sobrevive a `kill -9`**. O holder morto
trava o bit para sempre, e nao ha ninguem para destrava-lo, porque o dono era o
unico que sabia que o detinha.

Um arquivo sobrevive ao dono e carrega a identidade dele no nome. Qualquer
processo posterior pode fazer `process.kill(pid, 0)`, descobrir que o dono morreu,
e remover o cadaver. A recuperacao de crash e a propriedade que paga o custo do
filesystem.

Detalhe do desenho: quem varre um orfao **nao** assume a posse. Ele so apaga e
deixa o proximo giro do spin tentar o `wx` normalmente. Assim a aquisicao mora em
um unico lugar, e dois processos que reapem o mesmo cadaver ainda precisam
disputar o `wx`, onde o kernel escolhe exatamente um vencedor.

## O timeout, e por que voltou a ser constante

`LOCK_TIMEOUT` e 1000ms fixo. Ele ja foi adaptativo, crescendo com o tamanho da
projecao, e isso era uma compensacao, nao uma politica: o trabalho sob o lock
crescia junto, porque a projecao inteira era reescrita dentro da secao critica.

A feature 2.2 tirou o trabalho O(n) de dentro do lock e a 2.1 mediu o que sobrou —
*stat, append, release*, plano no tamanho do store. Um timeout que cresce nao
compensa mais nada, e um timeout que cresce e pior que um fixo: transforma um
deadlock real numa espera longa proporcional aos seus dados.

1000ms contra uma secao critica sub-milissegundo sao cerca de tres ordens de
grandeza de folga. Cobre ruido de escalonador e disco lento sem esconder um
holder de verdade travado. Quem cuida de holder morto e a varredura de PID, nao o
timeout.

## O que a ausencia da janela permitiu apagar

O ganho maior deste desenho nao e o lock em si. E o codigo que deixou de precisar
existir, porque toda ele era contorno da janela em que a projecao sumia do disco:

- a danca de recuperacao de `f.yaml` em `open()`, cerca de 30 linhas, que tratava
  "a projecao sumiu porque alguem detem o lock" — um estado que nao ocorre mais;
- a eleicao de genesis por `openSync(f.yaml, 'wx')`, que misturava o nascimento do
  dado com o nascimento do controle;
- a reaquisicao de lock dentro de `publishYaml()`, necessaria so porque escrever a
  projecao livremente forjaria um segundo mutex;
- o `lockTimeout` adaptativo;
- a duplicacao do protocolo de lock entre `io-engine.js` e `io-append.js`;
- `ensureLock` inteiro, que existia apenas para a cerimonia de nascimento.

A projecao virou artefato derivado como o indice: reconstruivel a partir do log
append-only, publicada fora do lock, arbitrada por offset.

## Impacto em performance

Medido com 8 processos concorrentes x 30 escritas sobre a mesma base:

| | f.yaml era o mutex | f.lock, ausencia = livre |
|---|---|---|
| workers que crasharam | 2 de 8 | 0 |
| lock timeouts | 2 | 0 |
| registros em disco | 204/240 | 240/240 |
| projecao ausente | 1184/1660 amostras | 0/512 |
| residuo de lock ao fim | nao mensuravel | 0 |

A suite completa caiu de 56s para 11s. `create+unlink` bate `rename+rename-back`
sob contencao, provavelmente porque o rename de volta na liberacao disputa a mesma
entrada de diretorio que todo mundo esta tentando renomear para si.

O numero mais importante da tabela e a linha da projecao ausente. Ela e o
invariante que define a feature: um leitor externo nunca mais observa a projecao
faltando. Antes, observava em 71% das amostras.

## Impacto em seguranca

Tres propriedades, nesta ordem de importancia:

**Exclusao mutua real.** O `wx` e uma decisao do kernel, com exatamente um
vencedor. Nao ha checagem-e-entao-agir do lado do usuario, entao nao ha janela
entre verificar e tomar.

**Nenhuma perda silenciosa.** Antes, 36 de 240 registros desapareciam sob
concorrencia, e `verify()` continuava dizendo `valid: true` — ele audita o que
sobreviveu, nao o que sumiu. Hoje os 240 chegam.

**Recuperacao de crash preservada.** Um `kill -9` deixa o arquivo para tras, e o
proximo escritor o remove depois de confirmar que o dono morreu.

Uma ressalva honesta, e ela e importante: **este sprint expos um defeito latente
que a perda de dados mascarava.** `shortestPrefix`, em `hash.js`, escolhe a chave
curta consultando o conjunto de prefixos em memoria do proprio processo, e nada no
disco coordena isso entre processos. Dois processos escolhem o mesmo prefixo curto
para payloads diferentes, ambos encadeiam corretamente, ambos apendam sob o lock, e
o log resultante tem chaves duplicadas — o que quebra `verify()`.

O lock nao tem culpa nisso. O baseline passava porque com 204 registros em disco
havia menos oportunidade de colidir. Ao parar de perder registros, ficou visivel. O
conserto e sprint proprio, na frente core.

## Historico: as tres formas anteriores

**1. Sem lock.** O estado original do nutshell, e ainda o padrao dele: *no locks,
no WAL, no fsync*. Correto para um unico processo, e o nutshell documenta essa
escolha em vez de esconde-la.

**2. `f.yaml` como mutex, por rename.** `acquireLock` renomeava `f.yaml` para
`f.yaml.<PID>`; liberar renomeava de volta. Elegante para locks curtos, e a fonte
de tudo que este documento descreve como apagado. O defeito estrutural: a projecao
e o mutex eram o mesmo arquivo, entao **controle e dado tinham o mesmo ciclo de
vida**, e proteger um significava fazer o outro desaparecer.

**3. `.lock` dedicado com polaridade antiga.** O desenho inicial do sprint 008,
que nunca chegou a ser commitado. Separava controle de dado — ganho real — mas
mantinha "existe = livre", e portanto herdava a cerimonia de nascimento e a
armadilha medida pelo 007. A pergunta do usuario sobre polaridade o substituiu
antes que o codigo assentasse.

## Onde ler o codigo

- protocolo e secao critica: `io-append.js` (`acquireLock`, `releaseLock`,
  `appendGuarded`, `publishDerived`)
- consumidor indexado, projecao YAML: `io-engine.js`
- consumidor minimo, lock desligado por padrao: `nutshell/io-nutshell.js`
- roteiro de avaliacao executavel: `plans/2-pages/2.3.eval.js`
- sonda de medicao ao vivo: `plans/2-pages/2.3.probe.js`
