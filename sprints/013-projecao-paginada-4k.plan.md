# 013 — Plano: projecao-paginada-4k

Plano do sprint 013 (feature 2.5).

## Objetivo

Remover o teto de RAM da projecao. Hoje `projection` e uma variavel de closure
viva (`src/io-engine.js:95`), reconstruida inteira a cada `open()`: um store nao
pode exceder a memoria do processo. Esta feature troca isso por paginas de 4096
bytes alinhadas, escritas manualmente, das quais so a pagina que contem a chave
precisa ser carregada.

O `cat` continua funcionando: uma chave por linha, padding com espacos ate fechar
a pagina. `sed -n` mostra uma pagina.

## Ponto de partida — pagedtext/

Decisao do usuario: **evoluir `pagedtext/pagedtext.js` no lugar**, preservando a
interface publica, e o `io-engine` passa a consumi-lo. E a Phase 1 do
`pagedtext/ROADMAP.md` feita dentro do proprio arquivo.

O que o prototipo v0 ja da: o vocabulario e a forma da API — `kind`, `filling`,
`cursor`, `flush` atomico, `pages()`. Isso e real e permanece.

O que ele **nao** da, e este sprint tem que construir (verificado na leitura, nao
suposto):

- **carrega o arquivo inteiro em RAM** (`readFile` -> `_lines`, `pagedtext.js:170`).
  E exatamente o problema que 2.5 existe para resolver;
- **sem acesso randomico por chave** — nao ha mapa chave->pagina; o acesso e
  posicional sobre o array ja carregado;
- **paginas nao alinhadas em 4096** — `packPages` empacota por byte count e
  `renderPages` concatena, entao o offset de uma pagina depende do conteudo de
  todas as anteriores. Sem offset multiplo de 4096 nao ha `writeSync` posicionado,
  e sem isso nao ha "escrita O(paginas sujas)";
- **e assincrono** — o `io-engine` escreve com `appendFileSync`/`writeFileSync`
  dentro da secao critica do lock (feature 2.2/2.3). `await` ali dentro nao e
  detalhe, e reabertura da secao critica. O nucleo paginado precisa de um caminho
  sincrono.

## O que `pagedtext/docs/` resolve (11 documentos, lidos)

Os docs sao a conversa de design que precedeu o prototipo. Tres deles atacam
diretamente problemas deste sprint, e mudam decisoes que eu tinha tomado por
conta propria:

### 1. Padding como campo sintatico — resolve "como marcar o fim da pagina"

`05-csv-tipado-formato-texto.md`. Eu ia usar espacos ate fechar os 4096 bytes,
como o requisito de 2.5 diz. O doc mostra por que isso e fragil e propoe algo
melhor: o padding e um **campo CSV extra no ultimo registro da pagina**.

```text
name:str,age:int
Ana,26
Bob,31
Carol,42,············,
```

A regra: `padding := "," + spaces + ","`, so no ultimo registro fisico da pagina.

Por que importa: um editor que remove trailing spaces, normaliza newline ou
garante newline final **nao consegue destruir o padding**, porque ele contem
delimitadores reais. Mesmo reduzido a `,,` a estrutura sobrevive. Padding de
espacos puros, que era o meu plano, morre no primeiro editor que tocar o arquivo.

### 2. Cristalizacao monotonica — resolve o layout de pagina cheia

`03-arquitetura-stream-projection-index.md`. Uma pagina com slots livres e
**esparsa** e cada linha carrega sua chave. Quando enche, **cristaliza**: a
posicao passa a determinar a identidade e a chave pode sair da linha.

O doc confirma que no iodb a cristalizacao e **monotonica** — nao ha remocao
fisica, um objeto deletado recebe um patch com null. Isso simplifica: nao
preciso do caminho crystal->sparse.

### 3. Endereco = pagina + linha — o indice nao precisa saber do resto

Mesmo doc. O indice aponta para um **endereco** (pagina + linha) e a **pagina
resolve a identidade**. Consequencia: quando uma pagina cristaliza, o indice
nao muda. Isso reduz o acoplamento com 2.4, que era a minha ressalva sobre
comecar por 2.5 antes de 2.4.

Verifiquei a afirmacao dos docs sobre o XOR contra o codigo: e real,
`src/hash.js:104` — `key = sha64(payload) XOR sha64(prevKey)`.

### 4. Cache de paginas visitadas, nao o arquivo inteiro

`08-pagedtext-implementacao.md`. `pages` e cache das paginas visitadas; cada
pagina guarda os offsets das suas proprias linhas ao ser carregada — parse
natural da pagina, nao indice global. Acesso e O(n) em paginas e O(1)/O(log n)
dentro. E exatamente o que falta no `pagedtext.js` de hoje.

O doc tambem alerta para um calo que eu nao tinha registrado: **inserir muda os
offsets de todas as paginas seguintes**, entao offset fisico nao pode ser
identidade de pagina. A identidade e a posicao na sequencia logica.

## A armadilha central — dois layouts de pagina

O requisito ja avisava que a semantica nao e comutativa. A leitura confirma e
piora: `append` (`src/io-engine.js:599`) empurra o registro inteiro numa lista,
**sem chave nenhuma**. A projecao de um store `append` e um array posicional.

"Uma chave por linha, ordenadas" nao descreve um array. Decisao do usuario:
**dois layouts**.

| reducer | projecao | layout de pagina | ordenacao |
|---|---|---|---|
| `merge`, `assign` | objeto/mapa | ordenada por chave | chave (radix, ja ordenada) |
| `append` | array posicional | sequencial | posicao de aplicacao |

Ordenar por chave numa pagina nao pode perder a ordem de aplicacao: `merge` tem
tombstones (`src/io-engine.js:592`, `if (v === null) delete acc[k]`), entao
`{a:1}` depois `{a:null}` deleta e o inverso mantem.

## Bug pre-existente a corrigir junto

`src/io-engine.js:402` usa `{ ...projection }` onde o caminho normal usa
`_projCopy()` (`:365`, que preserva array). Num store `append` a projecao e um
array, e o spread a converte silenciosamente em objeto. So atingivel no ramo de
re-verificacao sob concorrencia — que e justamente onde ninguem olha.

Uma linha. Cabe neste sprint porque e o mesmo codigo que a paginacao vai tocar.

## Correcoes de mapa ja aplicadas

As features 2.4 e 2.5 apontavam para `io-engine.js` na raiz — caminho que o
sprint 012 mudou. `sprint files 2.5` reportava "arquivo nao encontrado".
Corrigido para `src/io-engine.js` nas duas, e `pagedtext/pagedtext.js` declarado
como arquivo de ambas (substrato, decisao do usuario).

## Passos

1. **Nucleo paginado sincrono em `pagedtext/pagedtext.js`.** Header versionado
   (magic + versao + page_size) na pagina 0, paginas de 4096 alinhadas,
   `readSync`/`writeSync` posicionados por pagina. **Cache de paginas visitadas**
   (doc 08) em vez do array `_lines` inteiro; cada pagina carregada guarda os
   offsets das suas proprias linhas. Identidade de pagina e a posicao na
   sequencia logica, **nao** o offset fisico (doc 08, calo 7).
   Interface publica preservada — `test.js` continua passando.
   - verify: `bun pagedtext/test.js`

2. **Padding como campo sintatico** (doc 05), nao espacos soltos:
   `padding := "," + spaces + ","`, apenas no ultimo registro fisico da pagina.
   Sobrevive a editor que remove trailing space.
   - verify: escrever pagina, rodar `sed -i 's/ *$//'`, reabrir e conferir que as
     fronteiras de pagina continuam legiveis.

3. **Os dois layouts + cristalizacao.** Pagina ordenada por chave (merge/assign)
   e pagina sequencial (append), com o layout no header. Pagina esparsa carrega
   a chave por linha; ao encher, **cristaliza** e a posicao passa a determinar a
   identidade (doc 03). Cristalizacao e monotonica — sem caminho de volta.
   - verify: teste novo cobrindo os dois layouts, tombstone, ordem, e a
     transicao esparsa -> cristal.

4. **Teste na suite.** `pagedtext/test.js` esta **fora** da suite hoje (o `utest`
   casa `.test.js`/`.t.js`; baseline: 16 arquivos, 308 assercoes). Renomear para
   a convencao para que a regressao seja pega.
   - verify: `bun ../utest/utest.js .` conta o arquivo novo.

5. **Ligar no `io-engine`.** `projection` deixa de ser closure viva; `get()`
   carrega so a pagina da chave. `.yaml` legivel passa a ser derivado sob demanda.
   - verify: projecao identica antes/depois nos tres reducers.

6. **Corrigir `src/io-engine.js:402`** para `_projCopy()`.
   - verify: teste de concorrencia com store `append`.

## Fora de escopo (registrado, nao feito aqui)

Os docs descrevem bem mais do que 2.5 pede. Nao entra neste sprint:

- **CSV tipado no header** (`name:str,age:int?,email:str@!`) — doc 05. E formato
  de projecao flat/tabular; 2.5 pagina a projecao que ja existe.
- **Planner com local settle / bounded shift / rebuild** — docs 09 e 10. E a
  Phase 2 do roadmap do pagedtext.
- **Indices secundarios, posting lists, delta encoding** — docs 01 e 02. E 2.4.
- **`text.bytes`, reverse view, blocks** — doc 07. Phase 5.

## Criterio de pronto

- projecao identica antes/depois em **todos** os reducers (append, merge, assign);
- escrita O(paginas sujas), nao O(tamanho da projecao);
- store maior que a RAM configurada abre e responde `get`;
- todo offset de pagina multiplo de 4096;
- `cat` de uma pagina e texto legivel; tombstone sobrevive a paginacao; ordem
  preservada em append;
- **o padding sobrevive a um editor que remove trailing spaces** (doc 05);
- **pagina cheia cristaliza** e a posicao resolve a identidade (doc 03);
- suite verde, sem regressao no bench de escrita (2.1).
