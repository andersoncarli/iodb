#!/usr/bin/env bun
/**
 * io-nutshell.t.js — Unit tests
 *
 * Run directly:  bun io-nutshell.t.js
 * Run via bot:   bot test io/io-nutshell.t.js
 */
import IO from './io-nutshell.js'
import { join } from 'path'
import { existsSync } from 'fs'

// ── Unit Tests ───────────────────────────────────────────────────

test("In Get Flush", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io = IO('store', { path: dir })
    io.in({ hello: 'world' })
    check(io.get('hello'), 'world')
    check(io.get().hello, 'world')
    io.in({ user: 'alice' })
    check(io.get('user'), 'alice')
    check(io.get('hello'), 'world')
  })
})

test("Buffered Writes", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io = IO('buf', { path: dir })
    const logFile = join(dir, 'buf.jsonl')
    io.in({ a: 1 }, false)
    io.in({ b: 2 }, false)
    // Flush commits buffered records to disk
    io.flush()
    check(existsSync(logFile))
    check(io.get(), { a: 1, b: 2 })
  })
})

test("Persistence Reload", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io1 = IO('persist', { path: dir })
    io1.in({ name: 'alice' })
    io1.in({ age: 30 })
    const io2 = IO('persist', { path: dir })
    check(io2.get('name'), 'alice')
    check(io2.get('age'), 30)
  })
})

test("Out Reactive", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io = IO('reactive', { path: dir })
    const received = []
    const off = io.out(({ key, payload }) => received.push({ key, payload }))
    const k1 = io.in({ x: 1 })
    const k2 = io.in({ y: 2 })
    check(received.length, 2)
    check(k1.startsWith('#'))
    check(k2.startsWith('#'))
    check(received[0].payload.x, 1)
    check(received[1].payload.y, 2)
    off()
    io.in({ z: 3 })
    check(received.length, 2)
  })
})

test("Hash Lookup", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io = IO('lookup', { path: dir })
    const k1 = io.in({ a: 1 })
    const k2 = io.in({ b: 2 })
    check(io.get(k1), { a: 1 })
    check(io.get(k2), { b: 2 })
  })
})

test("Chain Verification", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io = IO('chain', { path: dir })
    for (let i = 0; i < 20; i++) io.in({ i, v: Math.random() })
    const v = io.verify()
    check(v.valid)
    check(v.length > 0)
  })
})

test("Custom Reduce", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io = IO('stream', {
      path: dir,
      reduce: (acc, rec) => [...acc, rec],
      initial: [],
    })
    io.in({ msg: 'hello' })
    io.in({ msg: 'world' })
    check(io.get().length, 2)
    check(io.get()[0].msg, 'hello')
    check(io.get()[1].msg, 'world')
  })
})

// ── feature 3.3 — interface convergence with io-engine ───────────────────────
// Code written against io-engine calls io.open(payload) then io.close(). Both
// are optional on the nutshell (lazy genesis, projection on every flush), but
// they must EXIST and be harmless so the same code runs on either engine.

test("open/close are optional no-ops", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io = IO('lc', { path: dir })
    check(io.open(), io)       // chainable, like io-engine
    io.in({ a: 1 })
    check(io.close(), io)      // nothing to flush — projection already on disk
    check(io.get('a'), 1)

    // A second handle sees everything: close() left nothing pending.
    check(IO('lc', { path: dir }).get('a'), 1)
  })
})

test("open(payload) seeds record #0, like io-engine", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io = IO('seeded', { path: dir })
    io.open({ _entity: 'users', _type: 'kv' })
    io.in({ name: 'alice' })

    check(io.header()._entity, 'users')
    check(io.header()._type, 'kv')
    check(io.get('name'), 'alice')
  })
})

test("header / state / find match io-engine's readers", async ({ check, withTempDir }) => {
  await withTempDir(async dir => {
    const io = IO('rd', { path: dir, reduce: (acc, rec) => [...acc, rec], initial: [] })
    io.in({ kind: 'a', n: 1 })
    io.in({ kind: 'b', n: 2 })
    io.in({ kind: 'a', n: 3 })

    check(io.header()._type, 'io')          // default genesis header
    check(io.state()._projection, 'rd')
    check(io.find(p => p.kind === 'a').length, 2)
    check(io.find(p => p.n > 1).map(p => p.n).join(','), '2,3')
  })
})
