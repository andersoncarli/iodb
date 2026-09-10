# 009 — Plano: equivalencia entre formatos

Plano do sprint 009 (feature 1.4). Objetivo e nota historica: `sprint fronts 1.4`.

## O reescopo (decisao de 2026-09-10)

O plano anterior tratava 009 como um sprint de **concorrencia**: rodar a matriz
sob carga multi-processo e comparar vereditos. Isso confundia duas perguntas
diferentes que a matriz varria ao mesmo tempo.

009 e sobre **equivalencia de objetos em multiplicidade de formatos**, nao sobre
concorrencia. O mesmo objeto, gravado em `dash` e em `jsonl`, por `append` e por
`merge`, tem que dar o **mesmo veredito**. Isso e uma propriedade do formato e da
formula da chave — e verificavel com **um processo so**.

### Onde esta o foco (correcao de 2026-09-10)

O titulo antigo dizia "paridade entre engines", e isso nomeava a metade errada do
eixo. O **sujeito** e a equivalencia entre FORMATOS: dash x jsonl, um reducer x
outro — as codificacoes que um caller e convidado a escolher, e que por isso nao
podem mudar os objetos.

A concordancia entre ENGINES e **verificacao colateral**, nao o objetivo. Ela vale
porque uma segunda implementacao independente e a checagem mais forte disponivel
de que a afirmacao sobre formato e mesmo sobre os DADOS, e nao sobre os habitos de
uma engine: se dash e jsonl so concordam dentro do io-engine, a concordancia pode
ser convencao dele. O nutshell — que compartilha a formula da chave e mais nada —
elimina essa hipotese. As celulas de engine sao evidencia A FAVOR da afirmacao de
formato.

A parte de concorrencia da matriz nao some: ela **migra para 011**, onde o eixo e
carga simultanea, nao formato. O que fica em 009 e o eixo de formato.

## Depende de: 1.5 (sprint 010)

**Nao comece antes.** Paridade so e verificavel depois que os dois lados criam
chave da mesma forma. Enquanto io-engine e nutshell alocam nome por caminhos
diferentes (um com `.index`, outro com `prefixSet` de closure reconstruido em
quatro pontos), um veredito divergente nao distingue "formatos diferentes" de
"alocadores diferentes". 1.5 entrega o alocador unico; 009 mede o formato por
cima dele.

## Passos

1. **Separar os eixos.** O `io-engine.matrix.test.js` varre hoje
   format/reduce/seed/close numa unica varredura que e ao mesmo tempo de formato
   e de carga. Dividir: as celulas de **formato** ficam em 009, single-process; as
   de **carga** saem para 011.

2. **Celulas de paridade, single-process.** Mesmo payload, mecanismos diferentes,
   vereditos comparados **entre si**: `dash` x `jsonl`, `append` x `merge`,
   io-engine x nutshell. A divergencia e o defeito; a taxa absoluta de qualquer um
   deles, isolada, nao afirma nada.

3. **Criterio binario.** `bad = 0`, sem limiar de tolerancia. *(Ja feito no
   working tree da sessao de 2026-09-10 — `check(bad <= Math.ceil(ran/2))` caiu.)*

4. **Limpar o residuo da "1.4 genesis atomico"** em `io-engine.matrix.test.js`.
   Aquela feature nunca existiu e o trabalho saiu na 4.3. *(Ja feito no mesmo
   working tree.)*

5. **`plans/1-core/1.4.eval.js`.**

## Migra para 011

O fence de TEMPO da celula no-seed e a carga de 8 processos por trial — ver
`io-engine.matrix.test.js:147-156`, onde a celula ja starvou suites vizinhas.
Concorrencia e o eixo de 011; 009 nao deve spawnar carga para afirmar formato.

## Criterio de pronto

Vereditos identicos entre formatos e entre engines para o mesmo objeto, com
`bad = 0` e sem limiar. Suite inteira verde. Verify:
`bun ../utest/utest.js io-engine.matrix.test.js --force`
