import {
  TabularProjection, parseSchema, formatSchema, splitCsv, encodeValue, decodeValue
} from './tabular-projection.js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

const PS = 4096
// Pagina pequena para provar "atravessa varias paginas" com poucos registros.
// Pagina e uma razao entre bytes e pageSize, nao um numero de linhas — entao o
// que prova o indice por pagina e a QUANTIDADE DE PAGINAS, e ela se compra
// encolhendo a pagina em vez de escrevendo milhares de registros.
const PS_MINI = 256

test('tabular: a gramatica de coluna do docs/05', ({ check }) => {
  const cols = parseSchema('name:str,age:int?,email:str@,country:str?@')
  check(cols.length, 4)
  check(cols[0].type, 'str')
  check(cols[1].nullable, true)
  check(cols[1].indexed, false)
  check(cols[2].indexed, true)
  check(cols[2].nullable, false)
  check(cols[3].nullable, true)
  check(cols[3].indexed, true)
  // Os dois sufixos sao eixos independentes: a ordem entre eles nao muda nada.
  check(formatSchema(parseSchema('c:str@?')), 'c:str?@')
  check(formatSchema(cols), 'name:str,age:int?,email:str@,country:str?@')
})

test('tabular: os tipos sao restritos, e o schema invalido e recusado', ({ check }) => {
  for (const bad of ['x:date', 'x:json', 'x', ':str', 'a:str,a:int']) {
    let threw = false
    try { parseSchema(bad) } catch { threw = true }
    check(threw, true)
  }
  check(parseSchema('a:str,b:int,c:float,d:bool').map(c => c.type).join(','), 'str,int,float,bool')
})

test('tabular: o campo vazio e a UNICA codificacao de null', ({ check }) => {
  const s = { name: 's', type: 'str', nullable: true, indexed: false }
  const i = { name: 'i', type: 'int', nullable: true, indexed: false }
  check(encodeValue(null, s), '')
  check(decodeValue('', s), null)
  // E por isso que o str vazio viaja entre aspas: senao ele colidiria com null.
  // O decode so os separa sabendo que o campo VEIO entre aspas — e por isso que
  // o splitCsv marca isso, em vez de entregar so o texto ja desaspado.
  check(encodeValue('', s), '""')
  const marks = []
  check(splitCsv('""')[0], '')
  splitCsv('""', marks)
  check(decodeValue('', s, marks[0]), '')
  check(decodeValue('', i), null)
  // Coluna nao-nullable recusa o null nos dois sentidos.
  const nn = { name: 'n', type: 'int', nullable: false, indexed: false }
  let a = false, b = false
  try { encodeValue(null, nn) } catch { a = true }
  try { decodeValue('', nn) } catch { b = true }
  check(a, true)
  check(b, true)
})

test('tabular: ida-e-volta dos quatro tipos, com null e com escaping', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'pessoas.csv')
    const schema = 'name:str,age:int?,score:float,active:bool,note:str?'
    const t = TabularProjection(file, { schema, pageSize: PS })
    const linhas = [
      { name: 'Ana', age: 26, score: 3.14, active: true, note: null },
      { name: 'Bob', age: null, score: -0.5, active: false, note: 'com, virgula' },
      { name: 'Cida "C"', age: 0, score: 0, active: true, note: '' }
    ]
    for (const r of linhas) t.push(r)
    t.flush()

    const lido = TabularProjection(file, { pageSize: PS }).all()
    check(lido.length, 3)
    check(JSON.stringify(lido), JSON.stringify(linhas))
    // O schema e a PRIMEIRA linha do arquivo, nao um header binario.
    check(readFileSync(file, 'utf8').split('\n')[0], schema)
  })
})

test('tabular: o schema do arquivo ganha do schema do chamador', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'x.csv')
    TabularProjection(file, { schema: 'a:str,b:int', pageSize: PS }).push({ a: 'q', b: 1 }).flush()
    // Reabrir declarando outra coisa NAO reinterpreta os bytes que ja estao la.
    const t = TabularProjection(file, { schema: 'z:bool', pageSize: PS })
    check(formatSchema(t.schema), 'a:str,b:int')
    check(t.all()[0].b, 1)
  })
})

test('tabular: o range sobre coluna indexada le menos paginas que a varredura', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'big.csv')
    const N = 120
    const t = TabularProjection(file, { schema: 'id:int@,nome:str,peso:int', pageSize: PS_MINI })
    for (let i = 0; i < N; i++) t.push({ id: i, nome: 'n' + i, peso: i % 7 })
    t.flush()

    const q = TabularProjection(file, { pageSize: PS_MINI })
    const todos = q.all()
    check(todos.length, N)
    const paginasVarredura = q.pagesRead
    // Varias paginas de verdade — senao "leu menos paginas" nao teria conteudo.
    check(paginasVarredura >= 5, true)

    // O range: mesma resposta, menos paginas ABERTAS. O `id` e crescente, entao
    // a faixa vive em poucas paginas e o resto e descartado pelo min/max.
    const faixa = q.range('id', 40, 49)
    check(faixa.length, 10)
    check(faixa[0].id, 40)
    check(faixa[9].id, 49)
    const paginasRange = q.pagesRead
    check(paginasRange < paginasVarredura, true)
    // Reportado, nao so comparado — a feature pede o numero medido.
    console.log(`  paginas: varredura=${paginasVarredura} range=${paginasRange}`)

    // A coluna NAO indexada responde igual, so que lendo tudo.
    const semIndice = q.range('peso', 5, 5)
    check(q.pagesRead, paginasVarredura)
    check(semIndice.length, todos.filter(r => r.peso === 5).length)
    check(semIndice.every(r => r.peso === 5), true)
  })
})

test('tabular: o arquivo continua sendo um csv que qualquer parser le', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'plain.csv')
    const t = TabularProjection(file, { schema: 'id:int@,nome:str', pageSize: PS_MINI })
    for (let i = 0; i < 60; i++) t.push({ id: i, nome: 'n' + i })
    t.flush()

    // Um DictReader comum, sem saber nada de pagedtext: o enchimento e o rodape
    // sao registros sem `id`, que e o que qualquer pipeline ja descarta.
    // Um parser comum ve a DECLARACAO como nome da coluna (`id:int@`). Isso e o
    // desenho: a primeira linha e ao mesmo tempo CSV valido e schema, e quem nao
    // conhece a gramatica ainda assim le os registros. O enchimento e o rodape
    // sao registros de primeiro campo em branco, que e o que qualquer pipeline
    // ja descarta.
    const py = `import csv,sys
rows=[r for r in csv.DictReader(open(sys.argv[1])) if (r.get('id:int@') or '').strip()]
print(len(rows), rows[0]['nome:str'], rows[-1]['nome:str'], len(rows[0]))`
    const out = execFileSync('python3', ['-c', py, file], { encoding: 'utf8' }).trim()
    check(out, '60 n0 n59 2')
  })
})

test('tabular: split de csv com aspas, virgula e aspas duplicadas', ({ check }) => {
  check(JSON.stringify(splitCsv('a,b,c')), JSON.stringify(['a', 'b', 'c']))
  check(JSON.stringify(splitCsv('"a,b",c')), JSON.stringify(['a,b', 'c']))
  check(JSON.stringify(splitCsv('"a""b",c')), JSON.stringify(['a"b', 'c']))
  check(JSON.stringify(splitCsv('a,,b')), JSON.stringify(['a', '', 'b']))
})

test('tabular: o range nas bordas — vazio, tudo, e atravessando pagina', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'bordas.csv')
    const N = 120
    const t = TabularProjection(file, { schema: 'id:int@,nome:str', pageSize: PS_MINI })
    for (let i = 0; i < N; i++) t.push({ id: i, nome: 'n' + i })
    t.flush()
    const q = TabularProjection(file, { pageSize: PS_MINI })
    const total = q.all().length
    const varredura = q.pagesRead

    // Faixa fora de tudo: nenhuma pagina aberta, e a prova de que o descarte e
    // pelo min/max e nao por filtro depois da leitura.
    check(q.range('id', 999999, 1000000).length, 0)
    check(q.pagesRead, 0)

    // Faixa que cobre tudo: le todas, e devolve tudo.
    check(q.range('id', -1, 999999).length, total)
    check(q.pagesRead, varredura)

    // Faixa que atravessa fronteira de pagina: abre mais de uma, e ainda assim
    // menos que a varredura.
    const meio = q.range('id', 30, 80)
    check(meio.length, 51)
    check(q.pagesRead > 1, true)
    check(q.pagesRead < varredura, true)
    check(meio[0].id, 30)
    check(meio[50].id, 80)
  })
})

test('tabular: null numa coluna indexada nunca faz a pagina ser pulada', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const file = join(dir, 'nulos.csv')
    const t = TabularProjection(file, { schema: 'id:int?@,nome:str', pageSize: PS_MINI })
    for (let i = 0; i < 120; i++) t.push({ id: i % 7 === 0 ? null : i, nome: 'n' + i })
    t.flush()
    const q = TabularProjection(file, { pageSize: PS_MINI })
    // O null nao tem posicao na ordem, entao ele nao entra no min/max. Uma
    // pagina que o contem e sempre candidata — pular por um intervalo que nao
    // o descreve responderia errado.
    const r = q.range('id', 10, 20)
    check(r.every(x => x.id >= 10 && x.id <= 20), true)
    check(r.some(x => x.id === null), false)
    check(r.length, q.all().filter(x => x.id !== null && x.id >= 10 && x.id <= 20).length)
  })
})
