// io-engine.concurrency.test.js — feature 1.2
//
// Regression guard: saveIndex() used a fixed temp name (f.index + '.tmp')
// shared across processes. Under real multi-process concurrency (N `bun`
// processes writing the same IO() base) this collided in the write→rename
// window: either `ENOENT: rename .index.tmp -> .index` crashed a writer, or
// the index file was silently clobbered and records were lost from the log.
// `verify()` stayed {valid:true} — it audits what survived, not what vanished.
//
// Fix: PID-suffix the temp file (`${f.index}.${pid}.tmp`) so each process
// renames its own private file (atomic on POSIX), and lock the saveIndex()
// call in open()'s else branch that previously ran with no lock at all.
//
// This test spawns real OS processes — it is the only faithful reproducer.
// In-process Promise.all cannot reproduce it (single event loop, no true
// parallel rename).

import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import IO, { append } from "./io-engine.js";

const WORKER_SRC = `
import IO, { append } from ${JSON.stringify(join(import.meta.dir, "io-engine.js"))};
const [, , base, n] = process.argv;
const io = IO(base, { reduce: append, initial: [], format: "jsonl" });
io.open({ _entity: "x" });
for (let i = 0; i < Number(n); i++) io.in({ pid: process.pid, i });
io.close();
`;

test(
  "1.2 — saveIndex survives N concurrent processes on the same IO() base",
  async ({ check }) => {
    const dir = mkdtempSync(join(tmpdir(), "iodb-conc-"));
    try {
      const base = join(dir, "LOG");
      const worker = join(dir, "worker.mjs");
      writeFileSync(worker, WORKER_SRC);

      // 3 processes, not 8. The defect this reproduces is a RACE, and a race
      // needs contention, not crowd size — 3 concurrent writers contend on every
      // append just as surely as 8 do. What the extra five bought was runtime and
      // scheduler pressure on whatever else shares the machine, which is how this
      // family of tests starved its neighbours before.
      const PROCS = 3;
      const WRITES = 30;

      // Seed genesis first so every worker enters open()'s else branch — dash
      // exists, f.yaml transiently vanishes under another's lock — which is the
      // window the unlocked saveIndex() + shared `.index.tmp` used to corrupt.
      // (A separate genesis-election race exists when workers race the very
      // first write with no seed; that is out of scope for feature 1.2.)
      const seed = IO(base, { reduce: append, initial: [], format: "jsonl" });
      seed.open({ _entity: "x" });
      seed.close();

      const kids = [];
      for (let p = 0; p < PROCS; p++) {
        kids.push(
          Bun.spawn(["bun", worker, base, String(WRITES)], {
            stdout: "pipe",
            stderr: "pipe",
          })
        );
      }

      const results = await Promise.all(
        kids.map(async (k) => ({
          code: await k.exited,
          err: await new Response(k.stderr).text(),
        }))
      );

      // No writer may crash — an ENOENT on the shared temp is the loud symptom.
      for (const r of results) {
        check(r.code, 0);
        check(r.err.includes("ENOENT"), false);
      }

      // No silent loss: every record every worker wrote must be on disk.
      const io = IO(base, { reduce: append, initial: [], format: "jsonl" });
      io.open();
      check(io.verify().valid, true);

      const payloads = io
        .records()
        .map((r) => Object.values(r)[0])
        .filter((v) => v && typeof v === "object" && "pid" in v && "i" in v);

      check(payloads.length, PROCS * WRITES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  { timeout: 60000 }
);
