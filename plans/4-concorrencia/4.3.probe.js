// Sonda do eval 4.3 — mede o que o LOCKFILE DEDICADO responde por, e nada mais.
//
// O que esta feature possui: exclusao mutua, ausencia de perda, ausencia de
// crash, e a INVARIANTE NOVA — f.yaml existe o tempo todo. Sob o protocolo
// antigo (f.yaml era simultaneamente projecao e mutex) essa ultima linha era
// falsa por construcao: enquanto alguem escrevia, a projecao nao existia.
//
// O que esta feature NAO possui: a alocacao de prefixo curto. Cada processo
// escolhe a chave curta consultando o SEU prefixSet em memoria, que disco
// nenhum coordena — dois processos podem escolher o mesmo prefixo para
// payloads diferentes. Isso quebra verify() e e independente do mutex; esta
// sonda mede e REPORTA (distinct vs records), sem reprovar por isso.
import IO, { append } from "../../src/io-engine.js"
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { spawn } from "child_process"

const ENGINE = join(import.meta.dirname ?? import.meta.dir, "..", "..", "src", "io-engine.js")
const PROCS = Number(process.argv[2] ?? 8)
const WRITES = Number(process.argv[3] ?? 30)

const dir = mkdtempSync(join(tmpdir(), "ev23-"))
try {
  const base = join(dir, "LOG")
  const worker = join(dir, "w.mjs")
  writeFileSync(worker, `
import IO, { append } from ${JSON.stringify(ENGINE)}
const [, , base, n] = process.argv
const io = IO(base, { reduce: append, initial: [], format: "jsonl" })
io.open({ _entity: "x" })
for (let i = 0; i < Number(n); i++) io.in({ pid: process.pid, i })
io.close()
`)

  // Genesis semeado: todo worker entra pelo ramo "ja existe" do open().
  const seed = IO(base, { reduce: append, initial: [], format: "jsonl" })
  seed.open({ _entity: "x" })
  seed.close()

  // AMOSTRAGEM DA INVARIANTE. Enquanto os workers correm, olhamos f.yaml. No
  // protocolo antigo esta sonda pegaria a projecao ausente; agora ela nunca
  // deve estar. Amostrar de fora e o unico jeito honesto de medir: perguntar
  // ao proprio escritor se ele sumiu com o arquivo nao prova nada.
  let yamlMissing = 0, samples = 0
  const sampler = setInterval(() => { samples++; if (!existsSync(base + ".yaml")) yamlMissing++ }, 1)

  const kids = []
  for (let p = 0; p < PROCS; p++)
    kids.push(new Promise(r => {
      const c = spawn("node", [worker, base, String(WRITES)], { stdio: ["ignore", "ignore", "pipe"] })
      let err = ""
      c.stderr.on("data", d => err += d)
      c.on("exit", code => r({ code, err }))
    }))

  const res = await Promise.all(kids)
  clearInterval(sampler)

  const crashed = res.filter(r => r.code !== 0).length
  const timeouts = res.filter(r => /Lock timeout/.test(r.err)).length
  const enoent = res.filter(r => /ENOENT/.test(r.err)).length

  const io = IO(base, { reduce: append, initial: [], format: "jsonl" })
  io.open()
  const data = io.records()
    .map(r => Object.values(r)[0])
    .filter(v => v && typeof v === "object" && "pid" in v && "i" in v)
  const keys = io.records().map(r => Object.keys(r)[0]).filter(k => k !== "0" && k !== "1")

  // O mutex responde por estas quatro:
  console.log("crashed=" + crashed)
  console.log("timeouts=" + timeouts)
  console.log("enoent=" + enoent)
  console.log("records=" + data.length + "/" + PROCS * WRITES)
  console.log("yamlMissing=" + yamlMissing + "/" + samples)
  // Ausência = livre: terminados os oito, nao pode sobrar lock nenhum. Um
  // residuo aqui significa release que nao aconteceu — sob a polaridade
  // antiga isso era invisivel, porque o estado livre TAMBEM era um arquivo.
  console.log("lockResidue=" + readdirSync(dir).filter(x => /^LOG\.lock/.test(x)).length)
  // Reportado, nao cobrado — pertence a alocacao de prefixo, nao ao mutex:
  console.log("distinctKeys=" + new Set(keys).size + "/" + keys.length)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
