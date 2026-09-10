# Projeção Tabular e Hierárquica

## Dois Tipos de Projeção

É também importante considerar que nós temos dois tipos de projeção de hierarquias ou de tabelas de registros tipados. Ambos usam o mesmo mecanismo de projeção, mas o segundo é flat como uma tabela SQL e o primeiro é dinâmico em sua forma.

### Sim. Isso sugere que hierarquia e tabela não são dois mecanismos de storage

Eles são duas formas de interpretar a mesma projeção.

O mecanismo fundamental continua sendo:

```text
stream → projector → pages
```

e o que muda é o **modelo lógico projetado**.

---

## 1. Projeção dinâmica / hierárquica

A estrutura nasce dos próprios objetos:

```text
company
 ├── name
 ├── address
 │    ├── city
 │    └── country
 └── employees
      ├── ...
      └── ...
```

A forma não precisa ser conhecida antecipadamente.

Um patch pode inclusive introduzir novos campos:

```text
{ address: { city: "Curitiba" } }
```

e posteriormente:

```text
{ address: { zip: "80000-000" } }
```

A projeção vai adquirindo sua forma dinamicamente.

### 2. Projeção flat / tipada

Aqui existe um schema:

```text
users
────────────────────────
id
name
age
email
created
```

e a projeção física é essencialmente uma tabela:

```text
row → {
  name,
  age,
  email,
  created
}
```

Isso é muito mais próximo do modelo relacional.

Mas ambos podem usar exatamente o mesmo mecanismo:

```text
             STREAM
                │
                ▼
           projector
                │
        ┌───────┴───────┐
        ▼               ▼
    dynamic           typed
   projection        projection
        │               │
      pages           pages
```

---

## Implicações para os Índices

Porque o índice deve ser independente da forma da projeção.

Na forma flat:

```text
users.age
    ↓
30 → [row...]
31 → [row...]
```

Na forma dinâmica:

```text
people.address.city
    ↓
"Curitiba" → [object...]
"São Paulo" → [object...]
```

Ou seja, conceitualmente:

```text
Index(
    path,
    value
) → targets
```

e não:

```text
Index(table, column)
```

Isso permite que o mesmo mecanismo indexe:

```text
age
address.city
orders.status
orders.items.sku
```

sem precisar criar uma implementação específica para cada tipo de projeção.

---

## Ponto Central para o Desenho

**O índice deve indexar o modelo lógico da projeção, mas apontar para a identidade lógica do objeto, não para a representação física da página.**

Assim:

```text
dynamic:
path + value → target IDs

flat:
column + value → target IDs
```

são apenas duas manifestações do mesmo:

```text
(path, value) → PostingSet<targetId>
```

A diferença entre elas fica no **resolver do path/schema**, não no mecanismo do índice.

Isso preserva uma das propriedades mais interessantes da arquitetura: **Stream, Projection e Index podem evoluir separadamente sem transformar o storage em um banco relacional disfarçado.**
