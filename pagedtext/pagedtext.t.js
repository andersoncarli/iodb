import { PagedText, readGenesis, validate, kindRestrictions } from './pagedtext.js'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PS = 4096

// A REGRA DOS 3 — provar no menor tamanho que ainda exibe a propriedade.
//
// Estes testes escreviam 300 e 400 linhas write-through e mediam 440-890ms
// contra um orcamento de 1000ms por teste: passavam na maquina livre e
// estouravam sob carga de suite, num timeout que nao dizia respeito a nada que
// o teste afirma.
//
// A contagem alta nunca foi o que eles precisavam. O que cada um exige e um
// arquivo de VARIAS PAGINAS — e pagina e uma razao entre bytes e `pageSize`,
// nao um numero de registros. Encolhendo a pagina, tres paginas custam doze
// registros em vez de trezentos: a mesma propriedade, 40x mais barato, e em
// milissegundos.
//
// `PS` continua 4096 onde o valor REAL importa (alinhamento, o contrato do
// formato). `PS_MINI` e para quando o que se prova e "atravessa paginas".
const PS_MINI = 256

test('pagedtext: logical array over pages', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.js')
    writeFileSync(file, 'a\nb\nc\nd\n')
    const t = PagedText({ path: file, kind: 'clike', pageSize: 4096 })

    check(t.length, 4)
    check(t[0], 'a')
    check(t.at(-1), 'd')
    check(t.slice(1, 3).join(','), 'b,c')
    check([...t].join(''), 'abcd')
  })
})

test('pagedtext: array-like editing stays logical, filling hidden', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.js')
    writeFileSync(file, 'a\nb\nc\nd\n')
    const t = PagedText({ path: file, kind: 'clike', pageSize: 4096 })

    t[1] = 'B'
    check(t[1], 'B')
    t.push('e')
    check(t.pop(), 'e')
    t.unshift('z')
    check(t.shift(), 'z')
    t.splice(1, 1, 'BB', 'BBB')
    check([...t].join(','), 'a,BB,BBB,c,d')
    check(t.reverse().join(','), 'd,c,BBB,BB,a')
  })
})

test('pagedtext: header is versioned and page 0', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.txt')
    writeFileSync(file, 'one\ntwo\nthree\n')
    const t = PagedText({ path: file, pageSize: 4096 })
    t.flush()

    const header = readGenesis(file)
    check(header.magic, 'PAGEDTEXT')
    check(header.version, 3)
    check(header.pageSize, PS)
    // O header e o GENESIS do arquivo: so o que nunca muda. Contagem de linhas,
    // extents e chaves sao estatistica derivada e vivem no trailer, no fim —
    // e por isso que apender nao reescreve o header.
    check(header.pages, 'undefined')
    check(header.kind, 'text')
  })
})

test('pagedtext: every page offset is 4096-aligned', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'big.txt')
    // ~3 pages of ~40-byte lines
    const lines = Array.from({ length: 160 }, (_, i) => `line number ${i} with some padding text here`)
    writeFileSync(file, lines.join('\n') + '\n')
    const t = PagedText({ path: file, pageSize: 4096 })
    t.flush()

    const info = t.pages()
    check(info.length > 1, true)
    check(info.every(p => p.aligned), true)
    check(info.every(p => p.offset % PS === 0), true)

    // Tamanho = header de genesis + N paginas de dados + o trailer, todos
    // alinhados. O invariante que importa e o arquivo ser multiplo exato de PS.
    const size = statSync(file).size
    check(size % PS === 0, true)
    check(size >= PS * (1 + info.length), true)
  })
})

test('pagedtext: reopen sees the same logical text, filling invisible', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.js')
    writeFileSync(file, 'a\nb\nc\nd\n')
    const t = PagedText({ path: file, kind: 'clike', pageSize: 4096 })
    t.push('e', 'f')
    t.flush()

    const reopened = PagedText({ path: file, kind: 'clike', pageSize: 4096 })
    check([...reopened].join(','), 'a,b,c,d,e,f')

    const raw = readFileSync(file, 'utf8')
    check(raw.includes('//- pagedtext filling'), false)   // ws is the default
  })
})

test('pagedtext: page cache does not load every page for a point read', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'big.txt')
    const lines = Array.from({ length: 220 }, (_, i) => `row ${i} ${'x'.repeat(40)}`)
    writeFileSync(file, lines.join('\n') + '\n')
    const t = PagedText({ path: file, pageSize: 4096 })
    t.flush()

    // fresh handle, read one line near the start
    const t2 = PagedText({ path: file, pageSize: 4096 })
    check(t2.at(1), 'row 1 ' + 'x'.repeat(40))
    // only the page holding index 1 should be cached, not all of them
    const cached = t2._store._cache.size
    check(cached, 1)
    check(t2._store.pageCount() > 1, true)
  })
})

test('pagedtext: cursor save does not touch source, flush does', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.js')
    writeFileSync(file, 'a\nb\nc\nd\n')
    const t = PagedText({ path: file, kind: 'clike', pageSize: 4096 })
    t.flush()

    const before = readFileSync(file)
    const c = t.cursor(2)
    c.insert('X', 'Y').next().overwrite('CC').seek(0).write('A')
    check(c.dirty, true)
    c.save()
    check(Buffer.compare(readFileSync(file), before), 0)   // unchanged

    const saved = JSON.parse(readFileSync(file + '.cursor', 'utf8'))
    check(saved.dirty, true)

    const c2 = t.loadCursor()
    check(c2.pos, saved.pos)

    c.flush()
    check(Buffer.compare(readFileSync(file), before) !== 0, true)   // changed
    check(c.dirty, false)
  })
})

test('pagedtext: explicit comment filling', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'c.js')
    // enough lines to force more than one page so filling is emitted
    const lines = Array.from({ length: 200 }, (_, i) => `stmt${i}();`)
    writeFileSync(file, lines.join('\n') + '\n')
    const t = PagedText({ path: file, kind: 'clike', filling: 'comment', pageSize: 4096 })
    t.flush()

    const raw = readFileSync(file, 'utf8')
    check(/\/\/- pagedtext filling/.test(raw), true)
    // logical view never shows the filling
    check([...t].every(l => !l.startsWith('//- pagedtext filling')), true)
    check(t.length, 200)
  })
})

test('pagedtext: filling survives an editor that trims trailing whitespace', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.txt')
    const lines = Array.from({ length: 130 }, (_, i) => `data-${i} ${"=".repeat(20)}`)
    writeFileSync(file, lines.join('\n') + '\n')
    const t = PagedText({ path: file, pageSize: 4096 })
    t.flush()

    // simulate `sed -i 's/ *$//'` — strip trailing spaces on every line
    const trimmed = readFileSync(file, 'utf8')
      .split('\n').map(l => l.replace(/ +$/, '')).join('\n')
    writeFileSync(file, trimmed)

    // the header's line counts still mark page boundaries — reopen is intact
    const reopened = PagedText({ path: file, pageSize: 4096 })
    check(reopened.length, 130)
    check(reopened.at(0), `data-0 ${'='.repeat(20)}`)
    check(reopened.at(-1), `data-129 ${'='.repeat(20)}`)
  })
})

test('pagedtext: sequential layout preserves order under repeated append', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'log.txt')
    // seed via the cursor so the pages are built once, not once per push:
    // t.push() through the proxy rewrites the whole file each call.
    writeFileSync(file, Array.from({ length: 300 }, (_, i) => `event ${i}`).join('\n') + '\n')
    const t = PagedText({ path: file, layout: 'sequential', pageSize: 4096 })
    t.flush()

    const reopened = PagedText({ path: file, pageSize: 4096 })
    check(reopened.length, 300)
    check(reopened.at(0), 'event 0')
    check(reopened.at(150), 'event 150')
    check(reopened.at(-1), 'event 299')
    check(reopened.layout, 'sequential')
  })
})

test('pagedtext: legacy plain-text file migrates on open', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'legacy.txt')
    // a plain file larger than one page, no PagedText header
    const lines = Array.from({ length: 160 }, (_, i) => `legacy line ${i} ${'.'.repeat(20)}`)
    writeFileSync(file, lines.join('\n') + '\n')

    const t = PagedText({ path: file, pageSize: 4096 })
    check(t.length, 160)
    check(t.at(159), `legacy line 159 ${'.'.repeat(20)}`)

    // after first open it now carries the header
    const header = readGenesis(file)
    check(header.magic, 'PAGEDTEXT')
  })
})

test('pagedtext: unknown header version is discarded, not reinterpreted as text', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'future.txt')
    // A file written by a LATER version: valid magic, version we cannot read.
    // A genese viaja no RODAPE, entao e la que a versao futura aparece.
    const body = JSON.stringify({ magic: 'PAGEDTEXT', version: 99, pageSize: PS, pages: [1] })
    const data = Buffer.alloc(PS, ' ')
    data.write('some future encoding\n', 0, 'utf8')
    const trailer = Buffer.alloc(PS, ' ')
    trailer.write('#- PAGEDTEXT-TRAILER\n' + body + '\n', 0, 'utf8')
    writeFileSync(file, Buffer.concat([data, trailer]))
    const before = readFileSync(file)

    const t = PagedText({ path: file, pageSize: PS })
    // Presented as empty and flagged for rebuild — NOT parsed as legacy text.
    check(t._store.needsRebuild, true)
    check(t.length, 0)
    // And, above all, not rewritten: reinterpreting it would destroy it.
    check(readFileSync(file).equals(before), true)
    t.close()
  })
})

test('pagedtext: the page cache has a ceiling under a full scan', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'wide.txt')
    const lines = []
    for (let i = 0; i < 400; i++)
      for (let j = 0; j < 50; j++) lines.push(`p${i} l${j} ` + 'x'.repeat(60))
    const t = PagedText({ path: file, pageSize: PS, cachePages: 8 })
    t._store.replaceAll(lines)
    t._store.flush()
    t.close()

    const re = PagedText({ path: file, pageSize: PS, cachePages: 8 })
    check(re._store.pageCount() > 100, true)
    re.indexOf('nothing matches this')      // a full scan of every page
    // The whole file was read; the RAM ceiling held.
    check(re._store.cacheSize <= 8, true)
    re.close()
  })
})

test('pagedtext: checkpoint trailer — appends since the last one are recovered', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'ckpt.txt')
    // checkpointEvery: 50 — o trailer fica deliberadamente atrasado, e as
    // paginas escritas depois dele tem que ser reencontradas na abertura.
    const t = PagedText({ path: file, pageSize: PS, checkpointEvery: 50 })
    const seed = []
    for (let i = 0; i < 300; i++) seed.push(`linha ${i} ` + 'y'.repeat(60))
    t._store.replaceAll(seed)
    t._store.flush()
    // Este e o unico que NAO vira fence de tempo, e a razao e o proprio
    // invariante: o teste exige parar ENTRE checkpoints, para que o trailer
    // fique atrasado. Com `checkpointEvery: 50`, 37 appends garantem isso; um
    // numero que flutua com a maquina cairia em cima de um checkpoint metade
    // das vezes e o teste deixaria de afirmar o que afirma. Aqui a contagem E
    // a condicao, nao um proxy de esforco — e sao 37 escritas, ~80ms.
    const extras = 37
    for (let i = 0; i < extras; i++) t.push(`extra ${i} ` + 'z'.repeat(60))
    const wrote = t._store.lastWrite
    t.close()

    // O ultimo append nao gravou trailer: so a pagina de dados.
    check(wrote.checkpoint, false)

    const re = PagedText({ path: file, pageSize: PS })
    check(re.length, seed.length + extras)
    check(re.at(-1), `extra ${extras - 1} ${'z'.repeat(60)}`)
    check(re[0], `linha 0 ${'y'.repeat(60)}`)
    re.close()
  })
})

test('pagedtext: o arquivo e texto — zero byte NUL, e nao so "quase texto"', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'dados.csv')
    const t = PagedText({ path: file, pageSize: PS_MINI, kind: 'csv' })
    t.push('id,name,email')
    for (let i = 0; i < 12; i++) t.push(`${i},user${i},user${i}@example.com`)
    t.close()

    // O criterio nao e estetico: com pagina zerada, metade dos bytes era NUL,
    // `file(1)` classificava o arquivo como `data` e `grep` sem -a devolvia
    // "nao encontrado" para conteudo que estava la.
    const raw = readFileSync(file)
    let nuls = 0
    for (let i = 0; i < raw.length; i++) if (raw[i] === 0) nuls++
    check(nuls, 0)
    // Varias paginas de verdade — "zero NUL" num arquivo de uma pagina so nao
    // afirmaria nada sobre enchimento.
    check(raw.length / PS_MINI >= 3, true)
  })
})

test('pagedtext: a pagina 0 e dado — um .csv comeca no primeiro registro', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'dados.csv')
    const t = PagedText({ path: file, pageSize: PS_MINI, kind: 'csv' })
    t.push('id,name')
    for (let i = 0; i < 12; i++) t.push(`${i},user${i}`)
    t.close()

    // A genese viaja no rodape: quem le a primeira linha ve DADO, nao metadado.
    const first = readFileSync(file, 'utf8').split('\n')[0]
    check(first, 'id,name')
    check(first.includes('PAGEDTEXT'), false)

    // E ela continua legivel de onde foi parar.
    const g = readGenesis(file)
    check(g.magic, 'PAGEDTEXT')
    check(g.kind, 'csv')
  })
})

test('pagedtext: o enchimento sobrevive a um editor que apara fim de linha', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.txt')
    const t = PagedText({ path: file, pageSize: PS_MINI })
    const n = 12
    for (let i = 0; i < n; i++) t.push(`data-${i} ${'='.repeat(20)}`)
    t.close()
    const before = statSync(file).size

    // `sed -i 's/ *$//'` — o caso que destruia o alinhamento quando o
    // enchimento era uma linha de um espaco so.
    const trimmed = readFileSync(file, 'utf8')
      .split('\n').map(l => l.replace(/ +$/, '')).join('\n')
    writeFileSync(file, trimmed)

    check(statSync(file).size, before)
    const re = PagedText({ path: file, pageSize: PS_MINI })
    check(re.length, n)
    check(re.at(-1), `data-${n - 1} ${'='.repeat(20)}`)
    re.close()
  })
})

test('pagedtext: validate detecta um arquivo cujo enchimento foi removido', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'ok.csv')
    const t = PagedText({ path: file, pageSize: PS_MINI, kind: 'csv' })
    for (let i = 0; i < 12; i++) t.push(`${i},user${i}`)
    t.close()

    // Nao da para PREVENIR que alguem apague o enchimento; da para DETECTAR.
    check(validate(file).ok, true)
    check(validate(file).problems.length, 0)

    const quebrado = join(dir, 'quebrado.csv')
    writeFileSync(quebrado, readFileSync(file, 'utf8')
      .split('\n').filter(l => !/^\s*,\s*$/.test(l)).join('\n'))

    const v = validate(quebrado)
    check(v.ok, false)
    check(v.problems.some(p => p.includes('multiplo')), true)
  })
})

// O kind yaml DECLARA onde seu enchimento deixa de ser neutro, em vez de
// contornar em silencio. Um bloco escalar nao reconhece comentario, entao a
// linha de enchimento viraria conteudo da string — e nao ha byte que seja
// enchimento e nada ao mesmo tempo ali dentro. Os formatos onde o enchimento e
// neutro em todo lugar declaram lista vazia, e a diferenca entre as duas
// listas e a propria declaracao.
test('o kind yaml declara a restricao do bloco escalar', () => {
  const r = kindRestrictions('yaml')
  check(r.length > 0, true)
  check(r.some(x => x.includes('block scalar')), true)
  check(kindRestrictions('csv').length, 0)
  check(kindRestrictions('clike').length, 0)
})
