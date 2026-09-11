import { IO, merge } from '../io-engine.js'
import { ioTable } from './io-table.js'
import { isTable, capabilities } from './contract.js'
import { conform } from './conformance.js'
import { toArray } from './cursor.js'
import { join } from 'path'

function seedIo(dir, name, rows) {
  const io = IO(join(dir, name), { reduce: merge, initial: {} })
  io.open()
  for (const r of rows) io.in({ [r.id]: { name: r.name, age: r.age } })
  return io
}

const schema = {
  fields: {
    _key: { type: 'string', pk: true },
    name: { type: 'string' },
    age: { type: 'number' }
  }
}

test('io-table: com pk (_key), e uma Table de nivel 1 com count, sem find/range', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const io = seedIo(dir, 'l1', [{ id: 'a', name: 'Ana', age: 26 }])
    const t = ioTable(io, schema)
    check(isTable(t), true)
    const caps = capabilities(t)
    check(caps.has, { get: true, find: false, range: false, count: true, filter: false, group: false })
  })
})

test('io-table: sem schema fornecido, com dados, o pk e INFERIDO da projecao (conveniencia)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const io = seedIo(dir, 'l1-inferred', [{ id: 'a', name: 'Ana', age: 26 }])
    const t = ioTable(io)
    check(t.schema.fields._key.pk, true)
    check(capabilities(t).has.get, true)
    check(capabilities(t).has.find, false)
  })
})

test('io-table: sem schema fornecido e sem dado nenhum na projecao, e L0 (nem get)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const io = IO(join(dir, 'l0-empty'), { reduce: merge, initial: {} })
    io.open()
    const t = ioTable(io)
    check(t.schema, null)
    check(capabilities(t).has.get, false)
    check(capabilities(t).has.find, false)
  })
})

test('io-table: scan() cede as linhas de dados, pulando genesis (#0/#1)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const io = seedIo(dir, 'scan', [
      { id: 'a', name: 'Ana', age: 26 },
      { id: 'b', name: 'Bob', age: 31 }
    ])
    const t = ioTable(io, schema)
    const seen = toArray(t.scan())
    check(seen.length, 2)
    check(seen.map(r => r.name).sort(), ['Ana', 'Bob'])
  })
})

test('io-table: get(key) bate com scan|>filter(_key==key)|>first', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const io = seedIo(dir, 'get', [
      { id: 'a', name: 'Ana', age: 26 },
      { id: 'b', name: 'Bob', age: 31 }
    ])
    const t = ioTable(io, schema)
    const rows = toArray(t.scan())
    const bKey = rows.find(r => r.name === 'Bob')._key
    check(t.get(bKey), { _key: bKey, name: 'Bob', age: 31 })
  })
})

test('io-table: count() e io.size, O(1)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const io = seedIo(dir, 'count', [
      { id: 'a', name: 'Ana', age: 26 },
      { id: 'b', name: 'Bob', age: 31 },
      { id: 'c', name: 'Cid', age: 19 }
    ])
    const t = ioTable(io, schema)
    check(t.count(), 3)
  })
})

test('io-table: scan() nunca decodifica mais de uma linha crua do log por vez (linesLive <= 1)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    // O log e uma sequencia de PATCHES (io.state()/merge): saber "quais
    // entidades existem, com que estado final" exige ver o log inteiro --
    // uma entidade criada cedo pode ser alterada por um patch tarde no mesmo
    // arquivo. scan() so pode ceder a row FUNDIDA depois de esgotar o log
    // (diferente da 8.3/8.4, onde as paginas nao carregam patch nenhum). O
    // que se mede aqui, entao, e o motor de LEITURA: ele nunca decodifica
    // mais de UMA linha crua por vez (`linesLive<=1`), e le em blocos (nunca
    // um `readFileSync` do arquivo inteiro como `records()` faz).
    const rows = []
    for (let i = 0; i < 500; i++) rows.push({ id: 'k' + i, name: 'n' + i, age: i })
    const io = seedIo(dir, 'stream', rows)
    const t = ioTable(io, schema)
    const c = t.scan()
    let maxLive = 0
    let v
    while ((v = c.next()) !== null) maxLive = Math.max(maxLive, c.linesLive)
    check(maxLive <= 1, true)
    check(c.bytesRead, require('fs').statSync(io.path()).size)
  })
})

test('io-table: um cursor aberto antes de um in() nao ve o registro novo (pureza sob log que cresce)', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const io = seedIo(dir, 'purity', [{ id: 'a', name: 'Ana', age: 26 }])
    const t = ioTable(io, schema)
    const c = t.scan()
    io.in({ z: { name: 'Zed', age: 99 } })
    const seen = toArray(c)
    check(seen.some(r => r.name === 'Zed'), false)
  })
})

test('io-table: close() esgota o cursor, next() depois devolve null sem lancar', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const io = seedIo(dir, 'close', [{ id: 'a', name: 'Ana', age: 26 }])
    const t = ioTable(io, schema)
    const c = t.scan()
    c.next()
    c.close()
    check(c.next(), null)
  })
})

test('io-table: conform() passa inteira', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const seedRows = [
      { id: 'a', name: 'Ana', age: 26 },
      { id: 'b', name: 'Bob', age: 31 },
      { id: 'c', name: 'Cid', age: 19 }
    ]
    const io = seedIo(dir, 'conform', seedRows)
    const expectedRows = toArray(ioTable(io, schema).scan())
    const ok = conform(() => ioTable(io, schema), expectedRows, { pk: '_key' })
    check(ok, true)
  })
})

// PROMOCAO POS-2.4: quando o indice paginado chave->offset (2.4, ainda ⚫)
// chegar, `find`/`range` sao SOMADOS ao objeto que `ioTable` devolve, e a
// mesma suite de conformidade tem que passar SEM EDICAO -- mesmas leis,
// mesmos resultados, custo menor. Este teste fica IGNORADO ate la; se ele
// nao passar no dia em que a 2.4 entrar, a separacao entre logico e fisico
// (TABLE.md) nunca foi real. Ativar: remover `.skip`, adaptar `ioTable` para
// aceitar o indice da 2.4 e expor find/range por cima dele.
test.skip('io-table: apos a 2.4 (indice paginado), find/range aparecem e conform() continua passando sem edicao', ({ check, withTempDir }) => {
  return withTempDir(dir => {
    const seedRows = [
      { id: 'a', name: 'Ana', age: 26 },
      { id: 'b', name: 'Bob', age: 31 }
    ]
    const io = seedIo(dir, 'promotion', seedRows)
    // const indexed = ioTable(io, schema, { index: /* indice 2.4 */ })
    // check(capabilities(indexed).has.find, true)
    // check(capabilities(indexed).has.range, true)
    // check(conform(() => indexed, toArray(indexed.scan()), { pk: '_key' }), true)
  })
})
