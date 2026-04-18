import { existsSync, readFileSync, writeFileSync } from 'fs'

export const BlobAdapter = (path, opts = {}) => {
  let data = null
  return {
    open: () => {
      if (existsSync(path)) data = readFileSync(path)
    },
    get: () => data,
    in: (buf) => {
      data = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf))
      return 'ok'
    },
    flush: () => {
      if (!opts.readOnly && data) writeFileSync(path, data)
    },
    path: () => path,
    hasChildren: () => false,
    state: () => data,
    type: 'blob'
  }
}

export const extensions = ['bin', 'exe', 'png', 'jpg', 'jpeg', 'gif', 'pdf', 'zip', 'tar', 'gz']
export default BlobAdapter
