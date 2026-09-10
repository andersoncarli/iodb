# CSV Tipado e Formato de Texto

## Formato Ideal para Projeção Flat

Seguindo a ideia de arquivos de dados em modo texto com padding neutros de página, acho que vale a pena pensar sobre o formato de um arquivo tipado. Acho que.o seu formato ideal deve ser um csv tipado no header como

```text
name:str,age:int,...
Ana,26
,, mostra um valor nulo.
```

### Sim. Para a projeção flat, eu acho que CSV tipado é uma escolha muito coerente com a filosofia do IODB

Humano-legível, append-only, fácil de inspecionar e sem precisar de um formato binário proprietário.

Eu só faria uma distinção importante: o header não precisa carregar apenas o tipo, mas pode ser a **definição da coluna**:

```text
name:str,age:int
Ana,26
Bob,31
,42
```

onde vazio significa `null`.

### O ponto forte é que o schema fica no próprio arquivo

```text
name:str,age:int,active:bool,balance:float
```

A projeção sabe imediatamente:

```text
name    → string
age     → integer
active  → boolean
balance → float
```

e a representação textual é canônica.

---

## Padding de Página

Isso combina muito bem com o esquema que você já descreveu.

Imagine páginas de tamanho fixo:

```text
┌──────────────────────────────────────────────┐
│ name:str,age:int                             │
│ Ana,26                                       │
│ Bob,31                                       │
│ ,42                                          │
│                                              │
│                 padding                      │
│                                              │
└──────────────────────────────────────────────┘
```

O padding não precisa ser um caractere especial. Pode simplesmente ser espaço ou `\n`, desde que o parser saiba que depois do último registro válido começa a área neutra.

E uma página cheia continua sendo cristalizada.

---

## Evitando CSV Genérico

O interessante aqui é definir um **CSV deliberadamente restrito**.

Por exemplo:

```text
str
int
float
bool
date
time
json
```

E valores:

```text
Ana
26
3.14
true
2026-09-09
14:30:00
...
```

Para strings contendo `,`, `"`, ou newline, usa-se o escaping CSV convencional.

Isso mantém compatibilidade com ferramentas existentes sem transformar o formato em uma especificação monstruosa.

---

## Tipos Determinam Encoding

Embora o arquivo seja texto, o tipo permite ao projector evitar conversões genéricas:

```text
age:int
```

faz:

```text
"26" → 26
```

enquanto:

```text
age:str
```

mantém:

```text
"26" → "26"
```

E para índices:

```text
age:int
```

permite que o índice mantenha os valores numericamente ordenados, em vez de lexicograficamente:

```text
2
10
100
```

em vez de:

```text
10
100
2
```

Isso é importante para os **range indexes**.

---

## Nullabilidade e Índices

Acho que só precisamos de uma maneira de indicar nullabilidade e índices para os campos. Originalmente eu pensei em ter no formato a primeira linha como um objeto de esquema, mas isso quebra o formato csv. Mas acho que talvez se justifique pela facilidade.

### Concordo. Eu não sacrificaria a simplicidade do CSV para encaixar um schema mais rico na primeira linha

Podemos estender a declaração da coluna:

```text
name:str,age:int?,email:str@,country:str?@
Ana,26,ana@x.com,BR
Bob,,bob@x.com,
```

Por exemplo, uma gramática mínima poderia ser:

```text
field : type [nullability] [index]
```

com:

```text
str       obrigatório
str?      nullable

str@      indexed
str?@     nullable + indexed
```

Então:

```text
name:str,age:int?,email:str@,country:str?@
```

é simultaneamente:

1. CSV válido;
2. schema;
3. tipagem;
4. declaração de nullabilidade;
5. declaração de índices.

---

## Extensões Opcionais

Para IODB, talvez seja melhor separar **indexação** de **unicidade**:

```text
name:str
email:str@!
age:int?
```

onde:

```text
?  nullable
@  indexed
!  unique
```

Assim:

```text
email:str@!
```

significa:

> `email` é string, não-null, indexado e único.

E:

```text
email:str?@!
```

pode significar:

> nullable, indexado e único.

---

## Sobre Formato Híbrido

Eu evitaria colocar um objeto na primeira linha.

Algo como:

```json
{"name":"str","age":"int?"}
```

seguido por CSV cria efetivamente um **formato híbrido**.

Enquanto:

```text
name:str,age:int?
Ana,26
Bob,
```

continua sendo reconhecível como CSV por praticamente qualquer ferramenta.

E mais importante: **o header já é naturalmente um schema de colunas**. Não precisamos de uma segunda linguagem para isso.

---

## Identidade no Schema

O header poderia também suportar uma forma de identidade:

```text
id:id,name:str,age:int
```

ou talvez nem seja necessário, porque no IODB o `id` é propriedade estrutural do objeto e não uma coluna.

Eu tenderia à segunda opção.

Assim:

```text
name:str,age:int
Ana,26
Bob,31
```

é a **projeção dos atributos**, enquanto a identidade permanece pertencendo ao mecanismo IODB.

Isso mantém a separação:

```text
stream       → identidade + história
projection   → valores atuais
typed header → interpretação dos valores
index        → acesso por valores
```

E o detalhe do `,,` é excelente porque dá ao formato uma representação textual simples de `null` sem inventar tokens como `NULL`, `nil` ou `~`.

Eu só definiria explicitamente que **campo vazio é `null`, enquanto `""` é string vazia**:

```text
name:str,age:int
,26
"",26
```

Isso dá ao formato uma semântica inequívoca.

---

## CSV-IODB com Padding

Vamos adicionar um campo extra na linha delimitado por vírgulas para não ser removido por editores externos.

```text
name:str,age:int
Ana,26
Bob,31
Carol,42,············,
```

É uma peculiariedade do formato csv de iodb o último registo de uma página pode ter um campo de padding. Contendo no mínimo uma ou duas vírgulas mais espaços.

### Sim. Isso é uma solução bem elegante

O padding deixa de ser "lixo depois do arquivo" e passa a ser **parte sintática do CSV-IODB**.

A regra poderia ser:

```text
name:str,age:int
Ana,26
Bob,31
Carol,42,············,
```

A última linha contém:

```text
Carol,42,<padding>,
         ^         ^
      extra field  delimiter
```

O parser conhece o número de colunas do schema:

```text
name:str,age:int
       2 colunas
```

Portanto, qualquer campo além das duas colunas **não é dado**. No contexto específico da última linha da página, ele é padding.

### Isso tem uma propriedade importante

Um editor que:

- remove trailing spaces;
- normaliza newline;
- garante newline final;
- etc.

não consegue destruir o padding, porque ele contém **delimitadores CSV reais**:

```text
,··········,
```

Mesmo que os espaços sejam removidos:

```text
,,
```

a estrutura ainda permanece.

Eu faria a regra ainda mais precisa:

```text
record := columns
        | columns + padding

padding := "," + spaces + ","
```

E exigiria que `padding` ocorra **somente no último registro físico da página**.

Assim:

```text
name:str,age:int
Ana,26
Bob,31
Carol,42,          ,
```

é uma página válida, enquanto:

```text
name:str,age:int
Ana,26,,,
Bob,31
```

não é.

### E isso resolve uma questão do formato físico

Você passa a ter:

```text
┌────────────────────────────── page ──────────────────────────────┐
│ name:str,age:int                                                 │
│ Ana,26                                                           │
│ Bob,31                                                           │
│ Carol,42,············,                                           │
└──────────────────────────────────────────────────────────────────┘
```

O parser pode localizar o fim da página **pelo padding**, sem depender de caracteres que um editor possa considerar descartáveis.

E quando a página ainda está aberta, simplesmente não existe padding:

```text
name:str,age:int
Ana,26
Bob,31
```

Quando o último slot é preenchido, a página recebe seu registro de padding e se torna cristalizada.

Isso mantém a ideia que já temos no IODB:

**o formato lógico continua sendo texto/CSV; o mecanismo físico de páginas é embutido sem contaminar os registros.**

---

## Transparência e Inspectabilidade

Exato e isso permite um sistema realmente aberto e inspecionavel em texto plano mas ainda mantendo a paginação.

Você consegue abrir o arquivo com:

```bash
cat
less
grep
awk
sed
```

e ainda assim o storage sabe onde terminam as páginas.

A estrutura fica conceitualmente:

```text
┌─────────────────────────────────────────────┐
│ header                                      │
│ row                                         │
│ row                                         │
│ row + padding                               │ ← página cristalizada
├─────────────────────────────────────────────┤
│ row                                         │
│ row                                         │
│ ...                                         │ ← página aberta
└─────────────────────────────────────────────┘
```

E o padding tem uma função dupla:

```text
CSV semantics       → campo extra
IODB semantics      → page terminator
```

Isso é particularmente interessante porque **não existe um segundo formato físico escondido atrás do CSV**.

A mesma informação pode ser entendida por dois níveis:

```text
CSV parser
    ↓
records / fields

IODB parser
    ↓
records / pages / slots
```

E o primeiro continua útil sozinho.

### Três propriedades emergem

**1. Inspectability**

```text
arquivo → texto humano
```

**2. Recoverability**

```text
stream/projection/index → reconstruíveis
```

**3. Physical locality**

```text
arquivo → páginas → slots
```

Sem precisar de um container binário.

E isso casa muito bem com a ideia dos **três arquivos**:

```text
stream.csv-like
projection.csv-like
index.csv-like
```

Cada um pode ser inspecionado independentemente.

Inclusive, um `diff` entre estados pode ser literalmente um diff textual — algo que bancos tradicionais perdem completamente.

**Tudo que é persistido deve permanecer inteligível como texto, enquanto a estrutura física necessária para desempenho deve ser codificada de maneira válida e não destrutiva dentro desse texto.**

É uma restrição forte, mas produtiva. Ela força o storage a permanecer simples.
