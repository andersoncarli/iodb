import { DB } from "./db.js";

import { join } from "path";

test("Helix DB Architecture validates Singularity directory", async ({ check, withTempDir }) => {
  await withTempDir(async (customRoot) => {
    const db = DB("io", { path: customRoot });

    // Test dynamic stream creation and auto-folders
    const stream = db.stream("agents/test.flow");

    const token = stream.put("atom", { text: "hello singularity" });
    check(!!token);
    check((/^agents\/test#.*/).test(token));

    // Verify physical directory placement
    check(DB(join(customRoot, "DB", "agents", "test.flow")).exists);

    // Test KV creation
    const store = db.store("STATE/state.yaml");
    store.in({ branch: 'test', turnN: 99 });

    check(DB(join(customRoot, "DB", "STATE", "state.yaml")).exists);
    check(store.get('branch'), 'test');
  });
});
