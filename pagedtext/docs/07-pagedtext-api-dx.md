# API e DX (Developer Experience) do PagedText

## Filosofia da API

Eu faria a API **deliberadamente pequena**. O DX deve dar a sensação de que você abriu um `Array`/`String`, não que está usando um storage engine.

### 1. Factory

```js
const log = PagedText({
  path: './app.log',
  kind: 'clike'
})
```

A partir daí, `log` é o próprio arquivo lógico:

```js
log.length
log[0]
log[1000]
log.slice(1000, 1100)
```

Nada de `page`, `offset`, `filling` ou `flush` no uso normal.

---

### 2. Array de linhas

A abstração principal seria:

```js
log[42]          // linha 42
log[42] = text   // substitui
delete log[42]   // remove

log.push(text)
log.pop()

log.splice(42, 3)
log.splice(42, 0, a, b, c)
```

E:

```js
for (const line of log)
  parse(line)
```

A coisa fica praticamente indistinguível de:

```js
const lines = [...]
```

só que:

```text
Array
  → RAM

PagedText
  → arquivo paginado
```

---

### 3. Blocos

O segundo acesso natural seria por **blocos**, não necessariamente por páginas físicas.

Por exemplo:

```js
log.block(10)
```

retorna um bloco lógico:

```js
{
  start: 10000,
  end: 10999,
  lines: [...]
}
```

Mas eu evitaria inventar uma estrutura `Block` se não for necessária. Melhor que o próprio bloco continue sendo uma visão do `PagedText`:

```js
const block = log.block(10)

block[0]
block[100]
block.length
block.slice(100, 200)
```

E, principalmente:

```js
for (const line of log.block(10))
  parse(line)
```

O bloco pode corresponder a uma página física, mas **não precisa**.

---

### 4. Texto contínuo

A mesma instância poderia ter uma visão textual:

```js
log.text
```

Então:

```js
log.text.slice(1000000, 1001000)
```

ou:

```js
log.text.indexOf('ERROR')
```

Isso é importante porque nem todo consumidor pensa em linhas.

Teríamos então:

```text
PagedText Proxy
│
├── array-like
│   log[n]
│   log.length
│   log.slice()
│   log.splice()
│
├── block-like
│   log.block(n)
│
└── text-like
    log.text
```

Sem duplicar o storage.

---

### 5. Acesso Bidirecionado

O Proxy pode ir ainda mais longe com `reverse()`:

```js
for (const line of log.reverse())
  parse(line)
```

produziria:

```text
linha N
linha N-1
linha N-2
...
linha 2
linha 1
linha 0
```

Mas não precisa existir uma "reverse file".

É apenas uma **view de leitura** que usa o índice de páginas para caminhar:

```text
page N
  ↓
page N-1
  ↓
page N-2
  ↓
...
```

E dentro de cada página o codec encontra as linhas de trás para frente.

Isso torna coisas como:

```js
const lastErrors = file
  .reverse()
  .filter(x => x.includes('ERROR'))
  .take(100)
```

conceitualmente possíveis sem ler gigabytes desde o início.

---

## 6. Transparência Externa

E o ponto mais bonito: **transparência externa**.

Um compilador que simplesmente fizer:

```bash
cat server.log
```

deve enxergar um arquivo perfeitamente razoável.

Um parser C:

```c
fopen("server.log", "r");
```

também.

Um editor de texto pode abrir.

`grep` pode procurar.

`less` pode navegar.

O filling foi escolhido para ser **sintaticamente benigno** naquele formato.

Por exemplo:

```js
//- page boundary
```

continua sendo comentário válido em C/C++/JS.

Portanto:

```text
conteúdo real
conteúdo real
//- filling
//- filling
conteúdo real
```

continua sendo um programa/texto válido para o compilador.

A instrumentação está presente fisicamente, mas é **semanticamente inerte**.

---

## 7. Controle Físico Quando Necessário

O usuário avançado eventualmente precisa saber das páginas:

```js
log.pages
log.page(10)
log.offset(10)
```

Mas isso deveria ser uma **segunda camada da API**, não contaminando o uso cotidiano.

Algo como:

```js
log.physical.page(10)
log.physical.offset(10)
```

Assim fica explícita a mudança de abstração:

```js
log[1000]              // lógico
log.block(10)          // lógico
log.text               // lógico

log.physical.page(10)  // físico
```

---

## 8. O DX Final

O teste de qualidade deveria ser este:

```js
const log = PagedText('./huge.log', {
  kind: 'clike'
})

log[1_000_000]

log.slice(1_000_000, 1_001_000)

log.splice(1_000_000, 10, ...newLines)

for (const line of log)
  process(line)
```

O programador **não precisa saber que o arquivo tem 8 GB, 400 mil páginas, índices de offsets ou fillings**.

E, ao mesmo tempo, quem quiser inspecionar fisicamente pode:

```js
log.physical.page(123)
```

Essa separação é muito boa porque mantém a promessa central do `PagedText`:

> **um arquivo físico paginado, mas uma experiência lógica de Array/String.**

Para mim, `PagedText` deveria ficar nisso. **Não virar ORM, nem parser, nem database API.** IODB então simplesmente ganha uma fundação de storage textual extremamente simples.

---

## Acesso Binário e Stream

Eu também gostaria de ter acesso binário via stream em duas direções. Você pode pedir um arquivo com linhas em ordem reversa. De fato a interface deve facilitar essas formas de acesso livre mas lógico onde os arquivos são cuidadosamente instrumentados com os fillings para ser o máximo transparente para todos os compiladores quando em acesso direto de leitura. Só a escrita que precisa seguir um protocolo.

Sim. Isso muda um pouco a definição: `PagedText` não é apenas um *text file wrapper*, mas uma **view lógica sobre um arquivo instrumentado**. E a distinção leitura/escrita fica muito elegante.

### A ideia central

```text
                    PagedText
                       │
             ┌─────────┴─────────┐
             │                   │
          READ                 WRITE
             │                   │
      ┌──────┼──────┐            │
      │      │      │            ▼
    text   lines  bytes       protocol
      │      │      │
      └──────┼──────┘
             │
        logical views
             │
     ┌───────┼────────┐
     ▼       ▼        ▼
 forward  reverse   random
```

**Leitura é livre. Escrita é protocolada.**

Isso é particularmente poderoso porque o arquivo físico continua sendo um arquivo normal.

### Leitura binária

Eu colocaria uma view explícita:

```js
const file = PagedText('./huge.log', { kind: 'clike' })

file.bytes
```

E essa view seria um `Readable`/stream lógico:

```js
for await (const chunk of file.bytes)
  consume(chunk)
```

Mas também poderia ser randômica:

```js
await file.bytes.read(offset, size)
```

A diferença é que `bytes` enxerga o **arquivo físico**, incluindo ou não fillings conforme a view escolhida.

Então talvez:

```js
file.bytes.raw
file.bytes.logical
```

seja mais correto.

---

## Escrita é Diferente

Aqui eu concordo totalmente com você: não dá para prometer escrita arbitrária por ferramentas externas.

```bash
echo "foo" >> file
```

pode destruir as invariantes físicas.

Então:

```text
READ
  qualquer ferramenta
       ↓
   arquivo válido

WRITE
  PagedText protocol
       ↓
   arquivo válido + invariantes
```

Isso sugere uma regra muito simples:

> **O arquivo é publicamente legível, mas somente o protocolo PagedText é autorizado a mutá-lo estruturalmente.**

A escrita pode então atualizar:

- conteúdo;
- páginas;
- fillings;
- offsets;
- índices;
- cristalização;
- checksums, se existirem.

Tudo mantendo a representação textual válida.

### API conceitual

Eu tenderia para algo assim:

```js
const db = PagedText('./events.log', {
  kind: 'clike'
})
```

Views:

```js
db.lines
db.text
db.bytes
db.reverse()
db.block(n)
```

Acesso:

```js
db.lines[1000]
db.text.slice(a, b)
db.bytes.read(a, n)
db.reverse()[0]
```

E mutação:

```js
db.lines.push(line)
db.lines.splice(i, n, ...lines)
db.text.replace(a, b, text)
```

Tudo isso é **logical mutation**, traduzida pelo protocolo para a representação física.

O princípio mais forte da API seja justamente:

```text
             ONE FILE
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
     lines     text     bytes
       │        │        │
       └────────┼────────┘
                │
          logical views
                │
        ┌───────┴───────┐
        ▼               ▼
     forward          reverse
```

E por baixo:

```text
              physical file
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
     pages       fillings      indexes
```

Isso dá ao IODB uma propriedade bem rara: **um storage otimizado para acesso estruturado que continua sendo um arquivo que o mundo exterior consegue ler sem conhecer o storage engine.**
