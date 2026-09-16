import {
  parseTurns, tokenize, buildIDF, tfidfVector, cosineSim,
  chooseCuts, groupTurns, slugify, slugifyGroup, splitFile, fragmentFilename,
} from './splitchat.js'

const FIXTURE = `# Conversa de teste

**User:** Anonymous
**Created:** 1/1/2026 10:00:00
**Link:** [https://chatgpt.com/c/abc](https://chatgpt.com/c/abc)

## Prompt:
1/1/2026, 10:00:00 AM

Como funciona o sistema de arquivos e inodes no linux?

## Response:
1/1/2026, 10:00:05 AM

# Inodes no linux

Um inode guarda metadados do arquivo: tamanho, permissoes, timestamps.
O filesystem usa inodes para localizar blocos de dados no disco.

## Prompt:
1/1/2026, 10:05:00 AM

E como o kernel usa inotify para observar mudancas nesses inodes?

## Response:
1/1/2026, 10:05:05 AM

Inotify e uma API do kernel que notifica sobre eventos de inodes:
criacao, modificacao, remocao. Ele complementa o que vimos sobre inodes.

## Prompt:
1/1/2026, 10:10:00 AM

Mudando de assunto: como funciona indexacao BM25 para busca textual?

## Response:
1/1/2026, 10:10:05 AM

# BM25 e ranking de busca

BM25 e uma funcao de ranking que pontua documentos por relevancia a uma
query, usando frequencia de termo e frequencia inversa de documento.

## Prompt:
1/1/2026, 10:15:00 AM

E como calculamos o IDF exatamente na formula do BM25?

## Response:
1/1/2026, 10:15:05 AM

IDF pondera termos raros no corpus mais que termos comuns, usando log da
razao entre total de documentos e documentos contendo o termo, ajustando
a pontuacao final de BM25 para favorecer termos discriminativos.
`

test('parseTurns: extrai pares Prompt/Response com timestamp e headings', ({ check }) => {
  const turns = parseTurns(FIXTURE)
  check(turns.length, 4)
  check(turns[0].promptText.includes('inodes'), true)
  check(turns[0].responseTimestamp, '1/1/2026, 10:00:05 AM')
  check(turns[0].headings.length, 1)
  check(turns[0].headings[0].text, 'Inodes no linux')
  check(turns[1].headings.length, 0)
  check(turns[2].headings[0].text, 'BM25 e ranking de busca')
})

test('tokenize: lowercase, remove pontuacao, filtra tokens curtos', ({ check }) => {
  const tokens = tokenize('BM25 é uma função de ranking! (top-3, ok)')
  check(tokens.includes('bm25'), true)
  check(tokens.includes('função'), true)
  check(tokens.includes('ok'), false)
  check(tokens.includes('de'), false)
})

test('buildIDF: termos raros no corpus recebem peso maior que termos comuns', ({ check }) => {
  const turns = parseTurns(FIXTURE)
  const idf = buildIDF(turns)
  check(idf.get('bm25') > idf.get('como'), true)
})

test('cosineSim: turnos do mesmo assunto sao mais similares que turnos de assuntos diferentes', ({ check }) => {
  const turns = parseTurns(FIXTURE)
  const idf = buildIDF(turns)
  const vectors = turns.map(t => tfidfVector(t, idf))
  const simSameTopic = cosineSim(vectors[0], vectors[1])
  const simDifferentTopic = cosineSim(vectors[1], vectors[2])
  check(simSameTopic > simDifferentTopic, true)
})

test('chooseCuts: determinístico em execuções repetidas', ({ check }) => {
  const turns = parseTurns(FIXTURE)
  const idf = buildIDF(turns)
  const a = chooseCuts(turns, idf, 2)
  const b = chooseCuts(turns, idf, 2)
  const c = chooseCuts(turns, idf, 2)
  check(JSON.stringify(a), JSON.stringify(b))
  check(JSON.stringify(b), JSON.stringify(c))
})

test('chooseCuts: corta entre o grupo de inodes e o grupo de BM25', ({ check }) => {
  const turns = parseTurns(FIXTURE)
  const idf = buildIDF(turns)
  const cuts = chooseCuts(turns, idf, 2)
  check(cuts.includes(1), true)
})

test('groupTurns: agrupa turnos respeitando os cortes', ({ check }) => {
  const turns = parseTurns(FIXTURE)
  const groups = groupTurns(turns, [1])
  check(groups.length, 2)
  check(groups[0].length, 2)
  check(groups[1].length, 2)
})

test('slugify: normaliza acentos, minusculas, separador e trunca', ({ check }) => {
  check(slugify('Inodes no Linux'), 'inodes-no-linux')
  check(slugify('BM25 e Ranking de Busca!'), 'bm25-e-ranking-de-busca')
  check(slugify('x'.repeat(50)).length <= 40, true)
})

test('slugifyGroup: usa heading do primeiro turno do grupo quando existe', ({ check }) => {
  const turns = parseTurns(FIXTURE)
  const idf = buildIDF(turns)
  const slug = slugifyGroup([turns[0], turns[1]], idf)
  check(slug, 'inodes-no-linux')
})

test('slugifyGroup: usa termos TF-IDF quando nao ha heading no grupo', ({ check }) => {
  const turns = parseTurns(FIXTURE)
  const idf = buildIDF(turns)
  const slug = slugifyGroup([turns[1]], idf)
  check(slug.length > 0, true)
  check(slug, slugify(slug))
})

test('splitFile: separa a conversa em fragmentos por assunto com header preservado', ({ check }) => {
  const fragments = splitFile(FIXTURE, { targetTurnsPerGroup: 4 })
  check(fragments.length, 2)
  check(fragments[0].content.includes('# Conversa de teste'), true)
  check(fragments[0].content.includes('Turnos 1-2 de 4'), true)
  check(fragments[0].content.includes('inodes'), true)
  check(fragments[1].content.includes('BM25'), true)
})

test('splitFile: determinístico byte a byte em execuções repetidas', ({ check }) => {
  const a = splitFile(FIXTURE, { targetTurnsPerGroup: 4 })
  const b = splitFile(FIXTURE, { targetTurnsPerGroup: 4 })
  check(JSON.stringify(a), JSON.stringify(b))
})

test('fragmentFilename: numera com zero-padding e usa o slug', ({ check }) => {
  check(fragmentFilename(0, 'inodes-no-linux'), '01-inodes-no-linux.md')
  check(fragmentFilename(9, 'bm25'), '10-bm25.md')
})
