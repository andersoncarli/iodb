# FSWatch — Roadmap

## 1. Visão

FSWatch é um observador semântico de filesystem.

Seu papel é observar uma árvore física, manter uma representação persistente do estado conhecido e transformar mudanças físicas em eventos semânticos que possam ser consumidos por outras ferramentas.

A filosofia central:

```text
backend observa
Observer normaliza e reconcilia
SQLite mantém o estado conhecido
clusters formam views
consumers reagem
```

O filesystem continua sendo a verdade.

Eventos do kernel são apenas sinais de que a verdade pode ter mudado.

---

# 2. Estado atual — v0.1

A primeira versão estabelece a fundação:

- [x] `FSWatch(config)`
- [x] configuração via POJO
- [x] configuração via YAML
- [x] targets
- [x] include/exclude
- [x] glob
- [x] `RegExp` em configuração programática
- [x] clusters como views
- [x] clusters sobrepostos
- [x] `SOURCE`
- [x] `TESTS`
- [x] `DOCS`
- [x] `IGNORE`
- [x] expansão de `~`
- [x] scan recursivo
- [x] identidade por `(dev, ino)`
- [x] SQLite local
- [x] `nodes`
- [x] `leaves`
- [x] metadata básica
- [x] baseline persistente
- [x] observação de diretórios
- [x] routing para clusters
- [x] `create`
- [x] `delete`
- [x] `metadata_changed`
- [x] API de subscription
- [x] `scan()`
- [x] `watch()`
- [x] `stats()`
- [x] `close()`

A v0.1 deve ser entendida como **fundação funcional**, não como backend Linux definitivo.

---

# 3. P0 — Backend Linux nativo

A primeira grande evolução é substituir as limitações de `fs.watch()` por um backend explícito de `inotify`.

## 3.1 Inotify

- [ ] abrir instância `inotify`
- [ ] adicionar/remover watches
- [ ] interpretar eventos diretamente
- [ ] `IN_CREATE`
- [ ] `IN_DELETE`
- [ ] `IN_MODIFY`
- [ ] `IN_ATTRIB`
- [ ] `IN_MOVED_FROM`
- [ ] `IN_MOVED_TO`
- [ ] `IN_DELETE_SELF`
- [ ] `IN_MOVE_SELF`
- [ ] `IN_IGNORED`
- [ ] `IN_Q_OVERFLOW`

O backend deve permanecer Linux-specific.

A API pública do FSWatch não deve depender de inotify.

---

# 4. P0 — Correlação de rename/move

O kernel fornece `MOVED_FROM` e `MOVED_TO` separadamente.

FSWatch deve correlacioná-los usando:

```text
cookie
```

e, quando necessário, confirmar a identidade física usando:

```text
(dev, ino)
```

Resultado:

```js
{
  type: 'move',
  id: [dev, ino],
  from: '/old/path',
  path: '/new/path'
}
```

Não expor:

```text
IN_MOVED_FROM
IN_MOVED_TO
```

ao consumidor.

---

# 5. P0 — Watch recursivo correto

Um watch não deve ser instalado apenas no diretório raiz.

Para cada diretório observado:

```text
root
├── src
│   ├── core
│   └── ui
├── test
└── docs
```

todos os diretórios relevantes precisam ser observados.

Quando surgir:

```text
src/new
```

o Observer deve automaticamente adicionar o watch.

Quando um subtree deixar de existir:

```text
src/old/
```

seus watches devem ser removidos.

---

# 6. P0 — Filtering antes da descida

O filtro precisa distinguir:

```text
match
```

de:

```text
descend
```

Exemplo:

```yaml
exclude:
  - "**/node_modules/**"
```

Ao encontrar:

```text
project/node_modules
```

não basta ignorar seus arquivos.

O scanner deve poder concluir:

```text
excluded directory
→ don't descend
→ don't install watches
```

Isso reduz drasticamente o custo em árvores grandes.

---

# 7. P0 — Reconciliação

Eventos não são garantia de consistência.

O Observer precisa ter um caminho explícito:

```text
event loss
    ↓
reconcile(root)
    ↓
scan filesystem
    ↓
compare SQLite baseline
    ↓
emit semantic differences
    ↓
update baseline
```

Implementar:

- [ ] diff de novos objetos
- [ ] diff de objetos removidos
- [ ] diff de metadata
- [ ] detecção de rename por inode
- [ ] detecção de subtree movimentado
- [ ] atualização atômica do baseline
- [ ] reconciliação parcial por subtree
- [ ] reconciliação global

---

# 8. P0 — Overflow

`IN_Q_OVERFLOW` deve ser tratado como perda de confiança no fluxo de eventos.

Não tentar reconstruir eventos individualmente.

```text
IN_Q_OVERFLOW
      ↓
observer = dirty
      ↓
reconcile
      ↓
observer = consistent
```

O evento público pode ser:

```js
{
  type: 'reconcile',
  path: root,
  reason: 'overflow'
}
```

---

# 9. P1 — Coalescing

Um editor pode produzir dezenas ou centenas de eventos para uma única operação lógica.

Exemplo:

```text
write
write
write
attrib
modify
modify
close
```

O Observer deve transformar isso em uma mudança significativa:

```text
content_changed
```

ou:

```text
metadata_changed
```

Implementar:

- [ ] janela de coalescing
- [ ] debounce por inode/path
- [ ] agrupamento de eventos
- [ ] settle period
- [ ] flush de eventos pendentes
- [ ] configuração do intervalo

O objetivo é reduzir ruído sem aumentar significativamente a latência.

---

# 10. P1 — Separação metadata/content

O Observer deve distinguir:

```text
estrutura
metadata
conteúdo
```

### Estrutura

```text
create
delete
move
```

### Metadata

```text
metadata_changed
```

Exemplos:

- mtime
- mode
- ownership
- size quando aplicável

### Conteúdo

```text
content_changed
```

Só deve ser emitido como fato de conteúdo quando houver confirmação suficiente.

---

# 11. P1 — Content verification

Não calcular hash para cada evento.

Fluxo:

```text
modify
   ↓
coalesce
   ↓
stat
   ↓
settle
   ↓
hash somente se necessário
```

Implementar:

- [ ] SHA-256 inicialmente
- [ ] streaming hash
- [ ] arquivos grandes sem carregar em memória
- [ ] cache de hash
- [ ] política configurável
- [ ] `content_unchanged`
- [ ] `content_changed`

Possível configuração:

```yaml
content:
  hash: sha256
  verify: changed
```

---

# 12. P1 — Hardlinks

Como a identidade é `(dev, ino)`, hardlinks precisam ser tratados explicitamente.

Um inode pode possuir:

```text
a.txt
b.txt
```

ao mesmo tempo.

O modelo deve distinguir:

```text
object identity
```

de:

```text
path identity
```

Implementar:

- [ ] múltiplos paths por inode
- [ ] criação de hardlink
- [ ] remoção de um hardlink
- [ ] objeto desaparecendo somente quando o último link desaparece
- [ ] testes específicos

---

# 13. P1 — Symlinks

Definir claramente a política.

Por padrão:

```text
symlink != target
```

FSWatch deve observar o link como objeto próprio e não atravessar symlinks durante o scan recursivo.

Configuração futura:

```yaml
links:
  follow: false
```

Possíveis modos:

```text
never
within-target
always
```

A política deve evitar ciclos.

---

# 14. P1 — SQLite como baseline robusto

A estrutura inicial deve evoluir sem perder simplicidade.

Implementar:

- [ ] transações de scan
- [ ] upsert em lote
- [ ] delete em lote
- [ ] WAL configurável
- [ ] índices por `(dev, ino)`
- [ ] índices por parent
- [ ] lookup por identidade
- [ ] subtree queries
- [ ] atomicidade de reconcile
- [ ] schema version
- [ ] migration inicial

A regra permanece:

> SQLite guarda estado conhecido; não guarda regras de negócio.

---

# 15. P1 — Histórico opcional

Histórico durável pertence conceitualmente ao IODB.

FSWatch não deve duplicar esse mecanismo.

Porém pode existir uma integração simples:

```text
FSWatch event
      ↓
IODB.in(...)
```

Implementar futuramente:

- [ ] adapter IODB
- [ ] persistência de eventos
- [ ] origem do evento
- [ ] timestamp
- [ ] correlation id
- [ ] replay

Sem transformar FSWatch em um segundo IODB.

---

# 16. P1 — Origin / causality

Uma ferramenta que reage a eventos pode provocar novos eventos.

Exemplo:

```text
SOURCE changed
    ↓
timestamp-sync
    ↓
utimes()
    ↓
metadata_changed
    ↓
timestamp-sync
    ↓
...
```

Precisamos de causalidade.

Possível modelo:

```js
{
  type: 'metadata_changed',
  origin: 'timestamp-sync',
  correlation: '...'
}
```

Implementar:

- [ ] origin
- [ ] correlation id
- [ ] suppress/acknowledge expected events
- [ ] proteção contra loops
- [ ] timeout de correlação

---

# 17. P1 — Timestamp synchronization

Este é um dos casos de uso que motivou a ferramenta.

Exemplo:

```text
foo.ts
foo.test.ts
foo.md
```

Uma operação pode alterar mtime de arquivos sem alterar conteúdo.

FSWatch deve permitir ao consumidor distinguir:

```text
metadata_changed
```

de:

```text
content_changed
```

e então uma regra externa pode sincronizar timestamps.

Importante:

```text
mtime
```

pode ser corrigido.

```text
ctime
```

não deve ser tratado como timestamp arbitrariamente restaurável.

FSWatch apenas observa.

A política de correção pertence ao consumer.

---

# 18. P1 — Cluster API

A API atual deve evoluir para uma interface consistente:

```js
fs.SOURCE.on(fn)
fs.SOURCE.off(fn)

fs.SOURCE.scan()
fs.SOURCE.find(...)
fs.SOURCE.stats()
```

Possíveis operações futuras:

```text
each
find
filter
paths
entries
```

Sem transformar Cluster em um ORM.

---

# 19. P2 — Queries

Como o SQLite já contém a árvore, podemos oferecer consultas rápidas:

```js
fs.SOURCE.find('**/*.ts')
```

ou:

```js
fs.SOURCE.entries()
```

Possíveis consultas:

- [ ] por path
- [ ] por glob
- [ ] por inode
- [ ] por tipo
- [ ] por tamanho
- [ ] por mtime
- [ ] por classe de cluster
- [ ] subtree

A camada de query deve continuar independente do observer.

---

# 20. P2 — Estatísticas

Estatísticas operacionais:

```js
fs.stats()
```

podem incluir:

```text
directories
files
watches
events
events/sec
coalesced
reconciliations
overflows
bytes
hashes
errors
```

Por cluster:

```js
fs.SOURCE.stats()
fs.TESTS.stats()
```

---

# 21. P2 — Performance

Benchmarks reais:

- [ ] scan de 1K arquivos
- [ ] scan de 10K
- [ ] scan de 100K
- [ ] árvore profunda
- [ ] árvore larga
- [ ] muitos clusters
- [ ] clusters sobrepostos
- [ ] bursts de eventos
- [ ] arquivos grandes
- [ ] rename massivo
- [ ] overflow

Meta:

> observar sem se tornar uma parte perceptível da carga normal do sistema.

---

# 22. P2 — Backend fanotify

Depois do backend inotify estar sólido, avaliar `fanotify`.

Não substituir automaticamente.

Comparar:

```text
inotify
├── excelente para árvore de diretórios
├── identidade por path/event
└── watch por diretório

fanotify
├── observação mais ampla
├── semântica diferente
├── requisitos de privilégio
└── adequado a outros cenários
```

A arquitetura deve permitir:

```js
FSWatch({
  backend: 'inotify'
})
```

e futuramente:

```js
FSWatch({
  backend: 'fanotify'
})
```

---

# 23. P2 — Persistência configurável

Por padrão:

```text
bun.sqlite
```

Mas permitir:

```yaml
storage:
  path: "./state/fswatch.sqlite"
```

e eventualmente:

```yaml
storage:
  memory: true
```

para testes ou processos efêmeros.

---

# 24. P2 — Resiliência

Tratar:

- [ ] filesystem desmontado
- [ ] diretório removido
- [ ] permissões alteradas
- [ ] permission denied
- [ ] arquivo desaparecendo durante stat
- [ ] rename concorrente
- [ ] arquivo sendo escrito durante scan
- [ ] processo reiniciado
- [ ] SQLite corrompido
- [ ] watch invalidado

Princípio:

> filesystem concorrente e inconsistente durante uma operação é condição normal, não exceção extraordinária.

---

# 25. Casos de uso

## 25.1 Timestamp synchronization

```text
arquivo A
arquivo B
arquivo C
    │
    ▼
FSWatch
    │
    ▼
metadata_changed
    │
    ▼
sync rule
    │
    ▼
mtime sincronizado
```

Útil para grupos de arquivos relacionados:

```text
foo.ts
foo.test.ts
foo.md
```

---

## 25.2 Desenvolvimento / IDE

Observar:

```text
SOURCE
TESTS
DOCS
```

e alimentar ferramentas em tempo real.

Exemplo:

```text
*.ts changed
    ↓
compiler / indexer

*.test.ts changed
    ↓
test runner

*.md changed
    ↓
documentation index
```

---

## 25.3 Indexação

Um indexador pode consumir:

```js
fs.SOURCE.on(event => index.update(event))
```

Sem precisar implementar sua própria observação de filesystem.

---

## 25.4 Build incremental

```text
src/*.ts
    ↓
FSWatch
    ↓
content_changed
    ↓
build dependency graph
    ↓
rebuild affected modules
```

O watcher não sabe nada sobre TypeScript ou build systems.

---

## 25.5 Test runner

```text
TESTS
  ↓
changed
  ↓
invalidate tests
  ↓
run affected tests
```

---

## 25.6 Documentação

```text
DOCS
  ↓
changed
  ↓
markdown parser
  ↓
documentation index
```

---

## 25.7 Git/project monitoring

Um cluster pode representar:

```yaml
GIT:
  targets:
    - "~/project"
  include:
    - ".git/**"
```

ou uma view de arquivos relevantes fora do `.git`.

---

## 25.8 Backup / synchronization

Um consumer pode receber:

```text
create
modify
move
delete
```

e atualizar outro filesystem ou serviço.

FSWatch não implementa o backup.

Ele fornece os fatos.

---

## 25.9 Cache invalidation

```text
SOURCE
   ↓
content_changed
   ↓
cache.invalidate(path)
```

---

## 25.10 Security / auditing

Um consumidor pode observar:

```text
/etc-like tree
```

e registrar:

```text
create
delete
move
metadata_changed
```

em um sistema de auditoria.

A auditoria não deve ser responsabilidade do FSWatch.

---

## 25.11 File synchronization

Dois lados podem ser conectados:

```text
FSWatch A
   ↓
semantic events
   ↓
transport
   ↓
consumer
   ↓
filesystem B
```

---

## 25.12 Knowledge base / AI

Uma árvore de documentos pode ser observada:

```text
~/KB
├── notes
├── projects
├── docs
└── ...
```

Um consumer pode atualizar automaticamente:

```text
document index
embedding index
metadata index
search index
```

quando arquivos mudarem.

FSWatch continua agnóstico em relação à IA.

---

# 26. Não objetivos

FSWatch não deve se tornar:

- um banco de dados de aplicação
- um ORM
- um build system
- um backup system
- um sync engine
- um indexador
- um parser de documentos
- um sistema de regras
- um scheduler
- um daemon monolítico
- uma abstração multiplataforma artificial

Essas funções podem consumir seus eventos.

---

# 27. Ordem de implementação

A ordem recomendada é:

```text
v0.1
 │
 ├── config
 ├── scanner
 ├── SQLite
 ├── clusters
 └── basic observation
       │
       ▼
v0.2
 │
 ├── native inotify
 ├── recursive watches
 ├── rename correlation
 └── overflow
       │
       ▼
v0.3
 │
 ├── reconciliation
 ├── coalescing
 ├── settle
 └── metadata/content distinction
       │
       ▼
v0.4
 │
 ├── hardlinks
 ├── symlinks
 ├── robust SQLite transactions
 └── origin/correlation
       │
       ▼
v0.5
 │
 ├── queries
 ├── stats
 ├── performance
 └── IODB adapter
       │
       ▼
v1.0
 │
 ├── production hardening
 ├── recovery
 ├── documented API
 └── stable semantic event contract
```

O marco real da **v1.0** não é ter muitos recursos.

É conseguir afirmar:

> **Se o filesystem muda, eventualmente FSWatch converge para a verdade e entrega aos consumidores uma representação semântica consistente da mudança, mesmo quando eventos do kernel são perdidos ou chegam em rajadas.**

Esse é o contrato fundamental da ferramenta.