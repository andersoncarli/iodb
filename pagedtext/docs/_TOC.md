# Índice: Técnicas e Arquitetura de PagedText

Transcrição organizada da conversa ChatGPT sobre índices de valores, IODB e PagedText. Original: [00-chat-pagedtext.md](./00-chat-pagedtext.md)

---

## [01-indice-tecnicas-valores.md](./01-indice-tecnicas-valores.md)
**Índices e Técnicas de Valores**

Técnicas fundamentais de construção e manutenção de índices secundários sobre storage KV:
- Índice invertido (valor → IDs)
- Índice B+Tree ordenado para range queries
- Hash index para igualdade
- Bitmap index para baixa cardinalidade
- Posting lists compactos com delta encoding e varints
- Três estratégias de manutenção: in-place, append+tombstone, LSM-style
- Arquitetura proposta: KV append-only + índices invertidos + posting files compactos + compaction

---

## [02-hash-progressivo-extensivel.md](./02-hash-progressivo-extensivel.md)
**Hash Progressivo e Extensível**

Modelo de endereçamento único do IODB:
- Crescimento binário: cada nível agrega 1 bit, dobrando capacidade virtual
- Estrutura de nível progressivo: level 1 (2 bits, 4 slots) → level 2 (3 bits, 8 slots) → ...
- Transformação (level, slot) → object address global, sem tabela de tradução
- Índices secundários: value → sorted array de object IDs compactos
- Simetria: hash → endereço único; value → conjunto de endereços
- PostingSet adaptativo: scalar, sorted array, paged array ou bitmap conforme cardinalidade

---

## [03-arquitetura-stream-projection-index.md](./03-arquitetura-stream-projection-index.md)
**Arquitetura: Stream, Projection e Index**

Tripé fundamental do IODB:
- **Stream** (append-only): histórico imutável, responde "o que aconteceu?"
- **Projection** (materializada): estado atual, recuperável do stream
- **Index** (acesso): value → target IDs, consulta otimizada
- Independência: podem ser perdidos e reconstruídos (exceto stream = verdade)
- Event sourcing + materialized views: cadeia de patches linear, nunca branches
- Cristalização monotônica: página esparsa → cristal (nunca volta)
- Separação crítica: índice aponta para endereço, página resolve identidade
- Append-only em todas as camadas: objetos, patches e índices

---

## [04-projecao-tabular-hierarquica.md](./04-projecao-tabular-hierarquica.md)
**Projeção Tabular e Hierárquica**

Dois modelos de projeção sob mesmo mecanismo:
- **Dinâmica**: estrutura definida pelos objetos, admits novos campos dinamicamente
- **Flat/Tipada**: schema pré-definido, representação tabular SQL-like
- Ambas usam stream → projector → pages
- Índices agnósticos: (path, value) → targetIds (path pode ser coluna ou hierarquia)
- Diferença não é no mecanismo, mas no resolver de path/schema
- Preserva independência entre stream, projection e index sem transformar em banco relacional

---

## [05-csv-tipado-formato-texto.md](./05-csv-tipado-formato-texto.md)
**CSV Tipado e Formato de Texto**

Formato canônico para projeção flat:
- CSV com types no header: `name:str,age:int?,email:str@`
- Símbolos: `?` nullable, `@` indexed, `!` unique
- Padding de página como campo extra CSV: `Carol,42,············,`
- Propriedade: parser externo vê dados tabulares, IODB vê páginas+slots
- Inspectability: `cat`, `grep`, `awk` continuam funcionando
- Três propriedades emergem: inspectability, recoverability, physical locality
- Princípio: tudo persistido permanece inteligível como texto

---

## [06-pagedtext-primitiva.md](./06-pagedtext-primitiva.md)
**PagedText: Primitiva de Storage Textual**

Abstração independente de armazenamento de texto paginado:
- Factory: `PagedText({ kind: 'csv|clike|json|yaml', path, ... })`
- `kind` é codec de filling+boundaries, não parser do conteúdo
- Proxy transparente: acesso como Array/String, paginação oculta
- Acesso randômico por páginas (offset = page * PAGE_SIZE)
- Duas visões: random (text[n]) + sequential (for line of text)
- Leitura: livre por qualquer ferramenta; escrita: protocolada via PagedText
- Separação perfeita: logical (lines/blocks) vs. physical (pages/offsets)

---

## [07-pagedtext-api-dx.md](./07-pagedtext-api-dx.md)
**API e DX (Developer Experience) do PagedText**

Interface deliberadamente pequena, array-like:
- Array: `text[n]`, `length`, `push`, `pop`, `splice`, iterator
- Blocos: `text.block(10)` sem corresponder necessariamente a página
- Texto contínuo: `text.text.slice()`, `text.text.indexOf()`
- Reverso: `text.reverse()` como view, não materializando arquivo
- Binário: `text.bytes` stream lógico, `text.bytes.read(offset, size)`
- Múltiplas abstrações: lines, blocks, text, bytes, reverse sobre um arquivo
- API física secundária: `text.physical.page(10)`, `text.physical.offset(10)`
- Teste de qualidade: programador ignora paginação, acessa como Array RAM

---

## [08-pagedtext-implementacao.md](./08-pagedtext-implementacao.md)
**Implementação do PagedText v0**

Estratégia v0: sem índice global, foco em correção:
- Núcleo: PageStore (páginas), Kind (filling), Cursor (buffer), Proxy (DX)
- Página carrega offsets de linhas internamente: O(n) em páginas, O(log n) dentro
- Cursor: operações sem modificar arquivo (insert/delete/replace como changelog)
- Commit: redistribuição de páginas afetadas
- Atomicidade v0.1: temp file → fsync → rename
- Futuro v0.2: paged commit com local settle, bounded shift ou rebuild
- Calos: achar linha (resolvido por cache de página), commit (resolvido por planner), offsets mudam (expectativa arquitetural)
- Reverse barato: walk pages in reverse, scan lines reverse
- Filling: `kind` reconhece; não expor na API normal
- Proxy pequeno: handler simples, propriedades reservadas

---

## [09-planner-commit.md](./09-planner-commit.md)
**Planner de Commit e Estratégias**

Engine de otimização de escrita com três estratégias:
- **Local settle**: usa filling de vizinhos até orçamento (maxShiftBytes)
- **Bounded shift**: propaga mudança até página k, depois abandona local
- **Rebuild**: reconstrói arquivo inteiro se shift ficar caro
- Filling como "liquidez": espaço vazio = capacidade para futuras mutações
- Cursor separado: `save()` persiste working state, `flush()` única escrita real
- Invariante: `cursor.save()` logicamente puro, `cursor.flush()` toca arquivo
- Dois artefatos: source file (imutável até flush) + cursor state (recuperável)
- API: `edit(c => { c.seek(...); c.insert(...) })` auto-flush, ou manual `c.commit()`

---

## [10-planner-high-level.md](./10-planner-high-level.md)
**Planner: Design de Alto Nível**

Abstração correta do planejamento de commit:
- Unidade: região, não página; plan(pages, changes) → newPages
- Três operações: SELECT (regiões afetadas), REBUILD (aplicar changes), REPAGE (novo padding ótimo), COMMIT (escrita sequencial)
- `maxShiftBytes` pergunta: até onde expando a região sob orçamento?
- Regiões independentes: possível agrupar e processar separadamente
- Filling uniforme: capacidade residual distribuída entre páginas
- Afinidade: `kind` fornece hints (strong/medium/weak) sobre quebra de objetos
- Não precisa preencher tudo: quebra aceitável se objetos > page size
- Resultado: Planner guloso, sem solver, decide novo estado físico
- Committer materializa sequencialmente para máximo throughput

---

## [11-filling-discreto.md](./11-filling-discreto.md)
**Filling: Discreto e Semântico**

Princípio: filling é capacidade física, não conteúdo lógico:
- Default discreto: espaços normais, invisíveis para ferramentas externas
- Opcional explícito: `filling: 'comment'` mostra //- para debugging
- Não significa invisível: PagedText detecta filling, mas Proxy não vê
- Separação: logical content vs. physical (content + filling)
- `kind` responde: "onde coloco N bytes sem quebrar semântica?"
- Exemplos por formato: texto (espaço), C/JS (espaço/comentário), CSV (espaço em campo), JSON (whitespace válido), Markdown (newlines neutros)
- Propriedade rara: arquivo normal (.js, .csv, .json, .md) + paginação física oculta
- Definição final: transforma texto contínuo em páginas com mínimo impacto semântico

---

## Princípios Arquiteturais Convergentes

1. **Separação lógico/físico**: usuário trabalha em espaço contínuo, engine materializa páginas
2. **Append-only em camadas**: stream, projection, index são todos imutáveis historicamente
3. **Cristalização monotônica**: estado só evolui, nunca regride
4. **Filling como liquidez**: não é desperdício, é capacidade para futuras mudanças
5. **Transparência de sintaxe**: um `.js` continua sendo `.js`, `.csv` continua sendo `.csv`
6. **Recuperabilidade total**: perder projection/index é OK, stream é verdade
7. **Planner guloso**: não precisa de solver global, decisões locais ótimas
8. **Kind agnóstico**: core não conhece semântica, kind conhece mínimo necessário

---

## Próximos Passos (Não na Conversa)

- Implementação v0.1: validar modelo, Proxy, cursor, kinds, reverse, atomicidade
- Implementação v0.2: planner com local settle + bounded shift + rebuild
- Formatos: CSV (fácil), C-like (fácil), JSON (delicado), YAML (delicado)
- Índices PagedText: aplicar mesmo modelo de paginação aos índices secundários
- IODB integration: stream, projection, index como três PagedText(kind:'...')
