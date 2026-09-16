import { Typed, builtins } from '../typed.js'

test('typed: postfix chain resolves through named references', ({ check }) => {
  const t = Typed(); builtins(t)
  t.define('i', 'integer'); t.define('pk', 'i autoinc'); t.define('node-id', 'pk'); t.define('node-id-delta', 'node-id delta')
  const x = t.resolve('node-id-delta')
  check(x.kind, 'delta')
  check(x.base.kind, 'autoinc')
  check(x.base.base.base, 'integer')
})
