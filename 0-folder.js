import { existsSync, readdirSync, statSync, mkdirSync } from 'fs'
import { join } from 'path'
import { NodeAdapter } from './60-node.js'

export const FolderAdapter = (path, opts = {}) => ({
  open: () => {
    if (!existsSync(path) && !opts.readOnly) mkdirSync(path, { recursive: true })
  },
  get: (key) => {
    const full = join(path, key || '')
    if (!existsSync(full)) return undefined
    const stat = statSync(full)
    if (stat.isDirectory()) return NodeAdapter(full, opts)
    return globalThis.__DB_FACTORY__?.(full, opts)
  },
  ls: () => existsSync(path) ? readdirSync(path) : [],
  keys: () => existsSync(path) ? readdirSync(path) : [],
  has: (key) => existsSync(join(path, key)),
  path: () => path,
  hasChildren: () => true,
  state: () => ({ path, type: 'folder' }),
  type: 'folder'
})

export default FolderAdapter
