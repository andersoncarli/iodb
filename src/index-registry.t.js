import { createIndex, knownIndexImpls } from './index-registry.js'
import { assertIndexShape } from './index-contract.js'
import './adapters/sqlite.js' // registra 'sqlite' como efeito colateral do import
import { join } from 'path'

const IMPLS = ['text-pages', 'sqlite']

test('index-registry: as duas implementacoes de referencia estao registradas', async ({ check }) => {
  const known = knownIndexImpls()
  check(known.includes('text-pages'))
  check(known.includes('sqlite'))
})

test('index-registry: nome desconhecido lanca erro legivel', async ({ check }) => {
  let threw = false
  try { createIndex('nao-existe', '/tmp/x', {}) } catch (e) { threw = /desconhecida/.test(e.message) }
  check(threw)
})

// REGRA DOS 3: cada withTempDir/mkdtemp e disco de verdade, e text-pages.put()
// faz um writeFileSync completo por chamada. Um teste por propriedade (17
// combinacoes de temp-dir x implementacao) pagava esse custo 17 vezes e
// estourava o orcamento de 1000ms so por I/O, sem nenhum registro maior estar
// envolvido. Um unico withTempDir por implementacao, testando todas as
// propriedades do contrato na mesma sessao de arquivo, prova a mesma coisa
// com uma fracao das chamadas de disco.
for (const name of IMPLS) {
  test(`index-registry (${name}): contrato inteiro numa sessao`, async ({ check }) => {
    await withTempDir(async (tmp) => {
      const file = join(tmp, `t.${name}`)
      const idx = createIndex(name, file, {})
      check(assertIndexShape(idx))

      idx.open()
      check(idx.get('a'), 'undefined')          // vazio antes de escrever

      idx.put('a', 100)
      idx.put('b', 200)
      check(idx.get('a'), 100)
      check(idx.get('b'), 200)

      idx.put('a', 999)                          // upsert, nao duplica
      check(idx.get('a'), 999)

      idx.del('a')
      check(idx.get('a'), 'undefined')

      for (const k of ['x', 'z', 'y', 'w']) idx.put(k, k.charCodeAt(0))
      check([...idx.range('w', 'y')].map(([k]) => k), ['w', 'x', 'y'])
      check([...idx.range('0', '9')].length, 0)  // fora do espaco de chaves

      idx.rebuild(0, [{ key: 'r1', offset: 1 }, { key: 'r2', offset: 2 }])
      check(idx.get('b'), 'undefined')           // rebuild descarta o estado antigo
      check(idx.get('r1'), 1)
      check(idx.get('r2'), 2)

      idx.close()

      const reopened = createIndex(name, file, {})
      reopened.open()
      check(reopened.get('r1'), 1)               // sobrevive a close/reopen
      reopened.close()
    })
  })
}

test('index-registry: get/put/range concordam entre text-pages e sqlite no mesmo corpus', async ({ check }) => {
  await withTempDir(async (tmp) => {
    const rows = Array.from({ length: 20 }, (_, i) => [String(i).padStart(3, '0'), i * 10])
    const results = {}
    for (const name of IMPLS) {
      const idx = createIndex(name, join(tmp, `corpus.${name}`), {})
      idx.open()
      for (const [k, v] of rows) idx.put(k, v)
      results[name] = {
        gets: rows.map(([k]) => idx.get(k)),
        range: [...idx.range('005', '008')]
      }
      idx.close()
    }
    check(results['text-pages'].gets, results['sqlite'].gets)
    check(results['text-pages'].range, results['sqlite'].range)
  })
})
