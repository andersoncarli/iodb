import { tmpdir } from 'os'
import { join } from 'path'
import DB from './db.js'

import { JsonCollection } from './30-json.js'
import { EnvCollection } from './40-env.js'
import { node, registerFilePlugins, registerCorePlugins, registerTaskPlugin, registerWorkerPlugin, _resetPlugins } from './node.js'
import { TRANSITION, ON } from './utils/src/bus.js'

async function withProjectTempDir(withTempDir, fn) {
  return await withTempDir(async (dir) => {
    // Setup global sentinels in the temp dir for walk-up tests
    DB(join(dir, 'MODELS.yaml'), 'file').in('PROVIDERS: { test: 1 }\n').flush()
    return await fn(dir)
  })
}

let _taskDir, _taskDb, _workerDb
beforeAll(async () => {
  const { mkdtemp } = await import('fs/promises')
  _taskDir = await mkdtemp(join(tmpdir(), 'io-task-'))

  _taskDb = DB({ path: _taskDir })
  _workerDb = DB({ path: _taskDir })
  _resetPlugins()
  registerFilePlugins(DB)
  registerCorePlugins(TRANSITION, ON)
  registerTaskPlugin(_taskDb)
  registerWorkerPlugin(_workerDb)
})

afterAll(async () => {
  if (_taskDir) DB(_taskDir).rm()
})

// ── JsonCollection ────────────────────────────────────────────────────────────

test('JsonCollection: get returns full projection', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'data.json')
    DB(file, 'json').in({ x: 1, y: 'hello' }).flush()
    const col = JsonCollection(file)
    col.open()
    check(col.get('x'), 1)
    check(col.get('y'), 'hello')
  })
})

test('JsonCollection: property access = get(key)', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'data.json')
    DB(file, 'json').in({ name: 'frm' }).flush()
    const col = JsonCollection(file)
    col.open()
    check(col.get('name'), 'frm')
    check(col.get('name'), col.get('name'))
  })
})

test('JsonCollection: #0 header, #1 projection', async ({ check, withTempDir }) => {
  await withProjectTempDir(withTempDir, async (dir) => {
    const file = join(dir, 'data.json')
    DB(file, 'json').in({ k: 'v' }).flush()
    const col = JsonCollection(file)
    col.open()
    check(col.get('#0')._type, 'json')
    check(col.get('#1').k, 'v')
  })
})

test('JsonCollection: in() persists and emits', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'data.json')
    DB(file, 'json').in({ a: 1 }).flush()
    const col = JsonCollection(file)
    col.open()
    const events = []
    col.out(e => events.push(e))
    col.in({ b: 2 })
    check(col.get('b'), 2)
    check(events.length, 1)
  })
})

// ── EnvCollection ─────────────────────────────────────────────────────────────

test('EnvCollection: parses KEY=VALUE', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const file = join(dir, '.env')
    DB(file, 'file').in('API_KEY=sk-test\nMODEL=gpt-4o\n').flush()
    const col = EnvCollection(file)
    col.open()
    check(col.get('API_KEY'), 'sk-test')
    check(col.get('MODEL'), 'gpt-4o')
  })
})

test('EnvCollection: ignores comments and blank lines', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const file = join(dir, '.env')
    DB(file, 'file').in('# comment\n\nKEY=val\n').flush()
    const col = EnvCollection(file)
    col.open()
    check(col.size, 1)
    check(col.get('KEY'), 'val')
  })
})

test('EnvCollection: property access = get(key)', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const file = join(dir, '.env')
    DB(file, 'file').in('FOO=bar\n').flush()
    const col = EnvCollection(file)
    col.open()
    check(col.FOO, 'bar')
  })
})

// ── node() walk-up ────────────────────────────────────────────────────────────

test('node: // walk-up finds MODELS.yaml', async ({ check, withTempDir }) => {
  await withProjectTempDir(withTempDir, async (dir) => {
    const n = node(join(dir, "MODELS.yaml"))
    check(!!(n))
    check(!!(n.PROVIDERS))
  })
})

test('node: //.yaml path traversal via property', async ({ check, withTempDir }) => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'cfg.yaml')
    DB(file, 'file').in('x: 99\n').flush()
    const n = node(file)
    check(!!(n))
    check(Number(n.x), 99)
  })
})

// ── task plugin ───────────────────────────────────────────────────────────────

test('task: node(>path) resolves to task node', ({ check, withTempDir }) => {
  const task = node('>plan>auth>fix')
  check(!!(task))
})

test('task: complete() sets status to complete', ({ check, withTempDir }) => {
  const task = node('>sprint>10>done')
  task.complete()
  check(task.status, 'complete')
})

test('task: in() patches state, get() returns it', ({ check }) => {
  const task = node('>sprint>10>patch')
  task.in({ priority: 'high' })
  check(task.get('priority'), 'high')
})
