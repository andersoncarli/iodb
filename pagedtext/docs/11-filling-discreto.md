# Filling: Discreto e Semântico

## Princípio Central do Filling

De fato basicamente os fillings devem ser vistos como espaços realmente só necessários para alinhar a página e por isso é por padrão discreto.

Sim. Eu colocaria isso como um princípio central do `PagedText`:

> **Filling não é armazenamento de dados; é espaço físico reservado para manter a paginação.**

Por isso o comportamento padrão deve ser **discreto**: se você abrir o arquivo com qualquer editor, parser, compilador ou ferramenta Unix, o filling deve parecer, na melhor hipótese, apenas espaço em branco irrelevante.

```text
logical text
────────────────────────────
page boundary
        ↓
physical text
────────────────────────────
content····················
content
content········
```

Os `·` não têm significado lógico.

---

## Implicação para o Planner

O Planner não deveria pensar:

```text
"preciso adicionar 2 KB de filling"
```

mas:

```text
"preciso que esta região tenha esta capacidade física"
```

E o `kind` resolve essa capacidade da forma menos intrusiva possível.

```text
                Planner
                   │
             precisa de N bytes
                   │
                   ▼
                 kind
                   │
          ┌────────┴────────┐
          ▼                 ▼
         ws              comment
      espaços          //- filling
       discreto          explícito
```

`ws` é portanto o **default universal**.

`comment` é uma ferramenta opcional para tornar a instrumentação observável:

```js
PagedText({
  path,
  kind: 'clike',
  filling: 'comment'
})
```

Isso é especialmente útil para debugging, inspeção e eventualmente desenvolvimento do próprio `PagedText`.

---

## Discreto Não Significa Invisível

Ele pode ser perfeitamente detectável pelo `PagedText`.

Por exemplo, fisicamente:

```text
foo()

bar()
```

O leitor normal vê:

```text
foo()

bar()
```

O `PagedText` sabe:

```text
content: foo()
filling: 17 bytes
content: bar()
```

Ou seja, **o filling pertence à representação física, não à representação semântica**.

Isso reforça uma separação que acho fundamental:

```text
                 PagedText
                    │
          ┌─────────┴─────────┐
          │                   │
       logical             physical
          │                   │
       content             content
                              +
                           filling
```

E o Planner é justamente o componente que mantém essas duas representações sincronizadas.

Acho que isso deixa o conceito bem elegante: **PagedText instrumenta um texto existente com capacidade física, mas tenta permanecer semanticamente inexistente.**

---

## Objetivo Fundamental

De fato o objetivo de PagedText é alinhar qualquer arquivo texto em páginas com mínimo impacto semântico.

Exatamente. Essa é provavelmente a definição mais precisa do `PagedText` até agora:

> **`PagedText` transforma um arquivo texto contínuo em uma sequência de páginas físicas, com o mínimo impacto semântico possível.**

E isso muda um pouco a forma de pensar o sistema: **paginação é uma propriedade física; semântica é preservada.**

```text
             qualquer texto
                   │
                   ▼
             ┌───────────┐
             │ PagedText │
             └─────┬─────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
    representação          representação
      lógica                  física
        │                     │
     conteúdo            páginas + filling
                              │
                       mínimo impacto
                         semântico
```

O `kind` então não define o arquivo. Ele apenas ajuda o `PagedText` a responder:

> **"Onde posso colocar capacidade extra sem incomodar este formato?"**

Isso explica naturalmente os diferentes casos:

- **texto/log:** espaços;
- **C/JS:** espaços ou comentários;
- **CSV:** espaços nos pontos onde o parser tolera;
- **JSON:** whitespace onde permitido pela gramática;
- **Markdown:** espaços/newlines em regiões semanticamente neutras;
- eventualmente outros formatos com seus próprios mecanismos.

---

## Quanto Mais Inteligente o `kind`, Menor o Impacto

O core não precisa entender:

```text
função
objeto
registro
seção
campo
bloco
```

Ele só precisa de uma estratégia que produza:

```text
logical text
      ↓
physical representation
      ↓
pages
```

com uma função de custo aproximadamente:

```text
cost =
    bytes modificados
  + bytes deslocados
  + impacto semântico
  + fragmentação indesejada
```

Na prática, o primeiro protótipo pode nem quantificar tudo isso. Basta ter prioridades:

```text
1. preservar semântica
2. manter objetos inteiros quando barato
3. distribuir filling
4. minimizar bytes movimentados
5. manter páginas aproximadamente equilibradas
```

E isso também explica por que **não precisamos de um formato de arquivo proprietário**.

Um `.js`, `.csv`, `.json`, `.md` ou `.log` continua sendo um arquivo normal. O `PagedText` apenas aproveita espaços semanticamente neutros para criar uma **estrutura física paginada sobre ele**.

Essa é uma propriedade bem mais interessante do que simplesmente "um arquivo dividido em páginas". É praticamente uma **camada física de paginação para texto arbitrário**.
