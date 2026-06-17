import { DB } from './db-factory.js'
import { join } from 'path'

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
