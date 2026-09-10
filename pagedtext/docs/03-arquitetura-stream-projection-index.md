# Arquitetura: Stream, Projection e Index

## Estrutura Fundamental do IODB

IODB acontece sobre 3 arquivos: stream, projeção e índices.

Exato. E essa divisão deixa a arquitetura do IODB bem mais nítida:

```text
                 ┌──────────────┐
                 │    STREAM    │
                 │  truth/log   │
                 └──────┬───────┘
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
      ┌──────────────┐      ┌──────────────┐
      │  PROJECTION  │      │    INDEXES   │
      │ current state│      │ value → IDs  │
      └──────────────┘      └──────────────┘
```

### 1. Stream

É a fonte histórica e imutável:

```text
object
  ↓
patch
  ↓
patch
  ↓
patch
  ↓
...
```

Nada é apagado. O `target` encadeia os eventos.

O stream responde essencialmente:

> **O que aconteceu?**

---

### 2. Projection

É a materialização do estado atual.

As páginas:

```text
sparse → sparse → ... → crystal
```

são uma representação física otimizada da projeção.

O importante é que a projeção **não é a verdade**. Ela pode ser reconstruída a partir do stream.

Ela responde:

> **Qual é o objeto agora?**

---

### 3. Indexes

São materializações derivadas da projeção/stream:

```text
field value → target IDs
```

Por exemplo:

```text
age
30 → [T1, T7, T9]
31 → [T2, T4]
32 → [T3]
```

Respondem:

> **Quais objetos podem satisfazer esta consulta?**

E aqui vejo uma separação conceitual muito boa:

```text
STREAM     = history
PROJECTION = state
INDEX      = access path
```

Nenhum dos dois últimos precisa ser autoridade.

---

### E isso permite uma propriedade muito poderosa

Você pode perder completamente:

```text
projection
```

e reconstruí-la.

Pode perder:

```text
indexes
```

e reconstruí-los.

Mas enquanto o:

```text
stream
```

existir, o banco continua sendo recuperável.

Portanto:

```text
              STREAM
             /      \
            ↓        ↓
       projection   indexes
            │        │
            └── query┘
```

é quase uma arquitetura de **event sourcing + materialized views + secondary indexes**, mas com uma implementação física muito mais específica ao IODB.

E eu diria que **os três arquivos têm invariantes diferentes**:

| Arquivo | Mutabilidade | Função |
|---|---|---|
| Stream | append-only | verdade histórica |
| Projection | materializada | estado atual |
| Indexes | materializada | localização por valor |

Isso também sugere que a próxima questão para o desenho dos índices não é "qual árvore usar?", mas:

**qual é o formato mínimo de uma entrada de índice e qual algoritmo de reconstrução/compactação mantém esse arquivo pequeno e rápido?**

Aí o seu conceito de páginas cristalizadas provavelmente pode ser reaproveitado também nos índices.

---

## Páginas Cristalizadas vs. Esparsas

### Página esparsa

Enquanto existem slots vazios:

```text
page
┌─────┬─────┬─────┬─────┬─────┬─────┐
│ id  │ id  │  -  │ id  │  -  │ id  │
└─────┴─────┴─────┴─────┴─────┴─────┘
```

Cada linha precisa carregar seu ID, porque:

```text
row → id
```

não é implicitamente conhecido.

Quando a página fecha:

```text
┌─────┬─────┬─────┬─────┬─────┬─────┐
│ id  │ id  │ id  │ id  │ id  │ id  │
└─────┴─────┴─────┴─────┴─────┴─────┘
```

ela **cristaliza**.

O ID pode desaparecer porque:

```text
page + row → id
```

é determinado pela própria posição.

Então a representação passa de:

```text
[id, object]
[id, object]
[id, object]
```

para:

```text
[object]
[object]
[object]
```

Isso é uma compressão estrutural, não uma compressão de dados.

---

### E o inverso é particularmente interessante

Se uma linha de uma página cristalizada for removida:

```text
crystal
[ A ]
[ B ]
[ C ]
[ D ]
```

vira:

```text
sparse
[ A ]
[ B ]
[ - ]
[ D ]
```

Nesse momento a página precisa voltar a carregar IDs explícitos:

```text
[ id:A, A ]
[ id:B, B ]
[     -  ]
[ id:D, D ]
```

Ou seja:

```text
                full
                 │
                 ▼
             CRYSTALLIZE
                 │
                 ▼
             CRYSTAL
                 │
             delete
                 │
                 ▼
              SPARSE
                 │
              insert
                 │
                 ▼
                full
```

Isso cria uma propriedade muito boa:

> **O formato da página é determinado pelo seu grau de ocupação.**

Não existe uma estrutura separada para manter a localização lógica quando a página está cheia.

---

## E isso afeta diretamente os índices secundários

Aqui está a consequência que eu acho mais importante.

Em uma página cristalizada, o índice pode apontar para:

```text
page + row
```

e **não precisa armazenar o ID**.

Por exemplo:

```text
age = 30

[
  (page=17,row=3),
  (page=17,row=8),
  (page=23,row=1)
]
```

Quando a página é cristalizada:

```text
page 17 + row 3 → ID
```

é resolvido diretamente.

Mas quando ela volta a ser esparsa, você precisa preservar a identidade da linha:

```text
(page,row) → explicit ID
```

Isso sugere que o índice secundário deveria talvez trabalhar com uma abstração única:

```text
Address = page + row
```

e deixar a própria página resolver:

```text
Address → Object ID
```

Assim o índice não precisa saber se a página está cristalizada ou esparsa.

---

### Mais importante: isso pode tornar o índice extremamente barato

Considere:

```text
status = "active"
```

O índice pode ser:

```text
active → [
    17:3,
    17:8,
    23:1,
    23:7,
    ...
]
```

Se esses endereços forem ordenados, dá para compactá-los ainda mais:

```text
17:3
17:8
23:1
23:7
```

como uma sequência de inteiros delta-encoded.

E quando uma página cristaliza, **nenhuma atualização no índice é necessária**, porque o endereço continua sendo o mesmo.

Isso é uma propriedade excelente.

Apenas a representação interna da página muda:

```text
sparse:
address → explicit ID → object

crystal:
address → implicit ID → object
```

O índice continua vendo:

```text
address → object
```

Essa separação — **índice aponta para endereço, página resolve identidade** — me parece ser uma das ideias centrais do IODB.

---

## Patch Chains e Append-Only

### Não há deleção de linhas

O banco é append only. Um objeto deletado recebe um patch atribuindo nullo ao hash ou outra maneira de deprecação. Uma página cristalizada o é pra sempre. Mas seus objetos continuam mutáveis com patches. Lembre que o id de um objeto carrega o id de seu target no seu próprio id por xor eu hash do seu conteúdo com o id do target.

### Exato. Isso muda a conclusão anterior de forma importante

Cristalização é **monotônica**. Uma página nunca volta a esparsa, porque não existe remoção física de linhas.

E o detalhe do ID é fundamental. O objeto não tem simplesmente um `id` arbitrário; o ID carrega a relação com seu target:

```text
objectId = hash(content) XOR targetId
```

ou, equivalentemente, o `targetId` pode ser recuperado a partir do ID + hash apropriado.

Então temos três conceitos diferentes:

```text
              logical object
                    │
                    ▼
             target identity
                    │
                    ▼
             object/version
                    │
                    ▼
             physical address
```

### Os patches formam uma cadeia linear

Os patches de um objeto não criam branches eles são sequenciais e formam uma lista onde cada patch tem como target o patch anterior até chegar no objeto.

```text
Object
  ↑
Patch 1
  ↑
Patch 2
  ↑
Patch 3
  ↑
Patch 4
```

Cada nó aponta para o anterior:

```text
target(Patch₄) = ID(Patch₃)
target(Patch₃) = ID(Patch₂)
target(Patch₂) = ID(Patch₁)
target(Patch₁) = ID(Object)
```

E o ID de cada elemento é derivado do conteúdo + target:

```text
id₁ = hash(content₁) XOR target₀
id₂ = hash(patch₁)   XOR id₁
id₃ = hash(patch₂)   XOR id₂
...
```

Isso significa que a cadeia é simultaneamente:

- **append-only**
- **linear**
- **endereçável**
- **verificável**
- **imutável historicamente**

O estado atual é simplesmente o resultado de aplicar a cadeia:

```text
Object → P₁ → P₂ → P₃ → P₄
                         ↓
                       state
```

---

## Implicações para os Índices

Um índice de campo não deveria necessariamente apontar para cada patch.

Se temos:

```json
{
  "name": "Alice",
  "age": 30
}
```

depois:

```json
{ "age": 31 }
```

o índice lógico deve enxergar:

```text
age = 31 → targetId
```

e não deixar:

```text
age = 30 → targetId
```

como resultado atual.

Mas há uma consequência muito interessante: **o índice também pode ser append-only**.

Você pode registrar:

```text
+ age=30 → target T
```

e depois:

```text
- age=30 → target T
+ age=31 → target T
```

sem modificar fisicamente o índice anterior.

A consulta resolve os deltas até chegar ao estado consolidado.

Então o mesmo princípio do IODB pode se repetir em todas as camadas:

```text
              APPEND ONLY
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
    objects     patches    indexes
       │          │          │
       └──────────┴──────────┘
              immutable
               history
```

E a **cristalização** pode ser entendida como um mecanismo de materialização:

```text
sparse page
     ↓
append
     ↓
full
     ↓
CRYSTAL
     ↓
posição = identidade física
```

Sem nunca precisar reescrever o passado.

Isso me parece uma característica arquitetural central do IODB: **o estado atual é uma projeção de uma estrutura histórica append-only**, enquanto as cristalizações e índices são apenas materializações eficientes dessa história.
