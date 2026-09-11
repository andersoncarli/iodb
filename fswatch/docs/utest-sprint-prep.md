# fswatch como fonte do último estado conhecido — o contrato para `utest` e `sprint-cli`

Ligada à feature [6.4](../../plans/6-fswatch/6.4-a-morte-do-split-nodes-leaves.md).

## O problema, levantado por código real

Dois projetos sibling levantam a árvore do próprio projeto do zero a cada invocação, por
caminhos diferentes, e nenhum guarda o último estado conhecido entre execuções:

- **`utest/scanner.js#walk()`** (scanner.js:16-35) — `readdirSync` recursivo puro. Sem
  `.gitignore`, sem cache, sem estado entre chamadas de `scan()`.
- **`sprint-cli/src/ontology.js#corpus()`** (ontology.js:63-85) — `git ls-files -z --cached
  --others --exclude-standard` a cada chamada, com `readdirSync` como fallback só quando o
  diretório ainda não é repo git. O uso de `git ls-files` aqui é **deliberado** — respeita
  `.gitignore` e usa a definição que o próprio projeto deu do que lhe pertence — e não deve
  ser substituído por decreto.

O `fswatch` já resolve exatamente esse problema para si mesmo: mantém um baseline
persistente, identidade por `(dev, ino)`, e o observa incrementalmente. Esta nota escreve o
contrato para que outro processo leia esse baseline sem reimplementá-lo.

## A entidade

Hoje `FSWatch(config)` deriva seu domínio de armazenamento assim (fswatch.js:274-293):

- config YAML → `<dir do yaml>/.fswatch/<nome do yaml sem extensão>`
- config POJO → `<primeiro target>/.fswatch/metadata`

Nenhum dos dois é `.fswatch/PROJECT`. A decisão desta feature: **`PROJECT` é um domínio
novo, convencionado**, não um apelido do domínio `metadata` existente — reservado para o
caso em que o consumidor é uma ferramenta de projeto (um `utest`, um `sprint-cli`) que quer
a árvore inteira do repo, e não uma configuração de clusters como `SOURCE`/`TESTS`/`DOCS`.
Um projeto que já usa `fswatch` com sua própria config YAML continua com seu próprio domínio
(`.fswatch/<config>`) sem colisão — `PROJECT` é aditivo, não substitui outro domínio.

```
<root>/.fswatch/PROJECT.dash    ← log append-only (a verdade)
<root>/.fswatch/PROJECT.yaml    ← projeção (legível)
<root>/.fswatch/PROJECT.index   ← índice de chaves
<root>/.fswatch/PROJECT.proj    ← projeção paginada (pageSize: 4096, como MetadataStore)
```

Produzida por:

```js
import { FSWatch } from 'fswatch'   // ou caminho relativo ao sibling, como hoje

const fs = await FSWatch({
  backend: 'iodb',
  PROJECT: { targets: ['.'], include: ['**/*'], exclude: [...SKIP_DIRS_do_consumidor] }
})
await fs.scan()          // baseline inicial — uma varredura, não um watch contínuo
fs.stats().database       // → '<root>/.fswatch/PROJECT' (a base, sem extensão)
```

Um consumidor que só quer ler (não observar ao vivo) não precisa manter o processo `fs`
aberto: o `.dash`/`.proj` em disco é a fonte durável, lida por um segundo processo via
`MetadataStore` ou por leitura direta do `.dash` (formato texto, ver README raiz).

## O shape de cada entry

Um entry é o que `describe()` produz (fswatch.js:204-213), guardado por `store.put()`:

```js
{
  id: 'dev:ino',        // string, a CHAVE — não um path
  parent: 'dev:ino' | null,
  name: string,          // basename
  kind: 'dir' | 'file',
  dev: number, ino: number,
  mode: number, mtime: number, ctime: number,   // epoch ms
  size: number | null,   // null para dir
  hash: string | null,   // null: fswatch não hasheia por padrão
  path?: string          // absoluto — só presente quando produzido por scan()/reconcile(),
                          // não pelo Scanner batch cru (ver fswatch.js:230 vs :325)
}
```

`store.all()` devolve `Object.values` desse mapa. Um consumidor que precisa de "lista de
arquivos relativos ao root", que é o formato que `scanner.js`/`ontology.js` produzem hoje,
faz:

```js
const files = fs.entries()
  .filter(e => e.kind === 'file')
  .map(e => path.relative(root, e.path))
```

## Staleness — quando o baseline é confiável

Nem `utest` nem `sprint-cli` rodam um processo `fswatch` de longa duração por padrão; cada
invocação é um processo novo. O contrato não assume um watcher vivo. Em vez disso:

- **Critério de staleness**: o baseline é confiável se `PROJECT.dash` existe e seu `mtime`
  é mais recente que a última escrita conhecida na árvore observada — na prática, o
  consumidor faz `fs.scan()` (uma varredura completa, não um watch) sempre que for ler,
  e trata isso como o custo de abertura. `scan()` já é incremental na escrita (upsert por
  `dev:ino`, mesma trilha usada pelo `Scanner` batch), então uma segunda varredura sobre
  uma árvore pouco mudada é barata comparada a um `readdirSync` que não reaproveita nada.
- **O ganho não é "pular o walk"** — o `fswatch` ainda varre o disco em `scan()`. O ganho é
  reaproveitar essa varredura entre `utest` e `sprint-cli` quando ambos rodam sobre o mesmo
  projeto, e ganhar identidade estável por `(dev, ino)` em vez de recomputar tudo por path
  a cada consumidor. Um watcher de longa duração (`fs.watch()`) é otimização futura, fora
  do escopo desta feature.

## Contrato de leitura — resumo para as duas pontas

| O que o consumidor quer | Como lê hoje | Como lê via `.fswatch/PROJECT` |
|---|---|---|
| `utest` — testFiles/sourceFiles | `readdirSync` recursivo em `scanner.js#walk()` | `fs.entries()`, filtrado pelo mesmo `makeFilter()` já existente |
| `sprint-cli` — corpus versionado | `git ls-files` (+ fallback `readdirSync`) | `fs.entries()` como **cache/observação** sobre a mesma lista; `git ls-files` continua sendo a definição de pertencimento — não se troca a fonte, se evita rechamar o subprocess |

Cada lado implementa seu próprio fallback (fswatch indisponível ou desatualizado → caminho
atual, sem quebrar). O contrato aqui é só a leitura: chave `id = dev:ino`, `kind`, `path`,
`mtime`, e a localização `.fswatch/PROJECT`. A escrita (quem chama `scan()` e quando) é
decisão de cada consumidor, registrada nas suas próprias features:

- `utest` → [plans/9-fswatch-baseline/9.1](../../../../utest/plans/9-fswatch-baseline/9.1-consumir-fswatch.md) (projeto sibling)
- `sprint-cli` → [plans/110-fswatch-baseline/110.1](../../../../sprint-cli/plans/110-fswatch-baseline/110.1-consumir-fswatch.md) (projeto sibling)
