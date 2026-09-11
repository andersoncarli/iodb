// Probe da 2.2 — a prova e em PAGINAS LIDAS e em ferramenta de terceiro, nao
// em grep. A feature promete duas coisas mensuraveis: um csv tipado que vai e
// volta com os quatro tipos e com null, e um range que le estritamente menos
// paginas que a varredura. As duas sao medidas aqui.

import { TabularProjection, formatSchema } from '../../src/tabular-projection.js'
import { mkdtempSync, readFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

const dir = mkdtempSync(join(tmpdir(), 'tab22-'))

// --- 1. ida e volta dos quatro tipos, com null ---------------------------
const f1 = join(dir, 'tipos.csv')
const schema = 'name:str,age:int?,score:float,active:bool,note:str?'
const linhas = [
  { name: 'Ana', age: 26, score: 3.14, active: true, note: null },
  { name: 'Bob', age: null, score: -0.5, active: false, note: 'com, virgula' },
  { name: 'Cida "C"', age: 0, score: 0, active: true, note: '' }
]
const t1 = TabularProjection(f1, { schema, pageSize: 4096 })
for (const r of linhas) t1.push(r)
t1.flush()
const volta = TabularProjection(f1, { pageSize: 4096 }).all()
console.log('roundtrip identico:', JSON.stringify(volta) === JSON.stringify(linhas))
console.log('primeira linha e o schema:', readFileSync(f1, 'utf8').split('\n')[0] === schema)
console.log('schema relido:', formatSchema(TabularProjection(f1, { pageSize: 4096 }).schema))

// --- 2. paginas lidas: varredura contra range ----------------------------
const f2 = join(dir, 'big.csv')
const t2 = TabularProjection(f2, { schema: 'id:int@,nome:str,peso:int', pageSize: 4096 })
for (let i = 0; i < 20000; i++) t2.push({ id: i, nome: 'n' + i, peso: i % 97 })
t2.flush()

const q = TabularProjection(f2, { pageSize: 4096 })
const todos = q.all()
const pVarredura = q.pagesRead
const faixa = q.range('id', 1000, 1049)
const pRange = q.pagesRead
console.log(`registros: ${todos.length}`)
console.log(`paginas: varredura=${pVarredura} range=${pRange}`)
console.log('range correto:', faixa.length === 50 && faixa[0].id === 1000 && faixa[49].id === 1049)
console.log('range leu menos:', pRange < pVarredura)

// A coluna SEM indice: mesma resposta, custo de varredura. O indice e o que
// muda o custo, nao a correcao.
const semIdx = q.range('peso', 5, 5)
console.log(`sem indice: paginas=${q.pagesRead} correto=${semIdx.every(r => r.peso === 5) && semIdx.length === todos.filter(r => r.peso === 5).length}`)

// Faixa fora de tudo: zero paginas abertas prova que o descarte e pelo min/max
// e nao um filtro depois de ler.
q.range('id', 10 ** 9, 10 ** 9 + 1)
console.log('faixa fora de tudo: paginas=' + q.pagesRead)

// --- 3. o arquivo continua sendo um csv de terceiro ----------------------
console.log('file -b:', execFileSync('file', ['-b', f2], { encoding: 'utf8' }).trim())
console.log('alinhado a 4096:', statSync(f2).size % 4096 === 0)
const py = `import csv,sys
rows=[r for r in csv.DictReader(open(sys.argv[1])) if (r.get('id:int@') or '').strip()]
print('python DictReader:', len(rows), rows[0]['nome:str'], rows[-1]['nome:str'])`
console.log(execFileSync('python3', ['-c', py, f2], { encoding: 'utf8' }).trim())
