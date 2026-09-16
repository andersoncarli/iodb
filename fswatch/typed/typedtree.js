// topology-only tree; nodes are plain records and children are indexed by parent id
export function TypedTree(records = []) {
  const nodes = new Map(), children = new Map()
  const add = node => {
    nodes.set(node.id, node)
    if (node.parent != null) (children.get(node.parent) ?? children.set(node.parent, []).get(node.parent)).push(node)
    return node
  }
  const root = () => [...nodes.values()].find(node => node.parent == null)
  const node = id => nodes.get(id)
  const kids = parent => children.get(parent.id ?? parent) || []
  const walk = (fn, start = root()) => start && (fn(start), kids(start).forEach(child => walk(fn, child)))
  const isDir = n => n.kind === 'dir' || n.type === 'd'
  // Aggregate file/dir count and byte size under a node, memoized per instance —
  // the tree is rebuilt from records on every TypedTree() call, so there is no
  // incremental invalidation to manage.
  const totalsCache = new Map()
  const totals = (start = root()) => {
    if (!start) return { files: 0, dirs: 0, bytes: 0 }
    const key = start.id ?? start
    if (totalsCache.has(key)) return totalsCache.get(key)
    const n = node(key) ?? start
    const acc = { files: 0, dirs: 0, bytes: 0 }
    walk(x => isDir(x) ? acc.dirs++ : (acc.files++, acc.bytes += x.size || 0), n)
    totalsCache.set(key, acc)
    return acc
  }
  records.forEach(add)
  return { add, root, node, children: kids, walk, totals, nodes }
}
