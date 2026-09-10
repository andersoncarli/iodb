// Sonda da 2.1 — o arquivo de dados continua sendo do formato dele.
//
// A prova nao e de opiniao: e o veredito de ferramentas que nao sabem nada de
// pagedtext. `file(1)` classifica, `grep(1)` sem -a procura, e o modulo csv do
// Python parseia. Se os tres se comportam como num .csv comum, a interferencia
// e minima de fato.
import { PagedText, validate } from '../../pagedtext/pagedtext.js'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'pt21-'))
const file = join(dir, 'dados.csv')

const t = new PagedText(file, { pageSize: 4096, kind: 'csv' })
t.push('id,name,email')
for (let i = 1; i <= 200; i++) t.push(`${i},nome-${i},nome${i}@exemplo.com`)
t.flush()

const raw = readFileSync(file)
let nul = 0
for (const b of raw) if (b === 0) nul++
console.log(`bytes: ${raw.length}`)
console.log(`bytes NUL: ${nul}`)
console.log(`alinhado: ${raw.length % 4096 === 0}`)
console.log(`primeira linha: ${raw.toString('utf8').split('\n')[0]}`)

const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim() } catch (e) { return `EXIT ${e.status}` } }
console.log(`file(1): ${sh(`file -b ${file}`)}`)
console.log(`grep sem -a: ${sh(`grep -c nome-137 ${file}`)}`)

// Um leitor de CSV que nao sabe nada de paginacao. O enchimento vira uma coluna
// extra que ele le e ignora; o rodape se esconde como registro de chave vazia.
const py = `
import csv,sys
# O enchimento e um registro cujos campos sao vazios (' ,' -> id=' '), e o
# rodape um registro de primeiro campo vazio. Um leitor comum filtra por chave
# ausente, que e o que qualquer pipeline de CSV ja faz com linha em branco.
rows=[r for r in csv.DictReader(open(sys.argv[1])) if (r.get('id') or '').strip()]
print('registros:', len(rows))
print('ultimo id:', rows[-1]['id'])
print('email 137:', [r for r in rows if r['id']=='137'][0]['email'])
`
writeFileSync(join(dir, 'ler.py'), py)
console.log(sh(`python3 ${join(dir, 'ler.py')} ${file}`))
// Quantos registros o leitor ve ANTES de filtrar: o enchimento aparece como
// coluna extra vazia, nunca como dado corrompido nem como erro de parse.
console.log(sh(`python3 -c "import csv,sys;print('linhas brutas:',sum(1 for _ in csv.reader(open(sys.argv[1]))))" ${file}`))

// DETECCAO, nao prevencao. Nada impede um editor de apagar o enchimento; o que
// se pode e perceber. Simula-se o editor que apara fim de linha e o de que
// remove linhas em branco, e exige-se que o validate acuse.
const v1 = validate(file)
console.log(`validate intacto: ok=${v1.ok} problemas=${v1.problems.length}`)

const ferido = join(dir, 'ferido.csv')
writeFileSync(ferido, raw.toString('utf8').split('\n').filter(l => !/^\s*,?\s*$/.test(l)).join('\n'))
const v2 = validate(ferido)
console.log(`validate ferido: ok=${v2.ok} problemas=${v2.problems.join(' | ')}`)
