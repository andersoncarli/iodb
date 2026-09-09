---
sprint: 8
date: 2026-09-09
features: [2.3]
thread: null
---
# 008 — Report: lockfile-dedicado-absorve-genesis-atomico

Feature 2.3. O mutex saiu de dentro do dado e ganhou arquivo proprio — e, no
meio do sprint, ganhou tambem a polaridade certa.

## O que mudou

**O mutex e f.lock, e AUSENCIA significa livre.** Antes, `f.yaml` era ao mesmo
tempo a projecao e o mutex: `acquireLock` renomeava `f.yaml -> f.yaml.<PID>`,
entao enquanto alguem escrevia **a projecao nao existia**. Toda a complexidade
residual da engine era contorno dessa janela.

O desenho inicial deste sprint separou os dois mas manteve a polaridade antiga
(o arquivo EXISTE = livre, renomeado = detido). A pergunta do usuario no meio do
sprint — *"da pra usar ausencia como indicador de livre?"* — inverteu isso, e a
inversao vale mais que a separacao sozinha:

- **Some o nascimento do mutex.** Com "existe = livre", alguem tem que criar o
  arquivo uma vez, e exatamente uma vez, antes de qualquer um poder toma-lo. Era
  ali que a exclusao mutua morria em silencio: durante a posse o arquivo nao
  existe, entao um `create-if-missing` rodando naquele instante forja um SEGUNDO
  mutex (o sprint 007 mediu: 8 de 120 secoes criticas sobrepostas). Com ausencia
  = livre, um diretorio novo **ja esta** no estado correto. `ensureLock` virou
  no-op e saiu da engine. Nao e uma instancia de bug corrigida, e a classe
  inteira que deixa de ser escrivel.
- **O PID vive no NOME, nunca no conteudo.** `writeFileSync('f.lock.<pid>',
  {flag:'wx'})` cria o arquivo ja identificado num unico syscall atomico. Se o
  PID fosse escrito depois do create, a varredura de holder morto poderia pegar
  a janela entre os dois, achar arquivo vazio, e nao distinguir recem-nascido de
  corrompido — roubando lock vivo ou travando para sempre.
- **Recuperacao de crash preservada**, que era inegociavel: `process.kill(pid,0)`
  detecta dono morto e remove o arquivo dele. Um mutex em memoria compartilhada
  nao sobrevive a `kill -9`; por isso continua sendo lock de arquivo.

**Consequencias em cascata**, todas subtracao de codigo:

- `publishYaml()` nao readquire mais o lock. Sob a 2.2 ela precisava, so para o
  rename final, porque escrever `f.yaml` com o lock alheio forjaria um segundo
  mutex. A projecao virou artefato derivado comum, publicada por
  `publishDerived` e arbitrada por offset, igual ao `.index`.
- **A danca de recuperacao do `open()` (~30 linhas) sumiu inteira.** Ela existia
  para o caso "f.yaml sumiu transitoriamente porque alguem detem o lock" — um
  estado que nao pode mais ocorrer.
- **A eleicao de genesis por `openSync(f.yaml,'wx')` sumiu.** O nascimento do
  dado e o do controle eram o mesmo evento e tinham que ser disputados juntos;
  agora o genesis e so a primeira escrita, sob o lock comum.
- **`lockTimeout` voltou a ser constante** (`LOCK_TIMEOUT = 1000`), justificada
  pela medicao de 2.1/2.2: com a secao critica O(1), um timeout que cresce com o
  dado nao compensa nada e transforma deadlock real em travamento longo.
- **Os `.tmp` de nome fixo restantes** receberam sufixo de PID.
- A engine passou a **consumir o protocolo de io-append.js** em vez de manter
  copia propria.

## Medicao

Sonda `plans/2-pages/2.3.probe.js`, 8 processos x 30 escritas, mesmo cenario:

| | f.yaml era o mutex | f.lock, ausencia = livre |
|---|---|---|
| workers que crasharam | 2 de 8 | 0 |
| lock timeouts | 2 | 0 |
| registros em disco | 204/240 | 240/240 |
| projecao ausente | 1184/1660 amostras | 0/~260 |
| lock residual no fim | nao mensuravel | 0 |

`yamlMissing` e a linha que define a feature: amostras tiradas de FORA enquanto
os oito escreviam. Antes, a projecao estava ausente na maioria delas; agora, em
nenhuma. **Isso e a invariante nova, nao um ganho de desempenho** — mas o ganho
apareceu de lado: ~260 ticks do amostrador contra ~1660, os mesmos 240 registros
em cerca de um sexto do tempo de parede. `create+unlink` bate
`rename+rename-de-volta` sob contencao. A suite inteira caiu de 56s para 11s.

`lockResidue` so e mensuravel sob a polaridade nova: qualquer arquivo
remanescente no fim seria um release que nao aconteceu. Sob a polaridade antiga
isso era invisivel, porque o estado livre TAMBEM era um arquivo.

## Criterio de pronto — nao atingido, e por que

O criterio declarado na feature era `bad = 0` na celula no-seed, com
`io-engine.matrix.test.js:169` virando `check(bad, 0)`. **Nao foi alterado**, e
a razao e um achado, nao uma desistencia.

A suite mostra 7 falhas, todas em `verify().valid`. Nenhuma e falha de lock:
crashes, timeouts e perda de registro estao todos zerados. A causa e outra e e
**independente do mutex**:

> `shortestPrefix` (hash.js) escolhe a chave curta consultando o `prefixSet`
> **em memoria do proprio processo**, que disco nenhum coordena. Dois processos
> escolhem o mesmo prefixo curto para payloads diferentes, ambos encadeiam
> corretamente, ambos apendam sob o lock, e o log resultante tem chave
> duplicada — o que quebra `verify()`. Medido: 234/240 chaves distintas numa
> corrida tipica.

**O baseline "passava" porque perdia dados.** Com 204 de 240 registros em disco,
ha menos oportunidade de colisao — e `verify()` audita o que sobreviveu, nao o
que sumiu (o proprio comentario de io-engine.concurrency.test.js:8 diz isso). Ao
parar de perder registros, este sprint **expos um defeito latente que a perda de
dados mascarava**. Trocar 204 registros silenciosamente perdidos por 240
registros com colisao de prefixo detectavel e progresso, mas nao fecha o
criterio.

`sprint files --drift hash.js` responde **FORA** do escopo de 2.3. Conforme a
regra do projeto, esta reportado e nao consertado: pede sprint proprio.

## Arquivos

- `io-append.js` — protocolo invertido (presenca = detido), `LOCK_TIMEOUT`
  constante, `ensureLock` vira no-op, `releaseLock` por unlink.
- `io-engine.js` — `f.lock` na familia, adota io-append.js, `open()` sem danca
  de recuperacao nem eleicao de genesis, `publishYaml` sem lock, `.tmp` por PID.
- `plans/2-pages/2.3.probe.js` — a sonda ao vivo.
- `plans/2-pages/2.3.eval.js` — o roteiro de avaliacao.

## Proximo

Sprint proprio para a alocacao de prefixo curto multi-processo (`hash.js`,
`shortestPrefix`). Sem ele o criterio `bad = 0` da 2.3 nao tem como fechar,
porque a falha que resta nao pertence ao lock.
