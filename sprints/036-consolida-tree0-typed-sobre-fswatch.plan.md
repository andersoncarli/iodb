# 036 — Plano: consolida tree0+typed sobre fswatch

## Objetivo

Consolidar duas explorações livres soltas em `fswatch/` (`tree0/` e `typed/`) numa
base única e coerente, e usá-la para acelerar o scan inicial do `fswatch.js` já
existente — sem duplicar o daemon de watch 24x7, que já roda e está confirmado
(features 6.1-6.4).

## Contexto

- **`fswatch/tree0/`** — protótipo Q&D inicial: materializa a árvore do FS num CSV
  paginado, sem tipagem. `fswatch-tree-qd.js` tem um bug de sintaxe (parêntese
  faltando: `if (resolve(child) === out continue`) — não roda. `tree-build.js` é uma
  segunda tentativa, funcional, mas com o mesmo objetivo do que já existe em
  `typed/`.
- **`fswatch/typed/`** — evolução: `typed.js` (Type Tree — tipos nomeados,
  autorreferentes, resolvidos por nome) + `typedtree.js` (topologia genérica sobre
  registros) + `lazytree.js` (topologia de FS com stat/hash lazy e memoizados) +
  `tree.js` (CLI que já materializa `tree.csv` em dezenas de segundos, sem stat()).
  `TYPED.md` documenta a convenção (frontmatter semântico, Type Tree, Schema como
  tipo, serializers desacoplados). Tem testes (`test/typed.t.js`,
  `test/typedtree.t.js`) e chats de origem em `chats/`.
- Problema: `typed/tree.js` **não usa** `typed.js`/`typedtree.js` de fato — escreve o
  header CSV manualmente ao invés de resolver o schema pelo Type Tree.
- `fswatch/fswatch.js` **já é** o servidor de observação 24x7 completo e testado:
  `scan()`, `watch()` recursivo via `node:fs.watch`, `reconcile()`, `MetadataStore`
  sobre o engine iodb. O scan inicial (`Scanner`/`describe()`) faz `lstat()` por
  entrada — caro em árvores grandes — enquanto `typed/lazytree.js` + `tree.js` fazem
  a topologia sem tocar `stat()`, coerente com TYPED.md §19 ("Relação com fswatch").

## Fora de escopo

- Reescrever `fswatch.js` além do ponto de bootstrap — o resto já funciona e está
  confirmado.
- Serializers adicionais (JSON, MD), campos calculados, binders de linguagem externa
  (TYPED.md §11-16) — YAGNI agora.
- Hash de conteúdo, deltas de timestamp Base64 — fase futura, conforme
  `tree0/README-fswatch-tree-qd.md`.

## Passos

1. **Arquivar `tree0/`**: mover `fswatch/tree0/` inteiro para
   `fswatch/docs/archive/tree0/` (preservado para consulta, não apagado). Acrescentar
   nota no README movido explicando que foi superado por `fswatch/typed/`.

2. **Ligar `tree.js` ao Type Tree real** (`fswatch/typed/tree.js` +
   `fswatch/typed/typed.js`): trocar o header CSV hardcoded (linha 16) por schema
   construído via `Typed()`/`builtins()`/`t.schema(...)`, resolvendo `ftype`, `pk`,
   `node-id`, `node-id-delta` pelo Type Tree. Usar `typedtree.js` (`TypedTree`) para
   representar a árvore em memória quando for necessário navegar/consultar, não só
   serializar.

3. **Bootstrap rápido para `fswatch.js`**: adicionar um modo de scan inicial em
   `FSWatch()`/`Scanner` que usa `LazyTree` para materializar a topologia primeiro
   (sem stat) e resolve metadata sob demanda, mantendo `watch`/`reconcile` inalterados.
   Ativado por uma opção explícita (ex.: `raw.bootstrap === 'typed'`) para não quebrar
   o caminho atual.

4. **Testes**: adaptar `fswatch/typed/test/*.t.js` ao padrão `utest` do projeto (ver
   `fswatch/fswatch.t.js`) e cobrir a integração do bootstrap típado.

5. `sprint test` → `sprint eval 6.5 --yes` (🟢) → `sprint eval 6.5` com o humano (🔵).

## Arquivos críticos

- `fswatch/typed/tree.js`, `typed.js`, `typedtree.js`, `lazytree.js` — núcleo a
  conectar.
- `fswatch/fswatch.js` — `Scanner`, `describe`, `FSWatch` — ponto de integração.
- `fswatch/typed/TYPED.md` — especificação (§3, §5-6, §19).
- `fswatch/tree0/*` → `fswatch/docs/archive/tree0/*`.
- `fswatch/typed/test/*.t.js`, `fswatch/fswatch.t.js` — testes.

## Verificação

- `bun fswatch/typed/test/typed.t.js` e `typedtree.t.js` continuam passando.
- `bun fswatch/typed/tree.js <dir-grande> /tmp/tree.csv` produz CSV com header
  resolvido via Type Tree (não string hardcoded), mesma velocidade de hoje.
- `sprint test` (roda `utest fswatch.t.js --force`) passa, incluindo o novo bootstrap.
- `fswatch.js` com `bootstrap: 'typed'` produz o mesmo conjunto de entradas que o
  caminho `describe()`-based, com ganho de velocidade.
