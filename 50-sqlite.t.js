import { SqliteCollection } from './50-sqlite.js';
import { join } from 'path';

test('SQLite Adapter',  async ({check}) => {
  await withTempDir(async (tmp) => {
    const fp = join(tmp, 't.db');
    const db = SqliteCollection(fp);
    check(is.defined(db));
  });
});
