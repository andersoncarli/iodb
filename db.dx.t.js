import { DB } from "./db.js";
import { node, registerAll } from "./node.js";
import { TRANSITION, ON } from "./utils/src/bus.js";
import { join } from "path";

test("DB DX: Polymorphic constructor and Global Initiation", async ({ check, withTempDir }) => {
  await withTempDir(async (root) => {
    // 1. Initial global DB init
    const db = DB({ path: root });
    check(db.path(), root);

    // 2. Secondary call without path should resolve to same root
    const db2 = DB('io');
    check(db2.path(), root);

    // 3. Named collection resolution using global root
    const modelsPath = join(root, 'DB', 'MODELS.yaml');
    DB('DB').open();
    DB(modelsPath, 'file').in("MODELS: { GPT4: 'v1' }").flush();

    const models = DB('MODELS');
    check(models.get('MODELS')?.GPT4, 'v1');

    // 4. Node //DB registration
    registerAll(DB, TRANSITION, ON);
    const dbNode = node('//DB');
    check(!!dbNode);
    check(typeof dbNode.stream, 'function');

    // 5. Node resolution via //DB
    const s = dbNode.stream('test.dash');
    check(is.defined(s.put));
  });
});
