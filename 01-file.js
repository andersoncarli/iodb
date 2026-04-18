import { existsSync, readFileSync, writeFileSync, statSync } from 'fs'

export const FileAdapter = (path, opts = {}) => {
  let content = ""
  const self = {
    open: () => {
      if (existsSync(path) && statSync(path).isFile()) content = readFileSync(path, 'utf8')
    },
    get: (k) => (k === undefined || k === 1 || k === '#1') ? content : undefined,
    in: (p) => {
      
      if (typeof p === 'string') content = p
      else if (p && typeof p === 'object') content = Object.values(p)[0]
      return self
    },
    flush: () => {
      if (!opts.readOnly) writeFileSync(path, content)
    },
    path: () => path,
    hasChildren: () => false,
    state: () => content,
    toString: () => content,
    toJSON: () => content,
    type: 'file'
  }
  return self
}

export const extensions = ['txt', 'md', 'log', 'sh', 'js', 'ts']
export default FileAdapter
