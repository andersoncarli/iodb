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
    let children, meta, digest, totals
    const node = {
      id, parent, name, type, path,
      children: async () => children ??= type == 'd'
        ? (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)).map(ent => make(join(path, ent.name), id, ent.name, kind(ent)))
        : [],
      stat: async () => meta ??= await lstat(path),
      hash: async () => digest ??= createHash('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex'),
      // Aggregate file/dir count and byte size under this node. Children are
      // totalled CONCURRENTLY, same as TypedScanner's bounded stat() pass — no
      // new sequential bottleneck. Memoized like stat()/hash() above.
      totals: async () => totals ??= type == 'd'
        ? (await Promise.all((await node.children()).map(c => c.totals())))
            .reduce((a, b) => ({ files: a.files + b.files, dirs: a.dirs + b.dirs, bytes: a.bytes + b.bytes }), { files: 0, dirs: 1, bytes: 0 })
        : { files: 1, dirs: 0, bytes: (await node.stat()).size }
    }
    cache.set(id, node)
    return node
  }
  const rootNode = make(root, null, basename(root), 'd')
  return { root: rootNode, node: id => cache.get(id), size: () => cache.size, rootPath: root }
}
