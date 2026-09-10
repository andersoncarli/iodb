import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PagedText } from './pagedtext.js'

const dir = path.join(process.cwd(), '.pagedtext-test')
await fs.rm(dir, { recursive: true, force: true })
await fs.mkdir(dir, { recursive: true })

const file = path.join(dir, 'x.js')
await fs.writeFile(file, 'a\nb\nc\nd\n')

// The public model is a logical array of lines. Pagination and fillings are hidden.
const t = await PagedText({ path: file, kind: 'clike', pageSize: 4 })

assert.equal(t.length, 4)
assert.equal(t[0], 'a')
assert.equal(t.at(-1), 'd')
assert.deepEqual(t.slice(1, 3), ['b', 'c'])
assert.deepEqual([...t], ['a', 'b', 'c', 'd'])

// Array-like editing remains logical and filling is not exposed.
t[1] = 'B'
t.push('e')
assert.equal(t.pop(), 'e')
t.unshift('z')
assert.equal(t.shift(), 'z')
t.splice(1, 1, 'BB', 'BBB')
assert.deepEqual([...t], ['a', 'BB', 'BBB', 'c', 'd'])
assert.deepEqual(t.reverse(), ['d', 'c', 'BBB', 'BB', 'a'])

// Cursor is a change buffer. save() must not modify the source.
const c = t.cursor(2)
c.insert('X', 'Y').next().overwrite('CC').seek(0).write('A')
assert.equal(c.dirty, true)
const before = await fs.readFile(file, 'utf8')
await c.save()
assert.equal(await fs.readFile(file, 'utf8'), before)
const saved = JSON.parse(await fs.readFile(file + '.cursor', 'utf8'))
assert.equal(saved.dirty, true)

const c2 = await t.loadCursor()
assert.equal(c2.pos, saved.pos)
assert.deepEqual(c2.peek(5), saved.lines.slice(saved.pos, saved.pos + 5))

// flush() is the physical write boundary and remains atomic.
await c.flush()
const after = await fs.readFile(file, 'utf8')
assert.notEqual(after, before)
assert.ok(after.includes(' '))
assert.ok(!after.includes('//- pagedtext filling'))
assert.equal(c.dirty, false)

const pages = await t.pages()
assert.ok(pages.length > 1)
assert.ok(pages.every(p => p.index >= 0 && p.lines > 0))

// Comment filling is explicit, not the default.
const commentFile = path.join(dir, 'comment.js')
await fs.writeFile(commentFile, 'a\nb\nc\nd\n')
const comments = await PagedText({ path: commentFile, kind: 'clike', filling: 'comment', pageSize: 4 })
await comments.flush()
const commentRaw = await fs.readFile(commentFile, 'utf8')
assert.match(commentRaw, /\/\/- pagedtext filling/)
assert.deepEqual([...comments], ['a', 'b', 'c', 'd'])

// Existing filling is semantically invisible when reopened.
const reopened = await PagedText({ path: file, kind: 'clike', pageSize: 4 })
assert.deepEqual([...reopened], [...t])

await fs.rm(dir, { recursive: true, force: true })
console.log('✓ PagedText v0 tests passed')
