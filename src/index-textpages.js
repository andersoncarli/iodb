/**
 * Implementacao de referencia do contrato de indice (src/index-contract.js)
 * sobre um arquivo de texto simples — uma linha JSON por entrada, chave->offset.
 *
 * Este e o primeiro degrau do design "text-pages" descrito em
 * plans/2-pagedtext/2.4-indice-paginado-4k.md: prova o contrato e da uma
 * implementacao default que preserva cat/grep e roda em Node e Bun. O formato
 * de pagina real (4096 bytes alinhados, slotted page, checksum, freelist) e
 * um incremento seguinte sobre ESTE arquivo — o contrato nao muda quando ele
 * chegar, so a forma como get/put/range sao resolvidos por baixo.
 *
 * get() e range() hoje leem o arquivo inteiro para um Map em memoria (o mesmo
 * custo que o spike da 2.4 mediu como baseline "scan/replay") — e o preco
 * conhecido e aceito por esta implementacao ate o formato paginado chegar.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'

export function TextPagesIndex(filePath, opts = {}) {
  let map = null // null = nao carregado ainda

  function load() {
    if (map) return map
    map = new Map()
    if (existsSync(filePath)) {
      const text = readFileSync(filePath, 'utf8')
      for (const line of text.split('\n')) {
        if (!line) continue
        const [key, offset] = JSON.parse(line)
        map.set(key, offset)
      }
    }
    return map
  }

  function persist() {
    const lines = [...map.entries()].map(e => JSON.stringify(e))
    writeFileSync(filePath, lines.join('\n') + (lines.length ? '\n' : ''))
  }

  return {
    open() { load() },

    close() {
      if (map) persist()
      map = null
    },

    get(key) {
      return load().get(key)
    },

    put(key, offset) {
      load().set(key, offset)
      persist()
    },

    del(key) {
      load().delete(key)
      persist()
    },

    * range(lo, hi) {
      const entries = [...load().entries()].filter(([k]) => k >= lo && k <= hi)
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      yield* entries
    },

    rebuild(fromOffset, records) {
      map = new Map()
      for (const { key, offset } of records) map.set(key, offset)
      persist()
    }
  }
}

export function resetTextPagesFile(filePath) {
  if (existsSync(filePath)) unlinkSync(filePath)
}
