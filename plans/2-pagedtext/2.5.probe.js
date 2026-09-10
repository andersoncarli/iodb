// Sonda da 2.5 — a projecao paginada responde como o caminho plano, e o YAML
// deixou de custar O(n) recorrente.
import IO, { merge, append, assign } from '../../src/io-engine.js'
import { mkdtempSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'; import { join } from 'node:path'

const feed = (io, n) => {
  for (let i = 0; i < n; i++) io.in({ [`k${i}`]: { v: i } })
  io.in({ k7: null })            // tombstone
  io.in({ k3: { v: 'novo' } })   // sobrescrita
}
const norm = (s) => {
  if (Array.isArray(s)) return JSON.stringify(s)
  const o = { ...s }; delete o._entity; delete o._projection; delete o._type
  return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]])))
}

// 1. EQUIVALENCIA POR REDUCER. O caminho plano e a referencia; o paginado tem
//    que dar a MESMA projecao nos tres. O `append` e o caso critico: nele a
//    ordem E a identidade, e ate esta feature ele nem sequer serializava.
for (const [nome, reduce, arr] of [['assign', assign, false], ['merge', merge, false], ['append', append, true]]) {
  const res = {}
  for (const ps of [0, 4096]) {
    const base = join(mkdtempSync(join(tmpdir(), 'p25-')), 'store')
    const io = IO(base, { reduce, initial: arr ? [] : {}, pageSize: ps })
    io.open(); feed(io, 60); io.close()
    const re = IO(base, { reduce, initial: arr ? [] : {}, pageSize: ps })
    re.open(); res[ps] = norm(re.get('#1')); re.close()
  }
  console.log(`${nome}: identico=${res[0] === res[4096]}`)
}

// 2. A PROJECAO SEQUENCIAL RESPONDE COMO ARRAY. Antes desta feature so cinco
//    metodos funcionavam; o resto caia no ramo keyed e estourava.
{
  const base = join(mkdtempSync(join(tmpdir(), 'p25b-')), 'store')
  const io = IO(base, { reduce: append, initial: [], pageSize: 4096 })
  io.open(); for (let i = 0; i < 200; i++) io.in({ [`k${i}`]: { v: i } }); io.close()
  const re = IO(base, { reduce: append, initial: [], pageSize: 4096 })
  re.open(); const s = re.get('#1')
  const quebrados = []
  for (const m of ['toJSON','join','find','indexOf','some','every','at','includes','entries','keys','values','findIndex','concat','flat','reduceRight','lastIndexOf']) {
    try { s[m] } catch { quebrados.push(m) }
  }
  console.log(`metodos que estouram: ${quebrados.length}`)
  console.log(`stringify ok: ${JSON.parse(JSON.stringify(s)).length === s.length}`)
  console.log(`iter == map: ${JSON.stringify([...s]) === JSON.stringify(s.map(x => x))}`)
  re.close()
}

// 3. O YAML SOB DEMANDA. Ele nao e mais escrito a cada 100 flushes; quem quer
//    olhar, pede. O criterio e observavel: apos 250 escritas o arquivo nao
//    existe, e depois de `yaml()` existe.
{
  const base = join(mkdtempSync(join(tmpdir(), 'p25c-')), 'store')
  const io = IO(base, { reduce: assign, initial: {}, pageSize: 4096 })
  io.open()
  for (let i = 0; i < 250; i++) io.in({ [`k${i}`]: { v: i } })
  const y = base + '.yaml'
  // O arquivo EXISTE desde o nascimento do store (a genese o escreve uma vez),
  // entao "existe?" nao e a pergunta. A pergunta e se ele acompanha as escritas:
  // antes desta feature ele era reescrito a cada 100 flushes, custando um
  // `stringify` O(n) sobre a projecao inteira para um arquivo que ninguem le de
  // volta. Agora ele fica PARADO ate alguem pedir.
  const antes = statSync(y).size
  console.log(`yaml apos 250 escritas: bytes=${antes}`)
  io.yaml()
  const depois = statSync(y).size
  console.log(`yaml apos pedir: bytes=${depois} cresceu=${depois > antes}`)
  io.close()
  console.log(`yaml apos close: bytes=${statSync(y).size}`)
}
