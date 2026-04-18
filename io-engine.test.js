import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import IO, { merge } from "./io-engine.js";
import { withTempDir } from "../withTempDir.js";

test("IO Basic Creation & Genesis", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "test.dash");
    const io = IO(file, { entity: "test", type: "kv" });
    io.open();
    
    expect(existsSync(file)).toBe(true);
    expect(io.header()._entity).toBe("test");
  });
});

test("IO Write & Projection", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "test.dash");
    const io = IO(file, { reduce: merge });
    io.open();
    
    io.in({ user: { name: "Alice", age: 30 } });
    expect(io.get("#1").user.name).toBe("Alice");
    
    io.in({ user: { age: 31 } });
    expect(io.get("#1").user.age).toBe(31);
  });
});

test("IO Concurrent Writes (High Density)", async () => {
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
    for (let i = 0; i < 50; i++) expect(state[`key_${i}`]).toBe(i);
  });
});

test("IO Mixed Format Detection", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "test.dash");
    const io = IO(file, { reduce: merge });
    io.open();
    
    const { appendFileSync } = require("fs");
    appendFileSync(file, JSON.stringify({ "manual": "val" }) + "\n");
    
    io.open(); 
    expect(io.get("#1").manual).toBe("val");
  });
});
