---
sprint: 9
date: 2026-09-09
features: [1.4]
thread: null
---
# 009 — matrix-paridade-entre-engines

Intro: uma frase descrevendo o que este sprint entregou (vira o hover no dashboard).

## Objetivo

A preencher.

## Entregue (2026-09-10)

A dependência de 1.5 (sprint 010) caiu: 1.5 fechou 🔵 e a suíte inteira está verde,
o que era o pré-requisito duro deste sprint.

### A definição que a feature usa

Equivalência não é entre arquivos nem entre chaves. Tudo é convertido para uma
representação mínima POJO `{k, v}`, e a equivalência é afirmada **ali**. O que um
formato fez para carregar o registro é apagado por construção, antes de qualquer
comparação — não por análise de caso.

As duas formas em memória hoje:

| engine | forma |
|---|---|
| io-engine | `{ "<key>": payload }` |
| nutshell | `{ key: "<key>", payload }` |

Ambas carregam um par (chave, payload), então ambas colapsam sem perda para `{k, v}`.

**Equivalência de uso é o requisito.** Igualdade de chave é um bônus que veio de
graça: depois de 1.5 as duas engines usam a mesma fórmula, então as chaves de
conteúdo batem sem tocar em engine nenhuma.

### Medido

- **Log inteiro igual como POJO, genesis incluído**, desde que as duas engines
  recebam o mesmo nome de store. Record 1 é `{_projection: <nome>}`, então o nome é
  *entrada*, não divergência.
- **A normalização não é vácua**: os registros crus **não** são iguais enquanto os
  POJOs são. Afirmado nos dois sentidos.
- **Chave igual sobre conteúdo com nomes de store diferentes** (ENG/NUT): as chaves
  de conteúdo seguem idênticas, `["4","7","5"]`.
- **Formato é codificação**: dash e jsonl devolvem as mesmas chaves e os mesmos
  payloads.
- **O mesmo programa roda nas duas engines** sem alteração, incluindo o caminho de
  leitura `get('#<key>')`.

Seis células novas, single-process, sem `Bun.spawn`. Suíte: 70 testes, 298 asserts
(era 64 / 258). A carga multi-processo não saiu — continua nas células de 1.3.

### Critério por taxa: morto

`check(bad <= Math.ceil(ran/2))` era limiar de tolerância a bug. Com 008 e 1.5
entregues, o critério é binário.

## Divergências encontradas — REPORTADAS, não consertadas

Regra do CLAUDE.md: achou problema fora do escopo, reporte. As duas estão fixadas
por asserção, para que unificar qualquer uma seja uma mudança **deliberada** que
quebra teste, nunca silenciosa.

**(a) `state()` significa duas coisas.** No io-engine devolve a projeção reduzida,
porque `get()` intercepta `'#1'` antes de olhar registro (`src/io-engine.js:488`).
No nutshell devolve o payload do record 1. Quatro callers dependem do sentido do
io-engine (`src/io-engine.test.js`, `src/node.t.js`, `src/db-factory.js:543`, a
célula merge da própria matriz), e `nutshell/io-nutshell.t.js:141` afirma o oposto.
Escolher qual lado se move é decisão de interface com callers nos dois lados.

**(b) `find()` entrega genesis ao predicado do caller.** O io-engine mapeia todo
registro (`src/io-engine.js:581`); o nutshell descarta as chaves `'0'` e `'1'`
antes. Com 4 payloads: 6 linhas contra 4. O comentário no bloco de leitores do
nutshell afirma que `header`/`state`/`find` "mean the same thing on both engines" —
para `find()`, não significam.

`header()` é paridade real: record 0 nas duas.

## Como 009 se relaciona com 010 — e o que confirma

As duas engines **compartilham uma fórmula de chave só**: `nutshell/io-hash.js`
reexporta de `src/hash.js` (`nutshell/io-hash.js:34`), e `src/io-engine.js:10`
importa do mesmo módulo. O sprint 010 alterou exatamente esse arquivo
compartilhado. Então a paridade de 009 não é coincidência de duas
implementações — é consequência de 010 ter consertado o mecanismo único que as
duas usam.

### 010 criou a condição que 009 mede

Antes de 010, `shortestPrefix` codificava `parseInt(p, 2)`, sem sentinela de
comprimento. Medido com oito bit-strings distintas:

| versão | nomes distintos | colisões de NOME |
|---|---|---|
| pré-010 | 5 | 3 |
| pós-010 | 8 | 0 |

O padrão é o que 010 descreveu: `'01'` colide com `'1'`, `'011'` com `'11'`,
`'010'` com `'10'` — o zero à esquerda desaparece no `parseInt`. A colisão era
de **nome**, não de cadeia, que é o que o plano de 010 afirma.

### 009 confirma 010 por reversão, não por leitura

Desfazendo **só** a sentinela de comprimento de 010 (`parseInt('1' + p, 2)` →
`parseInt(p, 2)` e o `.slice(1)` de `toBits`), a matriz passa de 63 asserts
verdes para **16 falhas**. Entre elas, e isto é o ponto:

- `check(JSON.stringify(A), JSON.stringify(B))` — a igualdade de POJO do log
  inteiro **quebra**;
- `check(JSON.stringify(a.content), JSON.stringify(b.content))` — a equivalência
  de uso **quebra**;
- `verify().valid` cai nas células de formato, de reducer e de engine.

Restaurado, 63/63 verde.

Ou seja: as células de 009 são um **detector independente** do defeito de 010.
Não foram escritas olhando o `.index` nem o lock; elas afirmam uma propriedade
dos objetos, e essa propriedade só se sustenta porque 010 entregou a alocação de
nome correta. Um eval que lê o código confirma que a linha existe; este confirma
que ela é **necessária**.

### O que 009 NÃO confirma de 010

O lock por arquivo, o `.index` v2, o `loadIndex()` e o `publishDerived` sob lock
são invisíveis daqui por construção: 009 é single-process, e essas peças só se
manifestam sob contenção. Quem as cobre é o eval de 1.5 (0 overlaps em 1600
seções, 3000 alocações sem divergência) e as células de 1.3 acima. 009 confirma
a **fórmula da chave** de 010, e só ela.

### Corrigido neste sprint

O plano de 009 dizia "abrir o sprint do prefixo curto primeiro". Esse era o 010,
já fechado 🔵 — a dependência caiu antes desta rodada começar.

## Correcao de foco (2026-09-10)

O sprint nasceu chamado "matrix-paridade-entre-engines", e o nome nomeava a metade
errada do eixo. Renomeado para **equivalencia-entre-formatos**; a feature 1.4
retitulada para "Equivalencia entre formatos — o formato e uma codificacao, nao
semantica".

O sujeito e o FORMATO. A concordancia entre engines e verificacao colateral: uma
segunda implementacao independente e a checagem mais forte de que a afirmacao e
sobre os dados e nao sobre os habitos de uma engine.

### O eixo de formato, reforcado

Duas celulas novas, porque o foco pedia mais que as duas que existiam:

- **Bytes diferentes em disco, objetos identicos em memoria.** As duas codificacoes
  poem a chave em pontas opostas da linha — `{"v":0}#4` no dash, `{"4":{"v":0}}` no
  jsonl. A celula prova primeiro que os arquivos sao mesmo distintos, senao "dash e
  jsonl concordam" seria tautologia sobre um encoder chamado duas vezes.
- **Payloads hostis dao round-trip nas duas.** Inclui `#` no meio e no fim do valor
  (o delimitador do dash), aspas, contrabarras, newline, string vazia, zero,
  negativo, `null`, `false`, aninhamento profundo e unicode. Se o dash algum dia
  confundir um `#` do payload com o delimitador, e aqui que aparece.

Suite: 72 testes, 308 asserts.
