# Implementação do PagedText v0

## Estratégia Inicial

Vamos implementar a versão inicial de PagedText com todas as operações naturais de array de forma rápida e não indexada. O que está em jogo aqui é ver e modicar um arquivo texto arbitrário de qq forma com o mínimo impacto possível agindo sobre páginas consecutivas que podem ser adicionadas ou removidas livremente. A engine oculta a execução e entrega uma mudança atômica.

Sim. Eu faria a **v0 deliberadamente sem índice**, mas já com a propriedade estrutural importante: uma alteração lógica vira uma alteração de **uma sequência consecutiva de páginas**, e a engine só toca no que foi afetado.

O modelo seria:

```text
file
┌──────── page 0 ────────┐
├──────── page 1 ────────┤
├──────── page 2 ────────┤
├──────── page 3 ────────┤
└──────── page 4 ────────┘
```

Uma inserção:

```text
page 1 → page 1'
         ↓ overflow
       page 2'
         ↓ overflow
       page 3'
```

e para quando a alteração estabiliza. Não há índice de linhas: para chegar à linha 1 milhão, percorremos as páginas até lá. A otimização vem da **paginação + memória apenas das páginas tocadas**.

---

## DX da Versão Inicial

Eu manteria o DX assim:

```js
const text = PagedText('./huge.log', {
  kind: 'clike',
  pageSize: 64 * 1024
})

text[1000]
text.length

text.push('hello')
text.pop()

text.shift()
text.unshift('first')

text.splice(100, 3, 'a', 'b')

text.slice(100, 200)
text.reverse()

for (const line of text)
  console.log(line)
```

E a operação inteira seria atômica:

```text
logical mutation
      │
      ▼
load affected pages
      │
      ▼
redistribute lines
      │
      ▼
write new pages
      │
      ▼
atomic commit
      │
      ▼
old file → new file
```

---

## Núcleo Arquitetural

Eu dividiria em apenas quatro coisas:

```text
PagedText
├── PageStore       // páginas físicas
├── Kind            // filling + limites lógicos
├── Cursor          // buffer de edição
└── Proxy           // DX de Array/objeto
```

E:

```js
const text = PagedText({
  path: './huge.log',
  kind: 'clike',
  pageSize: 64 * 1024
})
```

O estado interno poderia ser praticamente:

```js
{
  fd,
  pageSize,
  kind,
  pages,
  length
}
```

Só que `pages` **não precisa ser o arquivo inteiro**. É cache das páginas visitadas/modificadas.

---

## 1. Página Física

A primeira implementação pode ser muito simples:

```text
┌──────────────────────────────────────┐
│ page payload                         │
│                                      │
│ ... linhas ...                       │
│ //- filling......................... │
└──────────────────────────────────────┘
             64 KiB
```

Cada página possui:

```js
{
  offset,
  size,
  used,
  data
}
```

Não precisamos ainda de índice persistente.

Para:

```js
text[1000000]
```

fazemos:

```text
page 0
  ↓
page 1
  ↓
...
page N
  ↓
linha
```

Depois podemos adicionar um índice de páginas. A interface não muda.

---

## 2. O Primeiro Grande Calo: Onde está a linha?

Se queremos:

```js
text[1_000_000]
```

sem índice, precisamos descobrir em qual página está a linha.

Há uma solução muito boa para a v0:

**cada página conhece apenas suas próprias linhas.**

Ao carregar:

```text
page
  ├── byte offsets das linhas
  └── conteúdo
```

Então uma página de 64 KiB pode ter, por exemplo:

```js
{
  data: Buffer,
  lines: [0, 38, 71, 105, ...]
}
```

Isso não é um índice global.

É simplesmente o **parse natural da página**, mantido enquanto ela estiver no cache.

Depois:

```js
text[1_000_000]
```

continua sendo O(n) em páginas, mas uma vez dentro da página:

```text
linha global
     ↓
página
     ↓
offset local
```

é O(1)/O(log n).

E futuramente um índice global de páginas pode transformar o primeiro passo em O(log n) ou O(1), sem mudar nada no Proxy.

---

## 3. Cursor é onde a coisa fica realmente boa

Eu não faria o cursor editar strings diretamente.

Ele mantém uma sequência de operações:

```js
[
  { op: 'insert', pos: 100, data: 'abc' },
  { op: 'delete', pos: 200, size: 30 },
  { op: 'write',  pos: 500, data: 'xyz' }
]
```

ou, melhor ainda, um pequeno buffer/rope local.

Assim:

```js
const c = text.cursor()

c.seek(1_000_000)
c.insert('hello')

c.seek(2_000_000)
c.delete(50)

c.seek(3_000_000)
c.write('abc')

c.commit()
```

não toca no arquivo físico.

Até aqui é praticamente um editor de texto.

---

## 4. O Segundo Grande Calo: Commit

Aqui está a parte realmente interessante.

Suponha:

```text
P10
P11
P12
P13
P14
```

e uma edição dentro de `P11` que faz seu tamanho crescer.

Pode acontecer:

```text
P11 → overflow
```

Então:

```text
P11' ───────────────┐
                    ↓
                 P12'
                    ↓
                 P13'
```

O algoritmo é basicamente **redistribuição de páginas**:

```text
affected pages
      ↓
decode
      ↓
apply edits
      ↓
repack
      ↓
produce pages
      ↓
commit
```

Se houver redução:

```text
P11 + P12 + P13
        ↓
P11' + P12'
```

uma página desaparece.

Portanto a operação lógica:

```js
c.delete(10000)
```

pode fisicamente:

```text
+1 página
-3 páginas
+7 páginas
```

e o usuário não precisa saber.

---

## 5. A Atomicidade é o Verdadeiro Problema

Não podemos simplesmente fazer:

```text
write P11
write P12
write P13
...
```

Se o processo morrer no meio, temos um arquivo corrompido.

A solução inicial mais simples é:

```text
original
   │
   ├── lê páginas afetadas
   │
   ▼
temporary file
   │
   ├── escreve nova versão
   │
   ▼
fsync
   │
   ▼
rename
   │
   ▼
novo arquivo
```

Em POSIX, `rename()` no mesmo filesystem dá a propriedade de troca atômica do nome.

Isso é **copy-on-write no nível do arquivo**, não do banco.

Para a primeira implementação eu faria exatamente isso.

Depois podemos evoluir para uma transação mais sofisticada que copie apenas os trechos afetados.

---

## 6. O Detalhe Importante: "Mínimo Impacto"

Aqui existe uma tensão.

A estratégia:

```text
arquivo inteiro → temporary → rename
```

é atomicamente simples, mas não é "mínimo impacto" para um arquivo de 10 GB.

Então eu faria a v0 em duas etapas:

### v0.1 — correctness

```text
edição
  ↓
reconstrói arquivo
  ↓
fsync
  ↓
rename
```

Serve para validar:

- modelo;
- Proxy;
- cursor;
- kinds;
- filling;
- reverse;
- API;
- semântica.

### v0.2 — paged commit

Depois:

```text
old pages
    ↓
affected range
    ↓
new pages
    ↓
copy unchanged suffix/prefix
    ↓
atomic publication
```

Aí começamos a obter a propriedade que você realmente quer.

---

## 7. Um Calo Ainda Maior: Inserção Muda Offsets

Imagine:

```text
P0 P1 P2 P3 P4 P5 ...
```

Inserimos 100 bytes em P2.

Todos os offsets físicos depois de P2 mudam.

Isso significa que **não podemos depender de offsets físicos absolutos como identidade permanente das páginas**.

E isso é bom, porque reforça a arquitetura:

```text
logical position
       ↓
page sequence
       ↓
physical offset
```

O offset é propriedade da materialização atual.

Não é identidade.

Se amanhã adicionarmos:

```text
page index
```

ele deve indexar a **sequência lógica de páginas**, não tratar o byte offset como identidade.

---

## 8. Reverse é Barato e Elegante

Depois que temos páginas:

```js
for (const line of text.reverse())
```

faz:

```text
last page
   ↓
previous page
   ↓
previous page
   ↓
...
```

Dentro de cada página:

```text
last line
   ↓
previous line
   ↓
previous line
```

O filling precisa ser reconhecido e ignorado.

Isso dá uma coisa muito útil:

```js
text.reverse().take(100)
```

pode encontrar os últimos 100 registros de um arquivo de vários GB sem percorrê-lo inteiro.

---

## 9. Filling é o Calo Mais Sutil

Porque precisamos distinguir:

```text
conteúdo legítimo
```

de:

```text
instrumentação física
```

sem ambiguidade.

O `kind` deveria portanto possuir uma operação conceitualmente parecida com:

```js
kind.scan(page)
```

que produz algo como:

```js
{
  content: [...],
  filling: [...],
  boundary: ...
}
```

Mas eu evitaria transformar isso em uma grande interface.

O princípio seria:

> **Kind deve saber reconhecer o mínimo necessário para atravessar uma página.**

Para C-like:

```text
//- ...
```

é trivial.

Para CSV, o filling precisa ser compatível com CSV.

Para JSON/YAML, fica mais delicado porque a linguagem tem regras estruturais mais fortes.

Por isso eu começaria com:

```text
clike
csv
```

e deixaria JSON/YAML para depois.

---

## 10. O Proxy

O Proxy pode ser pequeno.

Conceitualmente:

```js
const handler = {
  get(_, prop) {
    if (prop === 'length') return ...
    if (prop === 'cursor') return ...
    if (prop === 'reverse') return ...
    if (isIndex(prop)) return getLine(+prop)
    return methods[prop]
  },

  set(_, prop, value) {
    if (isIndex(prop))
      return replaceLine(+prop, value)

    ...
  }
}
```

Isso permite:

```js
text[100]
text[100] = 'hello'
```

sem nenhuma consciência da paginação.

---

## 11. Métodos de Array

Eu **não tentaria implementar literalmente todos os métodos de `Array`**.

Alguns fazem sentido:

```text
at
entries
every
filter
find
findIndex
forEach
includes
indexOf
join
keys
lastIndexOf
map
reduce
reduceRight
slice
some
values
```

Mas:

```text
sort
fill
copyWithin
```

podem exigir comportamento estranho ou gigantesco em um arquivo de GB.

Melhor manter a semântica natural quando possível, mas sem fingir que um arquivo de 20 GB é um Array RAM.

A API essencial é:

```js
text[i]
text.length

text.at(i)
text.slice(a, b)

text.push(...)
text.pop()
text.shift()
text.unshift(...)
text.splice(...)

text[Symbol.iterator]()
text.reverse()

text.cursor()
text.commit()
```

O resto pode ser implementado naturalmente depois.

---

## 12. Resultado Arquitetural

A primeira implementação assim:

```text
                       PagedText
                           │
                     ┌─────┴─────┐
                     │   Proxy   │
                     └─────┬─────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
            lines         text         bytes
              │            │            │
              └────────────┼────────────┘
                           │
                        Cursor
                           │
                     change buffer
                           │
                        Commit
                           │
                    ┌──────┴──────┐
                    │             │
                 Kind          PageStore
                    │             │
                 filling       pages
                    │             │
                    └──────┬──────┘
                           ▼
                      physical file
```

E o **verdadeiro contrato** do sistema fica muito simples:

1. O arquivo é texto normal.
2. As páginas são consecutivas.
3. Filling é semanticamente neutro.
4. Leitura pode ser livre.
5. Acesso pode ser forward, reverse, randômico ou contínuo.
6. Alterações passam pelo cursor/engine.
7. Commit é atômico.
8. Nenhuma estrutura global é necessária na v0.
9. Índices são uma otimização posterior, não parte do modelo.

O principal calo, portanto, **não é performance**. É acertar o algoritmo de *repacking + commit atômico* de forma que uma edição arbitrária possa adicionar/remover páginas sem nunca deixar o arquivo em estado parcialmente escrito.

Se acertarmos esse núcleo, todo o resto — IODB, logs, índices, documentos enormes, arquivos estruturados — passa a ser simplesmente **uma forma diferente de interpretar a mesma sequência paginada de texto**.
