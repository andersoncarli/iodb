/**
 * io/adapters/60-node.js — Universal Node-Chain Adapter for Filesystems.
 * 
 * Treats any folder as a bit-addressable database.
 */
import { existsSync, statSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'fs'
import { join, resolve, dirname } from 'path'

export const NodeAdapter = (rootPath, opts = {}) => {
  const root = resolve(rootPath)
  
  const node = {
    open: () => {
      if (existsSync(root)) {
        if (!statSync(root).isDirectory()) throw new Error(`[NodeAdapter] ${root} exists but is not a directory`)
        return
      }
      mkdirSync(root, { recursive: true })
    },
    
    /** node.get('path/to/file') */
    get: (key) => {
      const fullPath = join(root, key || '')
      if (!existsSync(fullPath)) return undefined
      
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        // Return a child factory/adapter for this folder
        return NodeAdapter(fullPath, opts)
      }
      
      // Return file content (auto-parse if json/yaml?)
      const content = readFileSync(fullPath, 'utf8')
      if (fullPath.endsWith('.json')) return JSON.parse(content)
      // We could add YAML here, but let's keep it simple for now as 'raw'
      return content
    },

    /** node.has('path') replaces fs.existsSync */
    has: (key) => existsSync(join(root, key || '')),
    exists: (key) => existsSync(join(root, key || '')),

    /** node.in({ 'file.txt': 'content' }) */
    in: (patch) => {
      for (const [key, val] of Object.entries(patch)) {
        const fullPath = join(root, key)
        const dir = dirname(fullPath)
        if (existsSync(dir)) {
          if (!statSync(dir).isDirectory()) throw new Error(`[NodeAdapter] ${dir} exists but is not a directory`)
        } else {
          mkdirSync(dir, { recursive: true })
        }
        
        const content = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)
        writeFileSync(fullPath, content)
      }
      return node // return the factory instance
    },

    /** node.keys() replaces readdirSync */
    keys: () => existsSync(root) ? readdirSync(root) : [],
    
    ls: () => existsSync(root) ? readdirSync(root) : [],
    flush: () => {},
    state: () => ({ root }),
    path: () => root,
    rm: (key) => {
      const fullPath = join(root, key || '')
      if (existsSync(fullPath)) rmSync(fullPath, { recursive: true, force: true })
    },
    hasChildren: () => true, // Anything using NodeAdapter is a folder/branch
    type: 'node',
    id: root
  }
  return node
}

export default NodeAdapter
