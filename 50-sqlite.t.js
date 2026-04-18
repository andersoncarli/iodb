import { SqliteCollection } from './50-sqlite.js';
import { join } from 'path';

test('SQLite Adapter', async () => {
  await withTempDir(async (tmp) => {
    const fp = join(tmp, 't.db');
    const db = SqliteCollection(fp);
    expect(db).toBeDefined();
  });
});
