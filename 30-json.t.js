import { JsonCollection } from './30-json.js';
import { join } from 'path';

test('JSON Adapter', async ({ check }) => {
  await withTempDir(async (tmp) => {
    const fp = join(tmp, 't.json');
    const db = JsonCollection(fp);
    db.in({ a: 1 }).flush();
    check(db.get().a, 1);
  });
});
