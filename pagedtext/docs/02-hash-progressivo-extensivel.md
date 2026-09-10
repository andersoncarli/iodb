# Hash Progressivo e Extensível

## Contexto: IODB e o Crescimento de Níveis

IODB tem uma peculiariedade: ele cresce dobrando o seu tamanho quando um hash não pode ser encontrado no nível binário atual. É o que se chama de **hash progressivo**. Ele começa com 2 bits de chave (sendo o nível 0 reservado) e 4 slots. Cada objeto ganha uma chave dentro ou abaixo do nível atual, e seu hash é modulado de acordo. Quando um objeto não encontra um slot disponível em nenhum nível ele dispara o crescimento de um novo nível binário que pode ser paginado a partir de certo nível.

## Response

Sim — isso muda bastante o desenho do índice, e na verdade torna o seu modelo mais interessante.

O que você descreve é essencialmente uma **tabela hash extensível por níveis**, mas com uma propriedade importante: o espaço de endereçamento cresce progressivamente com o hash, em vez de reconstruir toda a tabela.

Se entendi corretamente:

```text
nível 0       reservado
nível 1       2 bits → 4 slots
nível 2       4 bits → 16 slots
nível 3       6 bits → 64 slots
nível 4       8 bits → 256 slots
...
```

e um objeto possui uma posição determinada pelos bits do hash:

```text
hash
 ↓
110101001011...
 ^^
 nível 1

110101001011...
 ^^^^
 nível 2

110101001011...
 ^^^^^^
 nível 3
```

O ponto fundamental é que **o nível não é apenas uma camada de armazenamento: ele faz parte do endereço lógico do objeto**.

### Isso sugere uma coisa importante para os índices

Você provavelmente **não precisa armazenar o hash/ID completo no índice secundário**.

Se o índice encontrar:

```text
age = 30
    ↓
[slot, slot, slot, slot]
```

o próprio slot pode ser suficiente para localizar o objeto:

```text
(level, slot) → hash/object
```

Ou até um endereço compacto:

```text
address = level << N | slot
```

Então o índice de valor poderia ser:

```text
30 → [A12, A19, A37]
31 → [A04, A55]
32 → [A08]
```

onde `A12` é um **object address**, não necessariamente um hash.

---

## E tem uma consequência ainda mais interessante

Seu crescimento:

```text
4
↓
16
↓
64
↓
256
↓
1024
...
```

é extremamente amigável para arrays.

Você pode pensar no espaço global como:

```text
level 1:  [0 ... 3]
level 2:  [4 ... 19]
level 3:  [20 ... 83]
level 4:  [84 ... 339]
...
```

Ou seja, cada nível pode ter um **offset determinístico**.

Se `2^(2L)` é o número de slots do nível `L`, então o total anterior aos níveis até `L-1` é uma soma geométrica.

Isso permite transformar:

```text
(level, slot)
```

em um **ID ordinal global** sem uma tabela de tradução.

Esse ID é perfeito para os índices secundários.

---

# Índice secundário poderia ser literalmente

```text
value → sorted array<objectId>
```

Exemplo:

```text
age
30 → [12, 18, 21, 47]
31 → [7, 9]
32 → [4, 11, 13]
```

E:

```text
objectId → (level, slot)
```

pode ser calculado diretamente.

Então você tem:

```text
             ┌──────────────┐
             │ secondary    │
             │ index        │
             └──────┬───────┘
                    │
              value → IDs
                    │
                    ▼
             ┌──────────────┐
             │ progressive  │
             │ hash         │
             └──────┬───────┘
                    │
             level + slot
                    │
                    ▼
             ┌──────────────┐
             │ object       │
             └──────────────┘
```

Isso é uma arquitetura muito limpa.

### E resolve uma questão que você levantou antes

Você perguntou se:

> "um índice de valor é meramente o valor discreto e um array dos ids dos objetos que contém aquele valor."

**No seu caso, eu diria que sim.**

E mais: o seu hash progressivo fornece um tipo de ID natural, compacto e estável para esses arrays.

A única questão que eu investigaria com cuidado é **o que acontece com o endereço de um objeto quando um novo nível é criado**.

Se:

```text
(level, slot)
```

é permanente, excelente.

Se o crescimento puder mover objetos para novos slots, então o índice secundário precisa apontar para algo estável — e aí talvez valha separar:

```text
objectId → current address
```

dos índices secundários.

Mas se seu algoritmo garante que **um objeto uma vez colocado mantém sua chave/endereço**, então você tem uma propriedade muito valiosa: os posting lists dos índices secundários podem ser persistidos praticamente como arrays de inteiros e só sofrer `append`/tombstone.

Isso combina **muito bem** com o IODB.

---

## Crescimento Binário de um Bit por Nível

De fato o nível cresce 1 bit de cada vez. E com isso o storage dobra em sua capacidade virtual mas o armazenamento permanece compacto porque é organizado em páginas.

### Exato

Isso deixa o modelo ainda mais interessante. O crescimento não é `2 → 4 → 6 bits`; no seu caso é **um bit adicional por nível**:

```text
level 0: reservado
level 1: 2 bits →   4 slots
level 2: 3 bits →   8 slots
level 3: 4 bits →  16 slots
level 4: 5 bits →  32 slots
...
```

Portanto, cada novo nível **dobra o espaço virtual**, enquanto as páginas físicas só existem conforme necessário.

A distinção importante é:

```text
             endereço lógico
                    │
          hash → prefixo de N bits
                    │
                    ▼
        ┌─────────────────────┐
        │ progressive index   │
        └─────────────────────┘
                    │
              página + slot
                    │
                    ▼
             armazenamento
```

### Isso muda minha avaliação do índice secundário

Eu evitaria colocar uma B-tree tradicional imediatamente.

O seu storage já possui uma estrutura de **address space hierárquico**. O índice secundário pode ser simplesmente uma estrutura paralela:

```text
index[field]
    │
    ├── value A → [object-id...]
    ├── value B → [object-id...]
    └── value C → [object-id...]
```

E esses `object-id` podem ser extremamente compactos.

Mais interessante ainda: como o crescimento do espaço primário é incremental e paginado, o índice secundário também pode adotar o mesmo princípio:

```text
value
  ↓
posting list
  ↓
pages
```

Por exemplo:

```text
"active"
    ↓
page 17 → [12, 19, 24, 31, ...]
page 18 → [105, 109, 112, ...]
```

Sem precisar alocar um array gigantesco antecipadamente.

### Há uma simetria bonita aqui

O storage principal faz:

```text
hash → address
```

enquanto o índice de valor faz:

```text
value → addresses
```

Ou seja:

```text
              ┌──────────────┐
hash ────────►│              │
              │    IODB      │──► object
value ───────►│              │
              │              │
              └──────────────┘
```

A diferença é que o hash produz **um endereço**, enquanto o valor produz **um conjunto de endereços**.

Isso sugere que o primitivo fundamental do seu índice talvez nem devesse ser chamado de "índice". É mais precisamente uma:

**`Value → PostingSet<Address>`**

E `PostingSet` pode ter várias implementações conforme cardinalidade:

```text
1 elemento       → scalar
poucos            → sorted array
muitos            → paged sorted array
muito denso       → bitmap
```

Isso preservaria a filosofia do IODB: **estruturas simples, compactas e paginadas, crescendo apenas quando necessário**, em vez de introduzir uma árvore complexa onde ela não é necessária.
