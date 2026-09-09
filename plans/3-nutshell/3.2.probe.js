// Sonda do eval 3.2 — roda o cenario 8x30 ao vivo e imprime as quatro
// propriedades que definem o modo de falha. Usada por 3.2.eval.js; vive aqui
// para o eval nao precisar embutir um script inteiro numa string de shell.
import IO from "../../nutshell/io-nutshell.js"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const ENGINE = join(import.meta.dir, "..", "..", "nutshell", "io-nutshell.js")
const PROCS = Number(process.argv[2] ?? 8)
const WRITES = Number(process.argv[3] ?? 30)

const dir = mkdtempSync(join(tmpdir(), "ev32-"))
try {
  const worker = join(dir, "w.mjs")
  writeFileSync(worker, `
import IO from ${JSON.stringify(ENGINE)}
const [, , d, n] = process.argv
const io = IO('LOG', { path: d })
for (let i = 0; i < Number(n); i++) io.in({ ['k' + process.pid + '_' + i]: i })
`)

  const kids = []
  for (let p = 0; p < PROCS; p++)
    kids.push(Bun.spawn(["bun", worker, dir, String(WRITES)], { stdout: "pipe", stderr: "pipe" }))

  let crashed = 0
  for (const k of kids) if ((await k.exited) !== 0) crashed++

  const io = IO("LOG", { path: dir })
  const data = io.records().filter(r => r.key !== "0" && r.key !== "1")

  console.log("crashed=" + crashed)
  console.log("records=" + data.length)
  console.log("distinct=" + new Set(data.map(r => r.key)).size)
  console.log("valid=" + io.verify().valid)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
