/**
 * io/adapters/15-jsonl.js — JSONL format ({"key":json}\n, JSON projection)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { LogCollection } from './collection-base.js'

const jsonlFmt = (filePath) => {
  const base = filePath ? filePath.replace(/\.jsonl$|\.json$/, '') : null
  return {
    logPath: base ? base + '.jsonl' : null,
    indexPath: base ? base + '.index' : null,
    type: 'jsonl',

    formatLine: (key, patch) => JSON.stringify({ [key]: patch }),

    parseLine: (line) => {
      try {
        const data = JSON.parse(line)
        const entries = Object.entries(data)
        if (entries.length === 0) return { key: null, patch: {} }
        const [key, patch] = entries[0]
        return { key, patch }
      } catch (e) {
        return { key: null, patch: {}, error: e.message }
      }
    },

    extractFromBuffer: (buf, k) => {
      const needle = Buffer.from('"' + k + '":')
      const pos = buf.indexOf(needle)
      if (pos === -1) return null
      let start = pos
      while (start > 0 && buf[start - 1] !== 10) start--
      let end = buf.indexOf(10, pos)
      if (end === -1) end = buf.length
      try { return JSON.parse(buf.subarray(start, end).toString())[k] } catch { return null }
    },

    syncFile: (fp, cache) => writeFileSync(fp, JSON.stringify(cache, null, 2)),
    loadFile: (fp) => {
      if (!existsSync(fp)) return {}
      const txt = readFileSync(fp, 'utf8')
      try {
        return JSON.parse(txt) || {}
      } catch (e) {
        console.error(`[jsonl] loadFile failed for ${fp}: "${txt.slice(0, 100)}"`)
        return {}
      }
    },
  }
}

export const extensions = ['jsonl']
export const JsonlCollection = (filePath) => LogCollection(filePath, jsonlFmt(filePath))
export default JsonlCollection
