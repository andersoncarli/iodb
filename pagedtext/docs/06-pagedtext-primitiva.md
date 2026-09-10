# PagedText: Primitiva de Storage Textual

## Conceito Central

De fato, entra em cena a closure PagedText({kind:"csv|json|yaml|clike ...', path,name,...}} uma forma totalmente transparente de acessar arquivos texto paginados. E com acesso randômico ou índice de página.

Sim. Aí `PagedText` deixa de ser uma característica do IODB e vira uma **abstração de storage independente**.

Algo como:

```js
const users = PagedText({
  kind: 'csv',
  path: './data',
  name: 'users'
})
```

com uma API conceitualmente pequena:

```js
users.get(page, row)
users.page(n)
users.pages()
users.append(text)
users.flush()
```

E o ponto central é que `PagedText` conhece **páginas físicas**, mas não precisa conhecer a semântica dos registros.

```text
PagedText
   │
   ├── csv
   ├── json
   ├── yaml
   ├── clike
   └── ...
```

Cada `kind` só precisa saber:

```text
parse page
find record boundary
encode record
detect page terminator
```

Enquanto o mecanismo comum resolve:

```text
path
page size
page offsets
random access
append
padding
flush
```

---

## Acesso Randômico Eficiente

O índice de páginas pode ser trivial:

```text
page 0 → byte 0
page 1 → byte 8192
page 2 → byte 16384
page 3 → byte 24576
```

ou, se o tamanho físico da página for fixo:

```text
offset = page * PAGE_SIZE
```

Então:

```js
text.page(37)
```

não precisa percorrer o arquivo desde o início.

E mesmo que a página contenha registros de tamanho variável, você só precisa localizar **dentro daquela página**.

Isso cria uma camada bastante limpa:

```text
                 PagedText
                    │
        ┌───────────┴───────────┐
        │                       │
   physical layer          text codec
        │                       │
 pages / offsets        CSV / JSON / YAML
        │
 random access
```

---

## Generalização para Diferentes Formatos

Por exemplo, JSON poderia ser:

```text
{ "name": "Ana", "age": 26 }
{ "name": "Bob", "age": 31 }
{ "name": "Carol", "age": 42, ...padding... }
```

JSON Lines é particularmente natural.

YAML talvez seja mais complicado porque a unidade sintática não é necessariamente uma linha, mas o mesmo princípio pode funcionar se o codec souber determinar o boundary.

E `clike` poderia simplesmente usar um delimitador estrutural definido pelo codec.

A consequência arquitetural é boa:

```text
IODB
 │
 ├── Stream     → PagedText(...)
 ├── Projection → PagedText(...)
 └── Index      → PagedText(...)
```

Ou seja, **IODB não precisa possuir um storage engine textual próprio**. Ele pode ser construído sobre `PagedText`.

E isso preserva a ideia que você vem buscando desde o começo: o mecanismo é pequeno, enquanto as semânticas são compostas por cima dele.

Eu só manteria uma regra forte: **`PagedText` não deve tentar entender o documento inteiro**. Ele deve conhecer apenas o suficiente para encontrar boundaries e páginas. O parser semântico pertence ao `kind`. Isso mantém a closure realmente pequena.

---

## Acesso Agnóstico à Paginação

C-like usa comentários do tipo c/c++/js como filling.
Se acessado através da factory o acesso pode ser totalmente agnóstico da paginação e fillings atraves de um Proxy. De fato a factory retorna um proxy transparente para o arquivo como uma stream de acesso randômico. Pense em um parser de um log de texto de gb de tamanho. Que pode ser visto como um array esparso de linhas ou um texto continuo onde os fillings são abstraídos.

Sim. Isso deixa o `PagedText` ainda mais interessante: **a paginação deixa de fazer parte da interface lógica**.

O `Proxy` pode apresentar o arquivo como se fosse simplesmente um texto/array, enquanto a factory resolve internamente páginas, offsets e fillings.

```text
              PagedText factory
                     │
                     ▼
              ┌─────────────┐
              │    Proxy    │
              └──────┬──────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
   acesso lógico             acesso físico
        │                         │
   text / lines / [n]       pages / offsets
   sem fillings             filling / padding
```

### Duas visões do mesmo arquivo

O mesmo arquivo físico:

```text
line 0
line 1
line 2
// filling da página
line 3
line 4
...
```

pode ser exposto como:

```js
text[0]
text[1]
text[2]
text[3]
text[4]
```

ou como:

```js
text.slice(1000000, 1005000)
```

sem que o consumidor saiba que houve uma fronteira física entre `line 2` e `line 3`.

E há uma distinção importante:

```text
arquivo lógico
──────────────────────────────────────
A B C D E F G H I J K L M ...

arquivo físico
─────────────────┬────────────────────
A B C //fill     │ D E F //fill
                 │
                 └── página
```

O filling é **metadado físico codificado no próprio texto**, não conteúdo lógico.

### Array esparso de linhas

Isso também combina muito bem com o acesso randômico:

```js
log[0]
log[100]
log[1_000_000]
```

A resolução seria aproximadamente:

```text
line → page → offset → parse
```

mas o `Proxy` esconde tudo.

E, inversamente, para um parser que prefere trabalhar como stream:

```js
for (const line of log)
    parse(line)
```

ele simplesmente enxerga uma sequência contínua.

Então `PagedText` pode oferecer essencialmente **duas abstrações sobre a mesma coisa**:

```text
              PagedText Proxy
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      random text          sequential
      / sparse lines        stream
```

Isso é particularmente forte para logs de GB: **não é necessário carregar o arquivo, nem manter um índice de todas as linhas**. O índice físico pode ser de páginas, e dentro da página o parser encontra a linha.

O princípio central fica:

> **PagedText transforma um arquivo textual paginado em um espaço lógico contínuo de texto, ocultando completamente as descontinuidades físicas.**

E `kind` só precisa ensinar ao `PagedText` **como reconhecer conteúdo versus filling e onde estão os limites naturais de acesso**.

---

## Interface Lógica vs. Física

Exato. Kind é o construtor de fillings para cada formato. Sempre procurando ser o menos intrusivo, mas com a possibilidade de usar comentários especiais //- ao invés de espaços para que ele fiquem evidentes ou não. Depende do usuário e situação. As vezes fillings explícitos daí melhores. O importante é oferecer acesso randômico e transparente com livre edição adição ou remoção de linhas. O proxy oferece acesso totalmente transparente para array de linhas . Ou blocos delimitados.

Exato. Eu fecharia a abstração nessa direção:

```text
PagedText
  ├── physical file
  ├── page index
  ├── random access
  ├── edits
  └── kind
       └── filling codec
```

E o `kind` não é propriamente um parser do conteúdo. Ele é o **construtor/reconhecedor do filling**.

### Filling como detalhe físico

Por exemplo, em `clike`:

```js
//- PagedText page 17
//- filling ........................................
//- filling ........................................
```

ou, no modo invisível:

```text

```

O segundo é mais intrusivo fisicamente, mas praticamente invisível semanticamente.

O mesmo mecanismo poderia produzir:

```text
CSV       → ,··········,
JSON      → // filling, se JSONL aceitar extensão definida pelo kind
C-like    → //- filling
YAML      → # filling
```

A escolha pertence ao `kind`/configuração, não ao `PagedText`.

### Proxy como arquivo lógico

A interface pode parecer simplesmente:

```js
text[1000]        // linha
text[1000:1100]  // bloco
text.length
text.push(...)
text.splice(...)
```

ou, para blocos:

```js
text.block(17)
```

mas fisicamente:

```text
                 Proxy
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
     linhas                  blocos
        │                     │
        └─────────┬───────────┘
                  ▼
             page index
                  │
                  ▼
             physical file
```

A grande sacada é que **linha e bloco são coordenadas lógicas**, enquanto página é coordenada física.

### Edição não deve conhecer página

Isso é talvez o ponto mais importante.

```js
text.insert(1234, lines)
text.remove(2000, 50)
text[1234] = line
```

não deveria haver nenhuma operação conceitual do tipo:

```js
insertIntoPage(...)
splitPage(...)
moveToNextPage(...)
```

O `PagedText` resolve isso internamente.

Uma edição pode causar:

```text
antes:

page 10 ███████████████
page 11 ███████████████
page 12 ███████████████

depois:

page 10 ███████████████
page 11 ███████████████
page 12 ███████████████
page 13 ███
```

ou reorganizar páginas conforme necessário, **sem alterar a semântica observada pelo Proxy**.

### Portanto, duas camadas muito limpas

```text
                PagedText
                    │
        ┌───────────┴───────────┐
        │                       │
   logical space          physical space
        │                       │
   lines / blocks         pages / offsets
   insert / delete        filling / padding
   random access          file IO
```

E `kind` fica exatamente na fronteira:

```text
             logical text
                   │
              ┌────┴────┐
              │   kind  │
              └────┬────┘
                   │
             physical text
                   +
                fillings
```

Isso torna `PagedText` potencialmente **independente de IODB**. IODB seria apenas um consumidor particularmente interessante dele.

A formulação mais precisa para a ideia é:

> **PagedText é um arquivo textual que se comporta como um espaço lógico contínuo e editável, embora sua representação física seja paginada. O `Proxy` oculta a paginação; o `kind` define como as fronteiras físicas são preenchidas e reconhecidas.**

Isso é uma abstração bem pequena para o que ela resolve.
