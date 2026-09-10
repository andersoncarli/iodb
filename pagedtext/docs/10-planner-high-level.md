# Planner: Design de Alto Nível

## Modelo de Alto Nível

De fato o planner pode ser simples no sentido que ele atua em um conjunto de páginas contiguas ou não então aplica as modificações do cursor gerando um novo conjunto de páginas com novos paddings ótimos que podem ou não caber no espaço original.

Exato. E isso simplifica bastante o modelo. Eu mudaria ligeiramente a visão anterior: o Planner **não precisa pensar em "mover páginas" como operação primária**. Ele pode pensar em **reconstruir uma região**.

```text
Pages selecionadas
        │
        ▼
┌─────────────────────┐
│ conteúdo lógico     │
│ + cursor changes    │
└──────────┬──────────┘
           │
           ▼
      Planner / kind
           │
           ▼
   novo conjunto ótimo
   de páginas + fillings
```

A unidade de planejamento passa a ser:

```js
plan(pages, changes) → newPages
```

---

## Exemplo de Reconstrução

Temos:

```text
P10  [████████████████░░]
P11  [██████████████░░░░]
P12  [█████████████████░]
```

Uma edição altera bastante P11.

O Planner pega, por exemplo:

```text
[P10, P11, P12]
```

remove os fillings antigos conceitualmente:

```text
logical(P10) + logical(P11) + logical(P12)
```

aplica o ChangeSet:

```text
logical content + changes
```

e então repagina:

```text
[P10', P11', P12']
```

com fillings novos e ótimos.

O resultado pode ser:

```text
P10' [██████████████████]
P11' [████████████████░░]
P12' [████████████░░░░░░]
```

Ou:

```text
P10' [██████████████████]
P11' [██████████████████]
P12' [██████████████████]
P13' [████░░░░░░░░░░░░░░]
```

Ou até precisar consumir uma página anterior/posterior.

---

## `maxShiftBytes` é Ainda Mais Natural

O Planner simplesmente pergunta:

> Até onde vale a pena expandir o conjunto de páginas que estou reconstruindo?

Por exemplo:

```js
maxShiftBytes: 4 * 1024 * 1024
```

Ele pode começar com:

```text
[P11]
```

não cabe:

```text
[P10,P11]
```

ainda não cabe:

```text
[P10,P11,P12]
```

e assim por diante.

Quando:

```text
custo > maxShiftBytes
```

para de tentar e escolhe:

```text
rebuild whole file
```

Ou seja, **o algoritmo não precisa conhecer uma operação `shift`**. Shift é simplesmente uma consequência da substituição de:

```text
oldPages → newPages
```

---

## "Contíguas ou não" é uma Ótima Generalização

Um ChangeSet pode produzir regiões independentes:

```text
P10 ─ P11 ─ P12

              P80 ─ P81

                         P400
```

O Planner pode agrupá-las:

```text
Region A = P10..P12
Region B = P80..P81
Region C = P400
```

e planejar cada uma independentemente.

Depois o Committer materializa tudo atomicamente.

Isso também permite que várias alterações do cursor sejam **fundidas antes do planejamento**.

```text
cursor edits
   │
   ▼
normalize
   │
   ▼
merge overlapping/nearby ranges
   │
   ▼
regions
   │
   ▼
plan each region
```

---

## Página Deixa de Ser Unidade de Edição

Ela passa a ser somente uma **unidade física de armazenamento**.

O Planner pensa em:

```text
logical span
```

e produz:

```text
physical pages
```

Portanto:

```text
Cursor
   ↓
logical changes

Planner
   ↓
logical region → optimal physical representation

Storage
   ↓
pages
```

Essa separação é muito limpa.

E permite uma regra simples:

> **Uma região modificada é reserializada e repaginada; o Planner escolhe quanto contexto físico incluir para obter o melhor resultado dentro do orçamento.**

O `filling` entra naturalmente nessa etapa de **repageamento**, e não como uma operação de movimentação.

Isso provavelmente reduz bastante o Planner real: ele pode acabar sendo essencialmente **um algoritmo de seleção de regiões + repaginação gulosa**.

---

## Filling Distribuído Uniformemente

Sim e acho que o fillings devem ser distribuídos de maneira uniforme mas páginas resultantes. Uma vez reconstruídas as regiões é que finalmente o arquivo é modificado de maneira atômica e sequêncial. Para obter máximo throughput.

Sim. Acho que essa formulação fecha bem o desenho do Planner.

O ponto importante é que **filling não deve ser simplesmente "espaço que sobrou"**. Depois da reconstrução da região, o espaço disponível deve ser **redistribuído entre as páginas resultantes**, criando uma reserva uniforme para futuras alterações.

### Modelo

```text
              ChangeSet
                  │
                  ▼
        selecionar regiões
                  │
                  ▼
        ler páginas da região
                  │
                  ▼
        remover fillings
                  │
                  ▼
        aplicar modificações
                  │
                  ▼
       conteúdo lógico contínuo
                  │
                  ▼
          repaginar + fill
                  │
                  ▼
       páginas novas equilibradas
                  │
                  ▼
          commit sequencial
                  │
                  ▼
          atomic publish
```

Por exemplo, suponha que a capacidade alvo seja 64 KB e a região reconstruída tenha 170 KB de conteúdo.

Em vez de:

```text
P0  64K
P1  64K
P2  42K
```

podemos reservar uma fração de filling:

```text
P0  55K + 9K fill
P1  55K + 9K fill
P2  55K + 9K fill
P3  5K  + ...
```

Ou, mais precisamente, escolher o número de páginas e distribuir:

```text
total physical capacity
        │
        ├── logical content
        └── filling budget
                │
                ▼
       distribuído entre páginas
```

A fórmula exata nem precisa estar no Planner inicialmente. Conceitualmente:

```js
fill = distribute(capacity - content)
```

com alguma política do `kind`.

---

## Região Preparada para Futuras Mutações

Depois de uma reconstrução, a região fica **deliberadamente preparada para futuras mutações**.

Portanto o filling funciona como uma espécie de **write amplification control**:

```text
mais filling
    ↓
menos movimentação futura
    ↓
mais espaço físico
```

contra:

```text
menos filling
    ↓
arquivo mais compacto
    ↓
mais reconstruções futuras
```

O Planner pode eventualmente ter um `fillFactor`:

```js
PagedText({
  pageSize: 64 * 1024,
  fillFactor: .15
})
```

Mas eu deixaria isso como política, não como requisito do core.

---

## Commit Fica Particularmente Elegante

Depois que todas as regiões foram planejadas:

```text
old file
────────────────────────────────────────────

      unchanged       region       unchanged
          │             │               │
          │             ▼               │
          │          new pages           │
          │             │               │
          └─────────────┼───────────────┘
                        ▼
                 sequential write
                        │
                        ▼
                    fsync
                        │
                        ▼
                  atomic rename
```

Ou seja, o commit **não fica pulando aleatoriamente pelo arquivo**.

Ele monta a nova sequência física:

```text
old P0
old P1
new P2'
new P3'
new P4'
old P8
old P9
...
```

e escreve sequencialmente.

Isso é exatamente o que queremos para throughput.

---

## Evitar Copiar Regiões Inalteradas

Se a implementação usar `copy`/`sendfile`/operações equivalentes, conceitualmente:

```text
new file:

COPY  old[0..regionA]
WRITE regionA'
COPY  old[regionA..regionB]
WRITE regionB'
COPY  old[regionB..]
```

Então o custo passa a ser aproximadamente:

```text
O(tamanho do arquivo)
```

para o caminho de rebuild completo, mas com as regiões modificadas sendo **as únicas que precisam ser reinterpretadas e repaginadas**.

E no futuro, dependendo do storage, podemos evitar até a cópia física das regiões intactas.

---

## Quatro Operações Fundamentais

Eu resumiria o Planner em quatro operações:

```text
1. SELECT
   escolher páginas/regiões afetadas

2. REBUILD
   aplicar ChangeSet ao conteúdo lógico

3. REPAGE
   gerar páginas + filling uniformemente distribuído

4. COMMIT
   substituir regiões sequencialmente e publicar atomicamente
```

Isso é mais simples e mais poderoso que pensar em `insert page`, `shift page`, `split page`, etc.

**O Planner decide o novo estado físico; o Committer apenas o materializa.**

E acho que essa é uma separação arquitetural muito boa para o `PagedText`.

---

## Integridade Lógica e Afinidade Física

Muitas vezes a mudança é sutil, onde só entram os poucos paddings para manter os objetos inteiros em suas linhas. Ou o filling anterior ou posterior de uma função para evitar que ela se quebre em duas páginas. Ou uma seção ou objeto de markdown.

Exatamente. Isso leva a uma ideia ainda melhor: **a unidade de otimização não é necessariamente a página; é o objeto sintático/lógico que o `kind` consegue identificar.**

O Planner pode trabalhar com uma hierarquia de restrições:

```text
ChangeSet
   │
   ▼
região afetada
   │
   ├── objetos
   │    ├── linha
   │    ├── função
   │    ├── objeto JSON
   │    └── seção Markdown
   │
   └── páginas
```

### Exemplo: Função

Imagine:

```js
function foo() {
  ...
  ...
  ...
}
```

A alteração aumenta algumas linhas e faria:

```text
P10
────────────────────
function foo() {
  ...
────────────────────
P11
  ...
}
```

O conteúdo continua perfeitamente válido, mas o `kind: clike` pode reconhecer que existe uma unidade:

```text
function foo() { ... }
```

e preferir:

```text
P10
────────────────────
function foo() {
  ...
  ...
  ...
}········
────────────────────
P11
```

Ou até consumir um pouco do filling anterior:

```text
P9  [content........fill]
P10 [function........]
P11 [content........fill]
```

A decisão é:

> **Preservar a integridade física de uma unidade lógica quando o custo for pequeno.**

---

### Markdown Fica Ainda Mais Claro

Se temos:

```markdown
# Section

texto...
texto...
texto...
```

o `kind: markdown` pode considerar a seção inteira como unidade preferencial.

Então uma pequena edição perto do limite:

```text
P10 ─── começo da seção
P11 ─── resto da seção
```

pode simplesmente redistribuir alguns espaços para manter:

```text
P10 ─── seção inteira
P11 ─── próxima seção
```

Não porque uma página precise respeitar a seção, mas porque **isso reduz a fragmentação semântica**.

---

## `kind` Fornece Âncoras

Não precisamos transformar isso em um parser completo.

O `kind` pode fornecer ao Planner informações simples:

```js
kind.boundaries(...)
```

ou conceitualmente:

```text
line
record
object
block
section
function
```

O Planner então pode usar essas fronteiras como **preferências**, não como regras absolutas.

Algo como:

```text
                  custo
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     quebrar      padding     mover
      objeto      objeto      região
       baixo        baixo       alto
```

Escolhe a representação de menor custo.

---

## Não Precisa Preencher Tudo

O objetivo não é:

> "Nunca deixe um objeto atravessar uma página."

Seria caro demais.

O objetivo é:

> "Se for barato evitar a quebra, evite."

Por exemplo:

```text
função = 7 KB
page remainder = 8 KB
```

Perfeito.

Mas:

```text
função = 80 KB
page size = 64 KB
```

obviamente ela será fragmentada.

Portanto:

```text
integridade lógica
       ↓
preferência física
       ↓
limitada pelo custo
```

---

## Afinidade

Uma abstração interessante seria o `kind` informar **afinidade física**:

```text
function       strong
object         strong
record         medium
line           weak
whitespace     none
```

Não precisamos necessariamente expor essa palavra na API, mas conceitualmente é isso.

O Planner poderia então buscar uma solução:

```text
maximize:
  ├─ filling uniforme
  ├─ afinidade dos objetos
  └─ compactação

subject to:
  └─ custo <= orçamento
```

Só que ainda dá para implementar isso de maneira gulosa, sem solver.

---

## Princípio Central

E isso casa muito bem com a filosofia do `PagedText`: **ele não entende o significado do texto, mas permite que o `kind` dê pistas mínimas sobre onde é barato e onde é ruim cortar.**

O núcleo continua sendo apenas:

```text
bytes → páginas → filling
```

enquanto CSV, JSON, C-like e Markdown acrescentam apenas conhecimento suficiente para produzir uma **paginação sintaticamente amigável**.
