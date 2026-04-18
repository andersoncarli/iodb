import { DB } from './db-factory.js'
import { join } from 'path'

test('DB Factory: Adapter Resolution', async () => {
  await withTempDir(async (tmp) => {
    // 1. JSON Resolution
    const jsonP = join(tmp, 'test.json')
    const dbJson = DB(jsonP)
    expect(dbJson.type).toBe('json')
    
    // 2. YAML Resolution
    const yamlP = join(tmp, 'test.yaml')
    const dbYaml = DB(yamlP)
    expect(dbYaml.type).toBe('yaml')
    
    // 3. JSONL Resolution
    const jsonlP = join(tmp, 'test.jsonl')
    const dbJsonl = DB(jsonlP)
    expect(dbJsonl.type).toBe('jsonl')
  })
})

test('DB Factory: Directory Resolution', async () => {
    await withTempDir(async (tmp) => {
        const db = DB(tmp, 'folder')
        expect(db.type).toBe('folder')
        expect(db.exists).toBe(true)
    })
})
