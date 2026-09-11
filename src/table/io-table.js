/**
 * io-table.js — feature 8.5
 *
 * Adapta o engine append-only (`.dash`) ao contrato Table. A tabela e uma
 * PROJECAO do log: cada row tem como identidade a CHAVE DE USUARIO do
 * registro de CRIACAO (o `a` em `io.in({a: {...}})`) -- a mesma chave que
 * `io.get(key)` ja aceita nativamente. Todo patch posterior aa mesma
 * entidade e localizado por scan (ou indice, quando a 2.4 chegar) e fundido
 * sob essa identidade -- nunca cria uma row nova. E o mesmo modelo que
 * `io.state()`/`merge` ja usam: o log e uma sequencia de patches, a Table e
 * o resultado fundido.
 *
 * `scan()` faz um UNICO PASSE em stream sobre o `.dash` (nunca
 * `readFileSync` do arquivo inteiro como `records()` faz) e acumula por
 * chave de usuario; so ao esgotar o log as rows fundidas sao cedidas. Nunca
 * duas LINHAS CRUAS do log ficam decodificadas ao mesmo tempo (`linesLive`
 * <= 1) -- o que cresce e o acumulador de ESTADO, que e exatamente o que
 * `io.state()` ja mantem, nao o texto do log.
 *
 * `get()`/`count()` usam os caminhos que ja existem no engine (io.get,
 * io.size). `find`/`range` ficam AUSENTES de proposito: o `find` do engine e
 * varredura total, e expo-lo como capacidade mentiria sobre custo pro
 * otimizador.
 *
 * Schema: fornecido pelo chamador (normal), inferido da projecao em memoria
 * via reduce:merge (conveniencia -- as chaves do mapa sao o pk, a uniao das
 * chaves das linhas sao os campos), ou ausente -- `schema: null`, L0 legal.
 */
import { openSync, closeSync, readSync, statSync, existsSync } from 'fs'
import { parseLine } from '../io-engine.js'
import { normalizeSchema } from './schema.js'

const CHUNK = 64 * 1024
const GENESIS_KEYS = new Set(['0', '1'])

function inferSchemaFromState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null
  const fields = {}
  let sawUserRow = false
  for (const [k, row] of Object.entries(state)) {
    if (k.startsWith('_')) continue
    if (!row || typeof row !== 'object') continue
    sawUserRow = true
    for (const f of Object.keys(row)) {
      if (!fields[f]) fields[f] = { type: typeof row[f] === 'number' ? 'number' : typeof row[f] === 'boolean' ? 'boolean' : 'string' }
    }
  }
  if (!sawUserRow) return null
  fields._key = { type: 'string', pk: true }
  return { fields }
}

/** Le o `.dash` em blocos crus, cedendo um `{shortKey, payload}` POR LINHA
 *  (um patch do log, ainda nao fundido). E o motor de stream; `scan()` da
 *  Table consome isso e funde por cima.
 *
 *  Pureza sob um log que cresce (TABLE.md secao 14, lei 2): fixa `endAt` = o
 *  tamanho do arquivo no momento da CRIACAO do cursor. Um `in()` que chega
 *  depois nao e visto -- cada scan() descreve uma leitura independente do
 *  que existia quando foi aberto. */
function dashLineCursor(path) {
  const endAt = existsSync(path) ? statSync(path).size : 0
  let fd = null
  let pos = 0
  let buf = ''
  let bytesRead = 0
  let linesLive = 0
  let done = endAt === 0
  let closed = false

  function ensureOpen() {
    if (fd === null && !closed) fd = openSync(path, 'r')
  }

  function fillBuffer() {
    if (pos >= endAt) return false
    ensureOpen()
    const toRead = Math.min(CHUNK, endAt - pos)
    const chunk = Buffer.alloc(toRead)
    readSync(fd, chunk, 0, toRead, pos)
    pos += toRead
    bytesRead += toRead
    buf += chunk.toString('utf8')
    return true
  }

  const cursor = {
    get bytesRead() { return bytesRead },
    get linesLive() { return linesLive },

    next() {
      if (done) { linesLive = 0; return null }
      for (;;) {
        const nl = buf.indexOf('\n')
        if (nl !== -1) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (!line.trim()) continue
          const rec = parseLine(line)
          linesLive = 1
          if (rec) {
            const shortKey = Object.keys(rec)[0]
            return { shortKey, payload: rec[shortKey] }
          }
          continue
        }
        if (!fillBuffer()) {
          done = true
          if (buf.trim()) {
            const rec = parseLine(buf)
            buf = ''
            if (rec) {
              const shortKey = Object.keys(rec)[0]
              linesLive = 1
              return { shortKey, payload: rec[shortKey] }
            }
          }
          linesLive = 0
          return null
        }
      }
    },

    close() {
      done = true
      closed = true
      linesLive = 0
      buf = ''
      if (fd !== null) { closeSync(fd); fd = null }
    }
  }

  return cursor
}

export function ioTable(io, schemaInput) {
  const schema = schemaInput !== undefined
    ? normalizeSchema(schemaInput)
    : inferSchemaFromState(io.state?.())

  const hasPk = !!schema && Object.values(schema.fields ?? {}).some(f => f.pk)

  /** scan(): um passe stream sobre o log, acumulando por chave de USUARIO.
   *  A identidade da row (`_key`) e a shortKey da linha que CRIOU a
   *  entidade -- patches seguintes fundem sob essa mesma identidade, nunca
   *  trocam. `_type`/`_entity`/`_projection` (as linhas de genese, #0/#1)
   *  sao infraestrutura do engine, nao dado do usuario: ficam de fora. */
  function scan() {
    const path = typeof io.path === 'function' ? io.path() : io.family.dash
    const raw = dashLineCursor(path)
    const order = []
    const byUserKey = new Map()   // userKey -> { _key, ...fields }
    let cursorIndex = 0
    let exhausted = false

    // O pico de `linesLive` observado DURANTE o drain (raw.linesLive some
    // assim que o loop acaba -- o cursor externo so ganha o controle DEPOIS
    // do drain inteiro, entao ler `raw.linesLive` depois sempre veria 0).
    let peakLinesLive = 0

    function drain() {
      if (exhausted) return
      let entry
      while ((entry = raw.next()) !== null) {
        peakLinesLive = Math.max(peakLinesLive, raw.linesLive)
        const { shortKey, payload } = entry
        if (GENESIS_KEYS.has(shortKey)) continue
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
        for (const [userKey, fields] of Object.entries(payload)) {
          if (byUserKey.has(userKey)) {
            const row = byUserKey.get(userKey)
            if (fields === null) { byUserKey.delete(userKey); continue }
            Object.assign(row, fields)
          } else {
            if (fields === null) continue
            // A identidade e a CHAVE DE USUARIO (o `a` de `{a: {...}}`), nao
            // a shortKey do log -- e a mesma chave que `io.get(key)` aceita.
            const row = { _key: userKey, ...fields }
            byUserKey.set(userKey, row)
            order.push(userKey)
          }
        }
      }
      exhausted = true
    }

    return {
      get bytesRead() { return raw.bytesRead },
      // Depois de esgotar, expoe o PICO observado durante o drain -- 0/1
      // sempre, nunca mais, porque `raw` nunca decodifica duas linhas cruas
      // ao mesmo tempo (mesmo motor da 8.3). Antes de esgotar, e o valor
      // corrente de `raw`.
      get linesLive() { return exhausted ? peakLinesLive : raw.linesLive },
      next() {
        if (!exhausted) drain()
        while (cursorIndex < order.length) {
          const userKey = order[cursorIndex++]
          const row = byUserKey.get(userKey)
          if (row) return row
        }
        return null
      },
      close() {
        raw.close()
        cursorIndex = order.length
      },
      [Symbol.iterator]() {
        return {
          next: () => {
            const v = this.next()
            return v === null ? { done: true, value: undefined } : { done: false, value: v }
          }
        }
      }
    }
  }

  const table = {
    get schema() { return schema },
    scan,
    /** O(1): `io.size` e `idx.recordCount`, nao uma contagem por leitura. */
    count() {
      return io.size
    }
  }

  if (hasPk) {
    table.get = (key) => {
      const payload = io.get(key)
      if (payload === undefined || payload === null) return null
      return { _key: String(key).replace(/^#/, ''), ...payload }
    }
  }

  return table
}
