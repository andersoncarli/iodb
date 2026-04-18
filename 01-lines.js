import { existsSync, readFileSync, writeFileSync } from 'fs'

export const LinesAdapter = (path, opts = {}) => {
  let lines = []
  return {
    open: () => {
      if (existsSync(path)) {
        lines = readFileSync(path, 'utf8').split('\n')
      }
    },
    get: (idx) => {
      if (idx === undefined) return lines
      const i = parseInt(idx)
      return isNaN(i) ? lines : lines[i]
    },
    in: (p) => {
      if (Array.isArray(p)) lines = p
      else if (typeof p === 'object') {
        for (const [k, v] of Object.entries(p)) {
          const i = parseInt(k)
          if (!isNaN(i)) lines[i] = v
        }
      }
      return self
    },
    flush: () => {
      if (!opts.readOnly) writeFileSync(path, lines.join('\n'))
    },
    path: () => path,
    hasChildren: () => false,
    state: () => lines,
    toJSON: () => lines,
    type: 'lines'
  }
}

export default LinesAdapter
