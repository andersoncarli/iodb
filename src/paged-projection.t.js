import { readTrailer, readGenesis } from '../pagedtext/pagedtext.js'
import { PagedProjection, materialize } from './paged-projection.js'
import { readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'

const PS = 4096

test('paged-projection: keyed layout behaves like an object', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const p = PagedProjection(join(dir, 'proj'), { layout: 'keyed', pageSize: PS })
    p.alpha = 1
    p.beta = { x: 2 }
    p.gamma = 'three'
    p.__flushPages()

    check(p.alpha, 1)
    check(p.beta.x, 2)
    check(p.gamma, 'three')
    check('beta' in p, true)
    check('missing' in p, false)
    check(Object.keys(p).sort().join(','), 'alpha,beta,gamma')
  })
})

test('paged-projection: reopen recovers all keys', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'proj')
    const p = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    for (let i = 0; i < 500; i++) p['k' + String(i).padStart(4, '0')] = i
    p.__flushPages()

    const q = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    check(q.k0000, 0)
    check(q.k0250, 250)
    check(q.k0499, 499)
    check(Object.keys(q).length, 500)
  })
})

test('paged-projection: pages are 4096-aligned', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'proj')
    const p = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    for (let i = 0; i < 800; i++) p['key' + String(i).padStart(4, '0')] = { v: i, note: 'x'.repeat(20) }
    p.__flushPages()

    const size = statSync(file).size
    check(size % PS === 0, true)
    check(size >= 2 * PS, true)   // header + at least one data page

    const header = readGenesis(file)
    check(header.magic, 'PAGEDTEXT')
    // Contagem de paginas e chaves de split sao estatistica DERIVADA: vivem no
    // rodape, no fim do arquivo, e nao no header — que e o genesis e nao muda.
    const stats = readTrailer(file)
    check(stats.pages.length >= 1, true)
    check(stats.keys.length, stats.pages.length)   // one split key per page
  })
})

test('paged-projection: point read pages in only the covering page', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'proj')
    const p = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    for (let i = 0; i < 2000; i++) p['id' + String(i).padStart(5, '0')] = i
    p.__flushPages()

    const q = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    const v = q.id01000
    check(v, 1000)
    // one page cached, not all of them
    check(q.__allEntries === undefined, false)
  })
})

test('paged-projection: tombstone (delete) survives reopen', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'proj')
    const p = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    p.a = 1; p.b = 2; p.c = 3
    p.__flushPages()
    delete p.b
    p.__flushPages()

    const q = PagedProjection(file, { layout: 'keyed', pageSize: PS })
    check(q.a, 1)
    check('b' in q, false)
    check(q.c, 3)
    check(Object.keys(q).sort().join(','), 'a,c')
  })
})

test('paged-projection: sequential layout preserves append order', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'seq')
    const p = PagedProjection(file, { layout: 'sequential', pageSize: PS })
    for (let i = 0; i < 600; i++) p.push({ i, tag: 'e' })
    p.__flushPages()

    const q = PagedProjection(file, { layout: 'sequential', pageSize: PS })
    check(q.length, 600)
    check(q[0].i, 0)
    check(q[300].i, 300)
    check(q[599].i, 599)
    check([...q].map(x => x.i).join(',') === Array.from({ length: 600 }, (_, i) => i).join(','), true)
  })
})

// Uma projecao sequencial responde como uma Array, e nao so nos cinco metodos
// que alguem lembrou de listar. Ate a 2.5 havia uma lista branca
// (reduce/map/filter/forEach/slice) e TODO o resto caia no ramo keyed, que
// itera a pagina como pares [chave,valor] — numa pagina sequencial isso estoura
// com "{} is not iterable". Quebravam 22 metodos medidos, `toJSON` entre eles,
// o que fazia `JSON.stringify` de um store append lancar excecao.
//
// O teste cobre metodos de FORA da antiga lista branca de proposito: e o buraco
// que a lista deixava, e nao o que ela ja acertava.
test('paged-projection: sequential responde como Array, nao so na lista branca', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'seq-array')
    const p = PagedProjection(file, { layout: 'sequential', pageSize: PS })
    for (let i = 0; i < 600; i++) p.push({ i })
    p.__flushPages()

    const q = PagedProjection(file, { layout: 'sequential', pageSize: PS })
    // O caminho que lancava: serializar a projecao inteira.
    check(JSON.parse(JSON.stringify(q)).length, 600)
    check(q.at(0).i, 0)
    check(q.at(-1).i, 599)
    // indexOf/includes comparam por IDENTIDADE, e cada leitura materializa a
    // pagina de novo — entao `q[7]` nunca e o mesmo objeto duas vezes. Isso e
    // propriedade do store, nao defeito: compara-se dentro de UMA lista.
    const lista = q.map(x => x)
    check(lista.indexOf(lista[7]), 7)
    check(q.some(x => x.i === 599), true)
    check(q.every(x => typeof x.i === 'number'), true)
    check(q.find(x => x.i === 300).i, 300)
    check(q.findIndex(x => x.i === 300), 300)
    check(lista.includes(lista[42]), true)
    check(q.join('|').length > 0, true)
    // E a lista delegada tem que ser a MESMA sequencia que a iteracao ve,
    // atravessando fronteira de pagina — senao os metodos concordam entre si e
    // discordam do arquivo.
    check(JSON.stringify(q.map(x => x.i)), JSON.stringify([...q].map(x => x.i)))
  })
})

test('paged-projection: materialize round-trips through JSON', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const p = PagedProjection(join(dir, 'proj'), { layout: 'keyed', pageSize: PS })
    p.x = 10; p.y = 20
    p.__flushPages()
    const snap = materialize(p)
    check(JSON.stringify(snap), '{"x":10,"y":20}')
  })
})

test('paged-projection: seeds from initial', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const p = PagedProjection(join(dir, 'proj'), { layout: 'keyed', pageSize: PS, initial: { seeded: true, n: 7 } })
    check(p.seeded, true)
    check(p.n, 7)
  })
})
