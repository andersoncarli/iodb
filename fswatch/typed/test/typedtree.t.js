import { TypedTree } from '../typedtree.js'

test('typedtree: walk visits parent before children, in insertion order', ({ check }) => {
  const t = TypedTree([{ id: 1, parent: null, name: 'root', type: 'd' }, { id: 2, parent: 1, name: 'a', type: 'd' }, { id: 3, parent: 2, name: 'b', type: 'f' }])
  const seen = []; t.walk(n => seen.push(n.id))
  check(seen.join(','), '1,2,3')
})
