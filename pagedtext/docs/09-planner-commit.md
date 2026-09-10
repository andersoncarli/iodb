# Planner de Commit e Estratégias

## Estratégias de Commit

Acho que double buffer com renane parece a coisa mais natural para deslocamentos e modificações muito grandes mas de forma pontual o sistema deve tentar utilizar os fillings das páginas vizinhas até assentar. Com um limite. Assim a modificação pode ser atômica e paginada com escrita local ou um deslocamento até o fim do arquivo a engine deve buscar o caminho mais rápido de menor impacto.

Sim. Isso leva a um modelo melhor que simplesmente "reconstruir as páginas afetadas": **o commit é um planejador de movimentação**, e escolhe entre propagação local e double-buffer.

Eu colocaria três estratégias:

```text
                 mutation
                    │
             estimate impact
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
    local        bounded       rebuild
   settling      shift         + rename
```

### 1. Local settling — caminho preferencial

Se uma alteração deixa uma página com espaço:

```text
P10 ██████████████████
P11 ██████████████····
P12 ██████████████████
```

a engine tenta absorver a diferença nos vizinhos:

```text
P10 ██████████████████
P11 ██████████████████
P12 ███████████████···
```

Ou no sentido contrário:

```text
P10 █████████████·····
P11 ██████████████████
```

Ela pode caminhar:

```text
P11 → P12 → P13 → P14 → ...
```

até o espaço necessário ser absorvido.

**Importante:** existe um limite.

```js
maxShift: 32 // páginas
```

ou talvez melhor:

```js
maxShiftBytes: 8 * 1024 * 1024
```

Assim uma alteração local não vira acidentalmente uma operação de 10 GB.

---

### 2. Bounded shift

Quando não consegue assentar localmente dentro do orçamento:

```text
edit
 ↓
P100
 ↓
P101
 ↓
...
 ↓
P132
 ↓
STOP
```

a engine abandona a estratégia local.

Isso é importante porque **o custo de descobrir que não vale a pena deve ser limitado**.

Ela então pode escolher:

```text
local shift
    ↓
   too expensive
    ↓
double buffer
```

---

### 3. Double buffer

Para uma alteração grande ou que deslocaria uma grande região:

```text
old
──────────────────────────────
P0 P1 P2 ... P999999
```

gera:

```text
new.tmp
──────────────────────────────
P0 P1 P2 ... altered ... P999999
```

Depois:

```text
fsync(new.tmp)
       ↓
rename(old → backup)
rename(new.tmp → old)
```

A publicação continua atômica.

E o arquivo original fica intacto até o novo estado estar pronto.

---

## Otimização de Regiões Inalteradas

O double-buffer não precisa necessariamente copiar **tudo**.

Podemos pensar no arquivo como:

```text
[ unchanged ][ affected ][ unchanged ]
```

e construir:

```text
new =
    unchanged prefix
    + new pages
    + unchanged suffix
```

Dependendo do filesystem/estratégia, isso ainda pode exigir cópia física, mas conceitualmente o planner já sabe que apenas o intervalo lógico afetado mudou.

Isso deixa aberta uma evolução futura para técnicas de *copy-on-write* mais eficientes.

---

## Filling como Liquidez de Página

Essa é uma propriedade particularmente boa do seu desenho.

Uma página não precisa estar exatamente cheia.

```text
P10 █████████████████
P11 ███████████······
P12 ████████████████
```

O espaço vazio é **capacidade disponível para futuras mutações**.

Então o commit pode pensar:

```text
quanto espaço tenho à esquerda?
quanto espaço tenho à direita?
quanto preciso?
qual direção custa menos?
```

Por exemplo:

```text
             +20 KB
               │
        ┌──────┴──────┐
        ▼             ▼
 esquerda           direita
  3 pages            17 pages
        │
        └──► escolhe esquerda
```

Isso é quase um **algoritmo de acomodação local**, não simplesmente "editar arquivo".

---

## E isso Combina Perfeitamente com o Cursor

O cursor produz apenas a alteração lógica:

```js
c.seek(10_000_000)
c.insert(data)
c.commit()
```

O cursor **não sabe como a alteração será materializada**.

O planner recebe algo como:

```text
[10_000_000, +37 KB]
```

e decide:

```text
37 KB
 │
 ├─ P123 tem 8 KB
 ├─ P124 tem 12 KB
 ├─ P125 tem 21 KB
 └─ suficiente
```

ou:

```text
37 KB
 │
 ├─ local budget = 8 MB
 ├─ deslocamento estimado = 200 MB
 └─ double buffer
```

### Portanto a Arquitetura Começa a Ficar Muito Clara

```text
Proxy
  │
  ▼
Cursor
  │
  ▼
ChangeSet
  │
  ▼
Commit Planner
  │
  ├── local settle
  │
  ├── bounded shift
  │
  └── double buffer
  │
  ▼
Atomic Commit
  │
  ▼
PagedText
```

E eu acho que **essa é a abstração certa para não transformar `PagedText` em um database**.

Ele não sabe o que é registro, objeto, índice ou schema.

Ele só sabe:

> **Tenho um texto lógico editável, dividido fisicamente em páginas, com capacidade residual (filling), e preciso materializar uma mudança atomicamente pelo caminho de menor impacto dentro de um orçamento.**

Isso é uma primitive bastante geral — e IODB pode simplesmente aproveitar essa primitive depois.

---

## Cursor Salvo Separadamente

E o cursor pode ser salvo separadamente como estado intermediário. Assim um arquivo modificado e não salvo pode ser salvo mantendo o arquivo original intacto. O flush de um cursor é a única operação de escrita real da engine.

Sim — e isso simplifica bastante a semântica de persistência. O **arquivo e o estado de edição passam a ser dois artefatos distintos**.

```text
              PagedText
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
   source file          cursor state
   estado salvo         estado pendente
```

O cursor pode ser serializado:

```js
const c = text.cursor()

c.seek(10000)
c.insert('abc')
c.delete(20)

c.save()
```

Isso salva apenas o **estado intermediário**, não o arquivo.

Depois:

```js
const c = text.cursor.load()
```

e continuamos exatamente dali.

### A Semântica Fica Muito Limpa

```text
read()
   │
   ▼
PagedText ──────────────── original
   │
   ▼
Cursor
   │
   ├── edits
   ├── position
   └── state
          │
          ├── save() ──► cursor state
          │
          └── flush() ─► PagedText
```

E eu faria uma distinção importante:

```js
cursor.save()
```

**não é uma operação de escrita do `PagedText`**. É persistência do *working state*.

Enquanto:

```js
cursor.flush()
```

é o único ponto em que o arquivo fonte pode mudar.

---

### Propriedade Excelente

Imagine um editor:

```js
const file = PagedText('./huge.js', { kind: 'clike' })
const cursor = file.cursor()

// usuário trabalha por horas...

cursor.save()
```

Se o processo morrer:

```text
huge.js
  ↓
continua exatamente como estava

huge.js.cursor
  ↓
contém as alterações pendentes
```

Ao reabrir:

```js
const cursor = file.cursor.load()
```

E o editor recupera o trabalho.

Isso é quase um **journal de edição**, mas sem transformar o `PagedText` em banco.

---

## `flush()` Vira uma Fronteira Muito Forte

Eu estabeleceria como invariável:

> **Somente `flush()` pode modificar o arquivo fonte.**

Então todas estas operações são puramente lógicas:

```js
text[10]

cursor.seek(100)
cursor.insert(x)
cursor.delete(20)
cursor.replace(a, b, x)

cursor.save()
cursor.rollback()
```

Somente:

```js
cursor.flush()
```

entra no mundo físico.

E `flush()` deve ser:

```text
Cursor state
     │
     ▼
plan
     │
     ├── local settle
     ├── bounded shift
     └── double buffer
     │
     ▼
atomic commit
     │
     ▼
source file
```

Se falhar:

```text
source = unchanged
cursor = unchanged
```

Ou seja, **falha não pode destruir nem o estado anterior nem o estado pendente**.

---

### API Muito Bonita

```js
const file = PagedText('./huge.log', { kind: 'clike' })

const edit = file.cursor()

edit.seek(1_000_000)
edit.insert('hello')

edit.save()       // persiste o trabalho
edit.flush()      // publica no arquivo
```

Ou simplesmente:

```js
file.edit(c => {
  c.seek(1000)
  c.insert('foo')

  c.seek(2000)
  c.delete(50)
})
```

onde `edit()` pode significar:

```text
callback
   │
   ▼
cursor
   │
   ▼
flush()
```

enquanto uma versão como:

```js
file.edit(c, { autoFlush: false })
```

deixa o estado pendente.

Mas eu manteria **`flush()` como a única palavra mágica**. É uma ótima fronteira conceitual:

```text
              READ
               ↑
               │
       ┌───────┴───────┐
       │    Cursor     │
       │   save/edit   │
       └───────┬───────┘
               │
            flush()
               │
               ▼
             WRITE
```

Isso também prepara muito bem o terreno para IODB depois: uma operação complexa pode construir seu estado lógico inteiro em cursores e só materializar a mudança quando fizer `flush()`.
