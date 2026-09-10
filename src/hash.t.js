import { encodeSeq, decodeSeq } from './hash.js'

test('hash', ({ check }) => {
  check(encodeSeq(0), '0')
  check(encodeSeq(1), '1')
  check(encodeSeq(2), '2')
  check(encodeSeq(9), '9')
  check(encodeSeq(10), 'a')
  check(encodeSeq(63), '+')
  check(encodeSeq(64), '10')

  check(decodeSeq('2'), 2)
  check(decodeSeq('a'), 10)
  check(decodeSeq('10'), 64)

  test('Roundtrip: 0..2000', ({ check }) => {
    for (let n = 0; n < 2000; n++) {
      const s = encodeSeq(n)
      const d = decodeSeq(s)
      if (d !== n) throw new Error(`Fail at ${n}: ${s} -> ${d}`)
    }
    check(true)
  })
})
