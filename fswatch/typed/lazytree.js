// filesystem topology is lazy; metadata is memoized and never touched by children()
import { lstat, readdir } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'

const kind = ent => Object.entries({
  d: ent.isDirectory(), f: ent.isFile(), l: ent.isSymbolicLink(), s: ent.isSocket(),
  b: ent.isBlockDevice(), c: ent.isCharacterDevice(), p: ent.isFIFO()
}).find(([, yes]) => yes)?.[0] || '?'

export function LazyTree(root, { firstId = 1 } = {}) {
  root = resolve(root)
  let nextId = firstId
  const cache = new Map()
  const make = (path, parent, name, type, id = nextId++) => {
    let children, meta, digest
    const node = {
      id, parent, name, type, path,
      children: async () => children ??= type == 'd'
        ? (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)).map(ent => make(join(path, ent.name), id, ent.name, kind(ent)))
        : [],
      stat: async () => meta ??= await lstat(path),
      hash: async () => digest ??= createHash('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex')
    }
    cache.set(id, node)
    return node
  }
  const rootNode = make(root, null, basename(root), 'd')
  return { root: rootNode, node: id => cache.get(id), size: () => cache.size, rootPath: root }
}
