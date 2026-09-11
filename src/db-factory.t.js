import { DB } from './db-factory.js'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { TabularProjection } from './tabular-projection.js'
import { isTable, capabilities } from './table/contract.js'
import { toArray } from './table/cursor.js'

test('DB Factory: Adapter Resolution',  async ({check, withTempDir}) => {
  await withTempDir(async (tmp) => {
    // 1. JSON Resolution
    const jsonP = join(tmp, 'test.json')
    const dbJson = DB(jsonP)
    check(dbJson.type, 'json')

    // 2. YAML Resolution
    const yamlP = join(tmp, 'test.yaml')
    const dbYaml = DB(yamlP)
    check(dbYaml.type, 'yaml')

    // 3. JSONL Resolution
    const jsonlP = join(tmp, 'test.jsonl')
    const dbJsonl = DB(jsonlP)
    check(dbJsonl.type, 'jsonl')
  })
})

test('DB Factory: Directory Resolution',  async ({check, withTempDir}) => {
    await withTempDir(async (tmp) => {
        const db = DB(join(tmp, 'folder-adapter'), { type: 'folder' })
        check(db.type, 'folder')
        check(db.exists)
    })
})

test('DB Factory: open collection from template',  async ({check, withTempDir}) => {
  await withTempDir(async (tmp) => {
    const root = DB({ path: tmp })
    const dir = join(tmp, 'DB', 'PLANS')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'PLANS-TEMPLATE.yaml'), '1: Sprint\n\n1.1: Pillar\n\n1.1.1: First task [critical, 1h]\n')

    const plans = root.open('PLANS', { type: 'dash', template: 'PLANS-TEMPLATE.yaml' })
    const task = plans.get('1>1.1>1.1.1')

    check(task.id, '1.1.1')
    check(task.title, 'First task')
    check(task.priority, 'critical')
  })
})

test('DB Factory: factory.table(name) resolve uma Table do contrato (8.7)', async ({ check, withTempDir }) => {
  await withTempDir(async (tmp) => {
    const factory = DB({ path: tmp })
    const dbDir = join(tmp, 'DB')
    mkdirSync(dbDir, { recursive: true })

    const proj = TabularProjection(join(dbDir, 'users.csv'), { schema: 'id:int!,name:str@,age:int' })
    proj.push({ id: 1, name: 'Ana', age: 26 })
    proj.push({ id: 2, name: 'Bob', age: 31 })
    proj.flush()

    const t = factory.table('users')
    check(isTable(t), true)
    check(capabilities(t).has.get, true)
    const rows = toArray(t.scan()).map(r => r.name).sort()
    check(rows, ['Ana', 'Bob'])

    // mesma sessao da factory, mesmo nome -> mesma Table (cache)
    check(factory.table('users') === t, true)
  })
})
