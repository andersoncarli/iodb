/**
 * io/adapters/10-dash.t.js — Deep purity and round-trip tests for Dashed DSL.
 */
import { DashCollection, Node } from './dash.js'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'

test('Dash: Node Proxy hierarchy navigation', ({check}) => {
  const root = Node('root', '', '', {}, { _hashes: {} })
  const sprint = Node('1-sprint', 'Sprint Title', 'h1', {}, {}, '1-sprint', root)
  const task = Node('1.1.1-task', 'Task Title', 'h2', { priority: 'high' }, {}, '1-sprint>1.1.1-task', root)

  root['1-sprint'] = sprint
  root['1-sprint>1.1.1-task'] = task
  root._hashes['1-sprint'] = 'h1'
  root._hashes['1-sprint>1.1.1-task'] = 'h2'

  check(root['1-sprint'].title, 'Sprint Title')
  check(root['1-sprint']['1.1.1-task'].priority, 'high')
  check(root['1-sprint'].children.length, 1)
  check(root['1-sprint'].children[0].id, '1.1.1-task')
})

test('Dash: Round-trip — basic hierarchy hashes survive stringify',  async ({ check, withTempDir }) => {
  const raw = [
    'PROJECT: Helix Scale #p0',
    '-: {"version":0.1}',
    '',
    '-1-sprint#s1: Sprint 1',
    '--1.1-pillar#p1: Pillar 1',
    '---1.1.1-task#t1: Task 1 [high, 1h, open]',
    '----notes: |',
    '  Line 1',
    '  Line 2',
    '---#a1: {"priority":"low"}'
  ].join('\n')

  await withTempDir(async tmp => {
    const fp = join(tmp, 'test.yaml')
    writeFileSync(fp, raw)
    const col = DashCollection(fp).open()

    const state = col.get()
    check(state.PROJECT._val, 'Helix Scale')
    check(state.PROJECT._hash, 'p0')
    check(state.meta.version, 0.1)

    const task = state['1-sprint']['1.1-pillar']['1.1.1-task']
    check(task.title, 'Task 1')
    check(task.priority, 'low') // anonymous node override wins
    check((task.notes)?.includes?.('Line 1\nLine 2'))

    const stringified = state.toString()
    check((stringified)?.includes?.('#s1'))
    check((stringified)?.includes?.('#p1'))
    check((stringified)?.includes?.('#t1'))
    check((stringified)?.includes?.('#a1'))
  })
})

test('Dash: Meta hash-anchored line parsed correctly',  async ({ check, withTempDir }) => {
  const raw = '-#m1: {"version":0.2,"env":"prod"}'
  await withTempDir(async tmp => {
    const fp = join(tmp, 'test.yaml')
    writeFileSync(fp, raw)
    const col = DashCollection(fp).open()
    const state = col.get()
    check((state.meta) !== undefined)
    check(state.meta.version, 0.2)
    check(state.meta.env, 'prod')
    check(state._hashes?.meta, 'm1')
    check((state.toString())?.includes?.('#m1'))
  })
})

test('Dash: Metadata hash persists in new collection after flush',  async ({ check, withTempDir }) => {
  await withTempDir(async tmp => {
    const fp = join(tmp, 'PLANS.yaml')
    const col = DashCollection(fp).open()

    col.in({ meta: { version: 0.1, priority: 'high' } })
    col.flush()

    const yaml = readFileSync(fp, 'utf8')
    // Key uses ALPHA alphabet: 0-9, a-z, A-Z, -, +
    check((/meta#[a-zA-Z0-9\-+]+: \{"version":0\.1,"priority":"high"\}/).test(yaml))
  })
})

test('Dash: Complex metadata tags parse correctly',  async ({ check, withTempDir }) => {
  const raw = '---1.1.2-feat: Test Features [critical, 4.5h, wip] { "owner": "jr" } #h9'
  await withTempDir(async tmp => {
    const fp = join(tmp, 'test.yaml')
    writeFileSync(fp, raw)
    const col = DashCollection(fp).open()
    const n = col.get('1.1.2-feat')

    check(n.priority, 'critical')
    check(n.estimate, 4.5)
    check(n.status, 'wip')
    check(n.owner, 'jr')
    check(n._hash, 'h9')
  })
})

test('Dash: Circular purity — parse → stringify → re-parse preserves data model',  async ({ check, log, withTempDir }) => {
  const raw = [
    '-#mv: {"version":1}',
    '',
    '-1-sprint#s1: Sprint Alpha',
    '--1.1-pillar#p1: Core',
    '---1.1.1-feat#t1: Feature A [high, 2h, wip]',
    '---1.1.2-fix#t2: Fix B [medium]',
  ].join('\n')

  await withTempDir(async tmp => {
    const fp = join(tmp, 'circ.yaml')
    writeFileSync(fp, raw)

    // First parse
    const col1 = DashCollection(fp).open()
    const s1 = col1.get()

    // Stringify pass 1: all hashes must survive
    const out1 = s1.toString()
    check(out1.includes('#mv'))
    check(out1.includes('#s1'))
    check(out1.includes('#p1'))
    check(out1.includes('#t1'))
    check(out1.includes('#t2'))

    // Write and re-parse
    const fp2 = join(tmp, 'circ2.yaml')
    writeFileSync(fp2, out1)
    const col2 = DashCollection(fp2).open()
    const s2 = col2.get()

    // Semantic parity: same key data model
    check(s2.meta?.version, s1.meta?.version)
    check(s2['1-sprint']?.title, s1['1-sprint']?.title)

    const feat1 = s1['1-sprint']['1.1-pillar']['1.1.1-feat']
    const feat2 = s2['1-sprint']['1.1-pillar']['1.1.1-feat']
    check(feat2.title, feat1.title)
    check(feat2.priority, feat1.priority)
    check(feat2.estimate, feat1.estimate)
    check(feat2.status, feat1.status)

    // Hash stability across round-trip
    log('s2._hashes', s2._hashes)
    check(!!s2._hashes?.['1-sprint'])
    check(!!s2._hashes?.['1-sprint>1.1-pillar'])

    // Stringify pass 2 must contain same hashes as pass 1
    const out2 = s2.toString()
    check(out2.includes?.('#s1'))
    check(out2.includes?.('#p1'))
    check(out2.includes?.('#t1'))
    check(out2.includes?.('#t2'))
  })
})

test('Dash: Projection sync — col.in + flush writes correct YAML',  async ({ check, withTempDir }) => {
  const raw = [
    '-1-sprint#s1: Sprint 1',
    '--1.1-pillar#p1: Pillar 1',
    '---1.1.1-task#t1: Old Title',
  ].join('\n')

  await withTempDir(async tmp => {
    const fp = join(tmp, 'proj.yaml')
    writeFileSync(fp, raw)
    const col = DashCollection(fp).open()

    col.in({ meta: { updated: true } })
    col.flush()

    const yaml = readFileSync(fp, 'utf8')
    check((yaml)?.includes?.('updated'))
    check((/meta#[a-zA-Z0-9\-+]+:/).test(yaml))
  })
})
