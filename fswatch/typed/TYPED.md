# TYPED

**Status:** draft
**Version:** 0.1

Typed é uma convenção para representar **dados tabulares tipados, autorreferentes e autodocumentados em arquivos de texto**.

A ideia central é separar três coisas:

```text
Type Tree       → significado
Data            → valores
Serializer      → representação física
```

O resultado é uma tabela que pode ser lida por humanos, processada deterministicamente por máquinas e materializada em diferentes formatos sem perder sua semântica.

---

# 1. Motivação

Formatos textuais são excelentes para dados duráveis:

* são legíveis;
* são diffáveis;
* são versionáveis;
* são fáceis de gerar;
* sobrevivem a diferentes ferramentas;
* não dependem de um banco específico.

Mas formatos como CSV possuem pouca semântica.

Uma tabela:

```csv
type,name,id,parent,size
d,src,10,1,4096
f,main.js,11,10,8192
```

não informa:

* o que `d` significa;
* qual é o tipo de `id`;
* se `parent` é um ID absoluto ou delta;
* qual unidade possui `size`;
* se os valores são signed ou unsigned;
* quais relações existem entre os registros.

Typed resolve isso adicionando um **frontmatter semântico** ao arquivo.

---

# 2. Arquivo autodocumentado

Um Typed file contém um header seguido pelo conteúdo no formato físico escolhido.

Para CSV:

```text
header
table
```

Exemplo:

```csv
# typed=1,version=0.1
# root=/home/project
# s=string,i=integer,u=unsigned integer
# pk=i autoinc
# node-id=pk
# node-id-delta=node-id delta
# ftype={d:dir,f:file,l:link}
# Schema={type:ftype,name:s,id:pk,parent_dt:node-id-delta,size:u}

type,name,id,parent_dt,size
d,src,1,0,4096
f,main.js,2,1,8192
```

O arquivo continua sendo essencialmente uma tabela textual, mas agora contém sua própria descrição semântica.

A intenção é que um leitor possa determinar **deterministicamente** como interpretar os dados apenas a partir do próprio arquivo.

---

# 3. Frontmatter

O frontmatter é formado por comentários no início do arquivo.

A sintaxe do comentário depende do formato:

```text
CSV       # ...
Markdown  # ...
Lua       -- ...
SQL       -- ...
JS/TS     // ...
C/C++     // ...
```

O conceito de frontmatter, entretanto, é o mesmo.

Não é necessário estabelecer uma distinção rígida entre "diretivas" e "comentários".

O conjunto inicial de comentários constitui o header.

Comentários também podem existir no corpo:

```csv
f,main.js,2,1,8192 # generated
```

Isso permite que o mesmo mecanismo sirva para:

* comentários;
* documentação;
* metadata;
* padding;
* alinhamento de páginas.

---

# 4. YAML Flow

O conteúdo estruturado do header utiliza uma sintaxe **YAML Flow-like**.

Exemplo:

```text
# ftype={d:dir,f:file,l:link}
# flags={r:readonly,h:hidden,s:system,i:ignored}
# Schema={type:ftype,name:s,id:pk,parent_dt:node-id-delta,size:u}
```

A intenção não é criar uma nova linguagem de objetos.

Quando possível, uma implementação deve delegar essa interpretação a uma implementação YAML existente, como `Bun.YAML`.

O importante é que a representação seja uma árvore de objetos compacta e reformatável:

```text
{a:x,b:y,c:{d:z}}
```

pode ser expandida ou reorganizada sem alterar sua semântica.

---

# 5. Type Tree

Os tipos formam uma árvore de definições nomeadas.

Tipos básicos:

```text
s = string
i = integer
u = unsigned integer
c = enum/char
```

Tipos derivados podem referenciar livremente outros tipos:

```text
pk = i autoinc
node-id = pk
node-id-delta = node-id delta
```

A resolução é simplesmente:

```text
node-id-delta
    ↓
node-id
    ↓
pk
    ↓
i
    ↓
integer
```

Não existe necessidade de uma hierarquia rígida de classes.

Um tipo é essencialmente:

```text
name → definition
```

e uma definição pode referenciar outro nome no mesmo namespace.

---

# 6. O Schema também é um tipo

O schema não é uma estrutura especial fora do Type Tree.

Ele próprio é uma definição:

```text
Schema={
  type:ftype,
  name:s,
  id:pk,
  parent_dt:node-id-delta,
  size:u
}
```

Assim, os campos do schema também são tipos e podem referenciar tipos definidos anteriormente ou em qualquer posição resolvível do mesmo Type Tree.

Isso mantém a linguagem pequena.

Não existem dois sistemas:

```text
type system
schema system
```

Existe apenas:

```text
Type Tree
```

onde `Schema` é um objeto especial por convenção.

---

# 7. Enums

Um enum associa uma representação compacta a um significado.

```text
ftype={d:dir,f:file,l:link,s:socket,b:block,c:char,p:fifo}
```

O armazenamento pode usar:

```text
d
```

enquanto o significado é:

```text
dir
```

A representação física e a interpretação semântica ficam separadas.

---

# 8. Bitmaps

Enums independentes podem ser fisicamente compactados.

Por exemplo:

```text
flags={
  r:readonly,
  h:hidden,
  s:system,
  i:ignored,
  t:test,
  d:doc
}
```

representa um conjunto de propriedades independentes.

O bitmap não é um tipo semântico especial. Ele é uma **forma de empacotar pequenos valores**.

Exemplos:

```text
8 × 1 bit  → 1 byte
4 × 2 bits → 1 byte
2 × 4 bits → 1 byte
```

O Type Tree preserva o significado e o serializer decide a representação física.

---

# 9. Tipos semânticos

Um tipo pode carregar significado além de seu armazenamento.

Por exemplo:

```text
inode=u
size=u
timestamp=i
timestamp-delta=timestamp delta
node-id=pk
node-id-delta=node-id delta
```

Dois campos podem ser fisicamente inteiros e ainda assim serem semanticamente diferentes.

Isso é fundamental para representar estruturas como árvores sem introduzir redundância.

Por exemplo:

```text
id,parent_dt
1,0
2,1
3,1
```

pode significar:

```text
parent_id = id - parent_dt
```

---

# 10. Metadata temporal

O header pode conter metadata necessária para interpretar tipos.

Por exemplo:

```text
# T0=2026-09-14T18:32:41.123Z
```

com:

```text
mtime=timestamp-delta
```

Um valor armazenado:

```text
15342
```

significa:

```text
T0 + 15342
```

`T0` pertence ao metadata do arquivo e não precisa ser repetido em cada registro.

---

# 11. Campos calculados

Typed pode opcionalmente possuir campos que não são armazenados.

Exemplo:

```text
# Schema={
  size:u,
  blocks={{ ceil(size / 4096) }}
}
```

O campo:

```text
blocks
```

é uma função dos demais campos.

Conceitualmente:

```text
stored field
    ↓
value

computed field
    ↓
function(row)
    ↓
value
```

Campos calculados são uma capacidade opcional, não parte necessária do mecanismo básico.

Uma implementação Typed mínima pode ignorá-los completamente.

---

# 12. Linguagens externas

A linguagem usada para um campo calculado não precisa ser a linguagem do parser Typed.

Esse é um princípio importante.

Para utilizar:

```text
foo.lua
```

como implementação de regras de negócio, não é necessário implementar um parser Lua dentro do Typed.

Basta existir um **binder** capaz de conectar o campo ao runtime da linguagem.

Conceitualmente:

```text
Typed
  ↓
field = lua(...)
  ↓
Lua binder
  ↓
Lua function
  ↓
value
```

O contrato é entre Typed e o binder, não entre Typed e a linguagem.

Assim podem existir bindings para:

```text
JavaScript
Lua
Python
WASM
C
...
```

desde que uma implementação consiga compilar/carregar a definição e fornecer uma função executável.

---

# 13. Arquivo companion

Um arquivo Typed pode delegar comportamento a um arquivo de mesmo basename.

Por exemplo:

```text
users.csv
users.lua
```

O CSV contém:

```text
data + Type Tree
```

e o Lua contém:

```text
computed fields
business rules
transformations
validators
```

O arquivo auxiliar pode ser referenciado pelo header ou descoberto por convenção.

Isso mantém os dados limpos sem limitar a capacidade expressiva do sistema.

---

# 14. `.lua` como Data Definition Language

Um arquivo `.lua` não precisa ser apenas código de execução.

Lua pode ser usado como **Data Definition Language**.

Por exemplo, sua primeira aplicação pode ser uma definição de dados:

```lua
return {
  Schema = {
    id = "pk",
    name = "string",
    size = "u"
  },

  Types = {
    pk = "i autoinc",
    size = "u"
  }
}
```

A linguagem Lua torna-se então uma forma programável de declarar o Type Tree.

Isso é diferente de exigir que Typed seja implementado em Lua ou que o parser Typed conheça a gramática completa de Lua.

O runtime apenas precisa de um mecanismo para carregar a definição.

Portanto:

```text
.lua
```

pode atuar como:

```text
Data Definition Language
        +
computed fields
        +
business rules
        +
transformations
```

conforme a necessidade.

---

# 15. Binder

Um binder é a fronteira entre Typed e uma linguagem externa.

Seu contrato pode ser mínimo:

```text
load(source)
compile(source)
bind(name, function)
call(function, row)
```

A implementação concreta pode ser completamente diferente em cada linguagem.

O Type system não precisa saber.

Isso permite que a infraestrutura permaneça pequena enquanto o comportamento pode ser arbitrariamente extensível.

---

# 16. Serializers

Typed separa semântica de armazenamento.

O mesmo Type Tree pode ser materializado como:

```text
Typed CSV
Typed JSON
Typed JSONL
Typed MD
...
```

Conceitualmente:

```text
                 Type Tree
                     │
                Typed POJO
                     │
        ┌────────────┼────────────┐
        │            │            │
       CSV          JSON         MD
        │            │            │
       file         file         file
```

Ou inversamente:

```text
CSV  ─┐
JSON ─┼→ Typed POJO
MD   ─┘
```

O Typed POJO é a representação canônica.

O serializer é somente a materialização física.

---

# 17. Determinismo

Um Typed file deve ser suficientemente definido para que diferentes implementações produzam o mesmo significado.

Isso implica:

* tipos possuem nomes determinísticos;
* referências são resolvidas pelo nome;
* schema define a ordem dos campos;
* enums possuem códigos explícitos;
* metadata necessário à interpretação é armazenado no header;
* serializers possuem regras definidas;
* campos calculados devem possuir semântica determinística quando usados como dados materializados.

O objetivo não é apenas "ser legível".

O objetivo é que:

```text
arquivo → interpretação → POJO
```

seja previsível e reproduzível.

---

# 18. PagedText

Typed combina naturalmente com armazenamento paginado textual.

Como comentários são semanticamente invisíveis, espaço não utilizado pode ser preenchido:

```text
record #....................................................
```

O padding permanece parte do arquivo físico, mas não do conteúdo lógico.

Assim Typed pode ser utilizado sobre um mecanismo como PagedText sem introduzir caracteres especiais no modelo de dados.

O serializer continua enxergando apenas:

```text
record
```

e o storage pode enxergar:

```text
page
padding
record boundary
```

---

# 19. Relação com fswatch

Typed nasceu de uma necessidade concreta do `fswatch`, mas não pertence ao `fswatch`.

O `fswatch` pode produzir:

```text
tree.csv
```

com:

```text
type
name
id
parent_dt
...
```

O primeiro scan pode materializar apenas a topologia:

```text
id
parent
name
type
```

Metadata permanece lazy:

```text
size   → lstat() quando solicitado
mtime  → lstat() quando solicitado
ctime  → lstat() quando solicitado
inode  → lstat() quando solicitado
hash   → file read quando solicitado
```

Resultados podem ser memoizados e posteriormente invalidados.

Isso permite que a construção inicial da árvore seja rápida, enquanto informações caras são adquiridas somente quando necessárias.

Typed apenas descreve os campos; o runtime decide quando e como materializá-los.

---

# 20. Arquitetura mínima

A implementação pode ser construída como factories com closure e escopo compartilhado:

```text
typed()
  │
  ├── types
  ├── constructors
  ├── schema
  ├── languages
  └── serializers
```

Não é necessário:

* class hierarchy;
* dependency injection framework;
* AST complexa;
* parser específico para cada linguagem;
* sistema global de plugins;
* serializer acoplado ao type system.

O núcleo pode permanecer pequeno.

Implementações são intercambiáveis:

```text
Typed
 ├── CSV serializer
 ├── JSON serializer
 ├── Lua binder
 ├── JS binder
 └── ...
```

---

# 21. Princípio fundamental

Typed estabelece uma fronteira simples:

```text
                 SEMÂNTICA
                     │
                  Type Tree
                     │
                Typed POJO
                     │
             ┌───────┴───────┐
             │               │
        SERIALIZAÇÃO      BEHAVIOR
             │               │
       CSV/JSON/MD       JS/Lua/...
```

O arquivo continua sendo texto.

O header torna o texto autodocumentado.

O Type Tree torna a interpretação explícita.

O serializer define a representação física.

O binder conecta comportamento externo.

E o Type Tree continua sendo o centro comum de tudo.

> **Typed não é uma nova linguagem de dados. É uma pequena convenção que transforma arquivos de texto em **tabelas viva de objetos tipados**, autodocumentados e extensíveis.**
