// Sonda da 6.1 — mede a troca em arvore REAL, nao em fixture, e imprime fatos
// que o eval afirma. Alvo: a propria arvore do iodb, sem .git nem node_modules.
import { FSWatch } from '../../fswatch/fswatch.js'
import { readFileSync, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const src = readFileSync(new URL('../../fswatch/fswatch.js', import.meta.url), 'utf8')
console.log('bun:sqlite obrigatorio:', /const backend = raw\.backend \|\| 'iodb'/.test(src) ? 'nao' : 'SIM')
console.log('backend sqlite disponivel:', /sqlite: SqliteStore/.test(src))
console.log('tabela nodes/leaves:', /CREATE TABLE IF NOT EXISTS (nodes|leaves)\b/.test(src))

const root = path.join(os.homedir(), 'iodb')
const cfg = { ALL: { targets: [root], include: ['**/*'], exclude: ['**/.git/**', '**/node_modules/**'] } }
await rm(path.join(root, '.fswatch'), { recursive: true, force: true })

const t0 = performance.now()
const fs = await FSWatch(cfg)
await fs.scan()
const scanMs = performance.now() - t0
const n = fs.stats().entries
const dash = fs.stats().database
fs.close()

console.log('entries:', n)
console.log('custo por registro:', (scanMs / n).toFixed(2), 'ms')
console.log('store:', path.basename(dash))
console.log('sqlite criado:', existsSync(path.join(root, '.fswatch', 'metadata.sqlite')))

const again = await FSWatch(cfg)
console.log('apos reopen:', again.stats().entries)
again.close()
await rm(path.join(root, '.fswatch'), { recursive: true, force: true })
