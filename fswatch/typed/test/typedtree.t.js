import { TypedTree } from '../typedtree.js'

test('typedtree: walk visits parent before children, in insertion order', ({ check }) => {
  const t = TypedTree([{ id: 1, parent: null, name: 'root', type: 'd' }, { id: 2, parent: 1, name: 'a', type: 'd' }, { id: 3, parent: 2, name: 'b', type: 'f' }])
  const seen = []; t.walk(n => seen.push(n.id))
  check(seen.join(','), '1,2,3')
})

test('typedtree: totals aggregates files/dirs/bytes under a node', ({ check }) => {
  const t = TypedTree([
    { id: 1, parent: null, name: 'root', type: 'd' },
    { id: 2, parent: 1, name: 'a', type: 'd' },
    { id: 3, parent: 2, name: 'b.txt', type: 'f', size: 100 },
    { id: 4, parent: 1, name: 'c.txt', type: 'f', size: 50 },
  ])
  check(t.totals(), { files: 2, dirs: 2, bytes: 150 })
  check(t.totals(2), { files: 1, dirs: 1, bytes: 100 })
})
