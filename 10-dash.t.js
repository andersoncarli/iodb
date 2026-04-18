/**
 * io/adapters/10-dash.t.js — Deep purity and round-trip tests for Dashed DSL.
 */
import { DashCollection, Node } from './10-dash.js'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { withTempDir } from '../withTempDir.js'

test('Dash: Node Proxy hierarchy navigation', () => {
  const root = Node('root', '', '', {}, { _hashes: {} })
  const sprint = Node('1-sprint', 'Sprint Title', 'h1', {}, {}, '1-sprint', root)
  const task = Node('1.1.1-task', 'Task Title', 'h2', { priority: 'high' }, {}, '1-sprint>1.1.1-task', root)

  root['1-sprint'] = sprint
  root['1-sprint>1.1.1-task'] = task
  root._hashes['1-sprint'] = 'h1'
  root._hashes['1-sprint>1.1.1-task'] = 'h2'

  expect(root['1-sprint'].title).toBe('Sprint Title')
  expect(root['1-sprint']['1.1.1-task'].priority).toBe('high')
  expect(root['1-sprint'].children.length).toBe(1)
  expect(root['1-sprint'].children[0].id).toBe('1.1.1-task')
})

test('Dash: Round-trip — basic hierarchy hashes survive stringify', async () => {
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
    expect(state.PROJECT._val).toBe('Helix Scale')
    expect(state.PROJECT._hash).toBe('p0')
    expect(state.meta.version).toBe(0.1)

    const task = state['1-sprint']['1.1-pillar']['1.1.1-task']
    expect(task.title).toBe('Task 1')
    expect(task.priority).toBe('low') // anonymous node override wins
    expect(task.notes).toContain('Line 1\nLine 2')

    const stringified = state.toString()
    expect(stringified).toContain('#s1')
    expect(stringified).toContain('#p1')
    expect(stringified).toContain('#t1')
    expect(stringified).toContain('#a1')
  })
})

test('Dash: Meta hash-anchored line parsed correctly', async () => {
  const raw = '-#m1: {"version":0.2,"env":"prod"}'
  await withTempDir(async tmp => {
    const fp = join(tmp, 'test.yaml')
    writeFileSync(fp, raw)
    const col = DashCollection(fp).open()
    const state = col.get()
    expect(state.meta).toBeDefined()
    expect(state.meta.version).toBe(0.2)
    expect(state.meta.env).toBe('prod')
    expect(state._hashes?.meta).toBe('m1')
    expect(state.toString()).toContain('#m1')
  })
})

test('Dash: Metadata hash persists in new collection after flush', async () => {
  await withTempDir(async tmp => {
    const fp = join(tmp, 'PLANS.yaml')
    const col = DashCollection(fp).open()

    col.in({ meta: { version: 0.1, priority: 'high' } })
    col.flush()

    const yaml = readFileSync(fp, 'utf8')
    // Key uses ALPHA alphabet: 0-9, a-z, A-Z, -, +
    expect(yaml).toMatch(/meta#[a-zA-Z0-9\-+]+: \{"version":0\.1,"priority":"high"\}/)
  })
})

test('Dash: Complex metadata tags parse correctly', async () => {
  const raw = '---1.1.2-feat: Test Features [critical, 4.5h, wip] { "owner": "jr" } #h9'
  await withTempDir(async tmp => {
    const fp = join(tmp, 'test.yaml')
    writeFileSync(fp, raw)
    const col = DashCollection(fp).open()
    const n = col.get('1.1.2-feat')

    expect(n.priority).toBe('critical')
    expect(n.estimate).toBe(4.5)
    expect(n.status).toBe('wip')
    expect(n.owner).toBe('jr')
    expect(n._hash).toBe('h9')
  })
})

test('Dash: Circular purity — parse → stringify → re-parse preserves data model', async () => {
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
    expect(out1).toContain('#mv')
    expect(out1).toContain('#s1')
    expect(out1).toContain('#p1')
    expect(out1).toContain('#t1')
    expect(out1).toContain('#t2')

    // Write and re-parse
    const fp2 = join(tmp, 'circ2.yaml')
    writeFileSync(fp2, out1)
    const col2 = DashCollection(fp2).open()
    const s2 = col2.get()

    // Semantic parity: same key data model
    expect(s2.meta?.version).toBe(s1.meta?.version)
    expect(s2['1-sprint']?.title).toBe(s1['1-sprint']?.title)

    const feat1 = s1['1-sprint']['1.1-pillar']['1.1.1-feat']
    const feat2 = s2['1-sprint']['1.1-pillar']['1.1.1-feat']
    expect(feat2?.title).toBe(feat1?.title)
    expect(feat2?.priority).toBe(feat1?.priority)
    expect(feat2?.estimate).toBe(feat1?.estimate)
    expect(feat2?.status).toBe(feat1?.status)

    // Hash stability across round-trip
    expect(s2._hashes?.['1-sprint']).toBeTruthy()
    expect(s2._hashes?.['1-sprint>1.1-pillar']).toBeTruthy()

    // Stringify pass 2 must contain same hashes as pass 1
    const out2 = s2.toString()
    expect(out2).toContain('#s1')
    expect(out2).toContain('#p1')
    expect(out2).toContain('#t1')
    expect(out2).toContain('#t2')
  })
})

test('Dash: Projection sync — col.in + flush writes correct YAML', async () => {
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
    expect(yaml).toContain('updated')
    expect(yaml).toMatch(/meta#[a-zA-Z0-9\-+]+:/)
  })
})
