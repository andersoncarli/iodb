import { test, expect, beforeAll, afterAll } from "bun:test";
import { rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import IO, { merge } from "./io-engine.js";

const TEST_DIR = "DB/TEST_IO";
const TEST_FILE = join(TEST_DIR, "test.dash");

beforeAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

test("IO Basic Creation & Genesis", () => {
  const io = IO(TEST_FILE, { entity: "test", type: "kv" });
  io.open();
  
  expect(existsSync(TEST_FILE)).toBe(true);
  expect(existsSync(join(TEST_DIR, "test.yaml"))).toBe(true);
  expect(existsSync(join(TEST_DIR, "test.index"))).toBe(true);
  
  const header = io.header();
  expect(header._entity).toBe("test");
  expect(header._type).toBe("kv");
});

test("IO Write & Projection", () => {
  const io = IO(TEST_FILE, { reduce: merge });
  io.open();
  
  io.in({ user: { name: "Alice", age: 30 } });
  let state = io.get("#1");
  expect(state.user.name).toBe("Alice");
  
  io.in({ user: { age: 31 } });
  state = io.get("#1");
  expect(state.user.age).toBe(31);
  expect(state.user.name).toBe("Alice");
});

test("IO Concurrent Writes (High Density)", async () => {
  const io = IO(TEST_FILE, { reduce: merge });
  io.open();
  
  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(Promise.resolve().then(() => io.in({ [`key_${i}`]: i })));
  }
  
  await Promise.all(promises);
  const state = io.get("#1");
  
  for (let i = 0; i < 50; i++) {
    expect(state[`key_${i}`]).toBe(i);
  }
  
  expect(io.size).toBeGreaterThanOrEqual(52); // 50 + 2 genesis
});

test("IO Mixed Format Detection (Dash & JSONL)", () => {
  const io = IO(TEST_FILE, { reduce: merge });
  io.open();
  
  // Manually corrupt with a JSONL line
  const jsonl = JSON.stringify({ "manual_key": { "val": "jsonl" } }) + "\n";
  const { appendFileSync } = require("fs");
  appendFileSync(TEST_FILE, jsonl);
  
  // Should still sync correctly
  io.open(); // Triggers sync
  const state = io.get("#1");
  expect(state.val).toBe("jsonl");
});

test("IO Hash Addressing", () => {
  const io = IO(TEST_FILE);
  io.open();
  
  const hash = io.in({ msg: "Hello" });
  expect(hash.startsWith("#")).toBe(true);
  
  const retrieved = io.get(hash);
  expect(retrieved.msg).toBe("Hello");
});
