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
  records.forEach(add)
  return { add, root, node, children: kids, walk, nodes }
}
