import { existsSync, readFileSync } from "fs";
import { join } from "path";
import IO, { merge } from "./io-engine.js";
import { withTempDir } from "../withTempDir.js";

test("IO Basic Creation & Genesis",  async ({check}) => {
  await withTempDir(async (dir) => {
    const file = join(dir, "test.dash");
    const io = IO(file, { entity: "test", type: "kv" });
    io.open();

    check(existsSync(file));
    check(io.header()._entity, "test");
  });
});

test("IO Write & Projection",  async ({check}) => {
  await withTempDir(async (dir) => {
    const file = join(dir, "test.dash");
    const io = IO(file, { reduce: merge });
    io.open();

    io.in({ user: { name: "Alice", age: 30 } });
    check(io.get("#1").user.name, "Alice");

    io.in({ user: { age: 31 } });
    check(io.get("#1").user.age, 31);
  });
});

test("IO Concurrent Writes (High Density)",  async ({check}) => {
  await withTempDir(async (dir) => {
    const file = join(dir, "test.dash");
    const io = IO(file, { reduce: merge });
    io.open();

    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(Promise.resolve().then(() => io.in({ [`key_${i}`]: i })));
    }
    await Promise.all(promises);
    const state = io.get("#1");
    for (let i = 0; i < 50; i++) check(state[`key_${i}`], i);
  });
});

test("IO Mixed Format Detection",  async ({check}) => {
  await withTempDir(async (dir) => {
    const file = join(dir, "test.dash");
    const io = IO(file, { reduce: merge });
    io.open();

    const { appendFileSync } = require("fs");
    appendFileSync(file, JSON.stringify({ "manual": "val" }) + "\n");

    io.open();
    check(io.get("#1").manual, "val");
  });
});
