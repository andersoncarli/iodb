import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'

export const RawCollection = (filePath) => {
  let content = ""
  return {
    open: () => {
      if (filePath && existsSync(filePath) && !statSync(filePath).isDirectory()) {
        try { content = readFileSync(filePath, 'utf8') } catch { }
      }
    },
    get: (k) => (k === undefined || k === 1 || k === '#1') ? content : undefined,
    in: (p) => {
      if (typeof p === 'string') content = p
      else if (p && typeof p === 'object') content = Object.values(p)[0]
      return 'raw'
    },
    out: () => {},
    flush: () => {
       if (filePath) writeFileSync(filePath, content)
    },
    state: () => content,
    toString: () => content,
    toJSON: () => content,
    header: () => ({ _type: 'raw', _entity: filePath }),
    size: content.length
  }
}

export default RawCollection
