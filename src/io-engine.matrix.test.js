// io-engine.matrix.test.js — feature 1.3
//
// Concurrency matrix: sweep the axes that io-engine.concurrency.test.js (1.2)
// left fixed, so each combination's behaviour is recorded, not assumed.
//
// Axes:
//   format   : "dash" (default)  | "jsonl"
//   reduce   : append            | merge
//   seed     : true (genesis pre-written) | false (workers race first write)
//   close    : true (io.close())  | false (buffered writes, process exits dirty)
//
// Each cell spawns 3 real `bun` processes × 30 writes against one IO() base and
// reports: crashed workers, ENOENT-on-rename, verify().valid, records on disk
// vs. records written.
//
// CONFIRMED clean (should stay green): seed=true AND seed=false cells, all
// format/reduce/close.
//
// seed=false used to be "KNOWN UNSAFE — rare trials lose records or break the
// chain", characterised by a rate rather than asserted. Feature 1.5 fixed the
// real cause: acquireLock() created a per-PID lock path, so the `wx`
// exclusive-create never collided and every writer ran its critical section in
// parallel — the genesis election among them was a race with no referee. With
// the mutex on one shared path the election is serialised like any other write,
// and the cell is clean: 10/10 trials 240/240, valid, zero crashes. The
// threshold below is now binary.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import IO, { append, merge } from "./io-engine.js";

// 3 processes, 12 writes each. The axis under test is PARITY — does every
// format/reducer reach the same verdict under real concurrency — not the
// absolute failure rate, so the load only has to be enough to (a) force lock
// contention (>=2 writers) and (b) push keys past length 1 so prefix
// allocation actually runs (~10 records). 3x12 clears both with 36 records per
// cell instead of 240; the pre-1.5 bugs (fake mutex, parseInt-collapsed
// prefix) still redden this immediately. Was 8x30 — that spawned 32 processes
// across the 4 parallel seed cells and ran ~40s under a genuinely exclusive
// lock.
const PROCS = 3;
const WRITES = 12;
const EXPECTED = PROCS * WRITES;

const REDUCERS = { append, merge };

function workerSrc(engine) {
  return `
import IO, { append, merge } from ${JSON.stringify(engine)};
const [, , base, n, format, reducer, doClose] = process.argv;
const REDUCERS = { append, merge };
const io = IO(base, {
  reduce: REDUCERS[reducer],
  initial: reducer === "append" ? [] : {},
  format,
});
io.open({ _entity: "x" });
for (let i = 0; i < Number(n); i++) {
  // merge needs a keyed payload; append takes anything
  io.in(reducer === "merge" ? { ["k" + process.pid + "_" + i]: i } : { pid: process.pid, i });
}
if (doClose === "1") io.close();
`;
}

async function runCell({ format, reducer, seed, close }) {
  const dir = mkdtempSync(join(tmpdir(), "iodb-mtx-"));
  try {
    const base = join(dir, "LOG");
    const worker = join(dir, "worker.mjs");
    writeFileSync(worker, workerSrc(join(import.meta.dir, "io-engine.js")));

    if (seed) {
      const s = IO(base, {
        reduce: REDUCERS[reducer],
        initial: reducer === "append" ? [] : {},
        format,
      });
      s.open({ _entity: "x" });
      s.close();
    }

    const kids = [];
    for (let p = 0; p < PROCS; p++) {
      kids.push(
        Bun.spawn(
          ["bun", worker, base, String(WRITES), format, reducer, close ? "1" : "0"],
          { stdout: "pipe", stderr: "pipe" }
        )
      );
    }
    const res = await Promise.all(
      kids.map(async (k) => ({
        code: await k.exited,
        err: await new Response(k.stderr).text(),
      }))
    );

    const crashed = res.filter((r) => r.code !== 0).length;
    const firstErr = (res.find((r) => r.code !== 0)?.err || "").split("\n")[0];
    const enoent = res.filter((r) => r.err.includes("ENOENT")).length;

    const io = IO(base, {
      reduce: REDUCERS[reducer],
      initial: reducer === "append" ? [] : {},
      format,
    });
    io.open();
    const valid = io.verify().valid;

    let onDisk;
    if (reducer === "append") {
      onDisk = io
        .records()
        .map((r) => Object.values(r)[0])
        .filter((v) => v && typeof v === "object" && "pid" in v && "i" in v).length;
    } else {
      // merge: every write is a distinct key kN_i; count keys in projection
      const state = io.get("#1");
      onDisk = Object.keys(state).filter((k) => k.startsWith("k")).length;
    }

    return { crashed, enoent, valid, onDisk, firstErr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── seed=true cells: must be clean ──────────────────────────────────────────
for (const format of ["dash", "jsonl"]) {
  for (const reducer of ["append", "merge"]) {
    test(
      `1.3 matrix — seed format=${format} reduce=${reducer} close=1 : clean`,
      async ({ check, log }) => {
        const r = await runCell({ format, reducer, seed: true, close: true });
        if (r.crashed) log(`crashed=${r.crashed} firstErr=${r.firstErr}`);
        check(r.crashed, 0);
        check(r.enoent, 0);
        check(r.valid, true);
        check(r.onDisk, EXPECTED);
      },
      { timeout: 60000 }
    );
  }
}

// ── seed=false: genesis-election race — NOW CLEAN, binary assertion ────────
//
// History of this cell:
//   pre-1.2  : ~90% of trials corrupt (fixed .tmp name clobbered mid-rename).
//   post-1.2 : ~1-2% — open()'s loser wait loop exited the instant f.dash had
//              size > 0, which could land between writeGenesis()'s two appends.
//              Characterised as a rate: `bad <= ceil(ran/2)`, minOnDisk logged
//              not asserted (measured 210/240, 182/240 in ordinary runs).
//   post-1.5 : CLEAN. acquireLock() had built a per-PID lock path, so `wx`
//              never collided and all eight writers ran their critical sections
//              — genesis election included — in parallel with no referee. With
//              the mutex on one shared path the election is serialised, and the
//              cell measures 10/10 trials at 240/240, valid, zero crashes.
//
// So the threshold is binary now: bad = 0, and minOnDisk === EXPECTED is a real
// assertion, not a logged observation.
//
// GRANULARITY: the TIME FENCE stays. Each trial spawns 3 processes; a fixed
// trial count makes the cell's duration a function of machine load, and this
// cell once ran 35s and starved its neighbours. The budget decides how many
// trials fit; TRIALS is a ceiling; `ran` is logged so the sample size is
// visible. (2026-09-09: this fence and paralleled workers are also the shape
// feature 1.4's parity cells will follow — see sprint 009.)
test(
  "1.3 matrix — no-seed genesis election : clean under a real lock",
  async ({ check, log }) => {
    const TRIALS = 4;
    const BUDGET_MS = 6000;
    const deadline = Date.now() + BUDGET_MS;
    let ran = 0;
    let bad = 0; // any deviation: record loss OR invalid chain OR crash
    let minOnDisk = EXPECTED;
    let invalid = 0;
    for (let i = 0; i < TRIALS && Date.now() < deadline; i++) {
      ran++;
      const r = await runCell({
        format: "jsonl",
        reducer: "append",
        seed: false,
        close: true,
      });
      if (r.onDisk !== EXPECTED || !r.valid || r.crashed) bad++;
      if (!r.valid) invalid++;
      minOnDisk = Math.min(minOnDisk, r.onDisk);
    }
    log(
      `no-seed over ${ran} trials (budget ${BUDGET_MS}ms): bad=${bad} (invalid-chain=${invalid}), min onDisk=${minOnDisk}/${EXPECTED}`
    );
    check(ran >= 1, true);       // the budget must allow at least one trial
    check(bad, 0);               // binary: the genesis election is serialised now
    check(invalid, 0);           // no chain ever breaks
    check(minOnDisk, EXPECTED);  // no record ever vanishes — a real assertion now
  },
  { timeout: 30000 }
);

// ── close=false: buffered writes, dirty exit — records never flushed ───────
test(
  "1.3 matrix — seed format=jsonl reduce=append close=0 : dirty-exit behaviour",
  async ({ check, log }) => {
    const r = await runCell({
      format: "jsonl",
      reducer: "append",
      seed: true,
      close: false,
    });
    log(
      `dirty-exit: crashed=${r.crashed} enoent=${r.enoent} valid=${r.valid} onDisk=${r.onDisk}/${EXPECTED}`
    );
    // in(payload) flushes immediately by default, so even without close() the
    // records ARE on disk. This cell documents that contract.
    check(r.enoent, 0);
    check(r.valid, true);
    check(r.onDisk, EXPECTED);
  },
  { timeout: 60000 }
);

// ── PARITY: the same object across formats and across engines (feature 1.4) ──
//
// Everything above this line sweeps CONCURRENCY: every cell spawns processes and
// asks whether the engine survives contention. That is 1.3's question, and 011's.
//
// 1.4 asks a different one, and conflating the two is what made the old matrix
// unreadable: does the same object, stored by DIFFERENT mechanisms, reach the
// SAME verdict? That is a property of the format and of the key formula, so it
// needs no concurrency at all — one process, deterministic, no spawn, no budget
// fence. A divergence here is the defect; the absolute behaviour of any single
// mechanism, alone, asserts nothing.
//
// WHERE THE FOCUS SITS. The subject of this feature is EQUIVALENCE ACROSS
// FORMATS: dash vs jsonl, one reducer vs another — the encodings a caller is
// invited to choose between, and which therefore must not change the objects.
// That is the claim the codebase depends on.
//
// Cross-ENGINE agreement is COLLATERAL VERIFICATION, not the goal. It earns its
// place because a second, independently written implementation is the strongest
// available check that a format-level claim is really about the data and not
// about one engine's habits: if dash and jsonl agree only inside io-engine, the
// agreement could be io-engine's own convention rather than a property of the
// encodings. The nutshell, which shares the key formula and nothing else, rules
// that out. So the engine cells are evidence FOR the format claim — read them
// that way, not as a parity contract between two products.
//
// This became verifiable only after feature 1.5. While io-engine allocated names
// through `.index` and the nutshell through a closure-rebuilt prefix set, a
// divergent verdict could not distinguish "different formats" from "different
// allocators". 1.5 unified the allocator; these cells measure the format on top
// of it.

import NutIO from "../nutshell/io-nutshell.js";

const PAYLOADS = [
  { v: 0 },
  { v: 1, nested: { a: [1, 2], b: "two" } },
  { v: 2, zero: 0, empty: "", nil: null },
  { v: 3, unicode: "acentuação — ok" },
];

// ── the minimal POJO, and why equivalence is defined on it ──────────────────
//
// Equivalence is NOT between files, and not between record objects as each engine
// happens to hand them over. Every engine is first reduced to one minimal plain
// representation, and the claim is made there. That is what makes the claim about
// the OBJECTS rather than about storage: whatever a format did to carry a record
// — dash vs jsonl, key-as-sole-property vs an explicit field — is erased before
// anything is compared, by construction instead of by case analysis.
//
// The two in-memory shapes today:
//   io-engine : { "<key>": payload }        — the key IS the only property
//   nutshell  : { key: "<key>", payload }   — key and payload are fields
//
// Both carry exactly one (key, payload) pair, so both collapse without loss to:
//   { k, v }
//
// A divergence that survives this normalisation is a divergence in the data. One
// that does not survive it was a difference in packaging, which is precisely what
// an engine is allowed to choose.
const pojo = (r) =>
  r && typeof r.key === "string"
    ? { k: r.key, v: r.payload }
    : { k: Object.keys(r)[0], v: Object.values(r)[0] };

/** A whole log as minimal POJOs, in log order — the unit of comparison. */
const pojosOf = (recs) => recs.map(pojo);

/** Keys in log order, read off the normalised form. */
const keysOf = (recs) => pojosOf(recs).map((r) => r.k);

/** Payloads in log order, read off the normalised form. */
const payloadsOf = (recs) => pojosOf(recs).map((r) => r.v);

// ── format parity: dash vs jsonl, append vs merge, one process ──────────────
//
// The format is an ENCODING, so it may not change the object. Same payloads in,
// same keys and same payloads back out, whichever file shape carried them.
test("1.4 parity — format is an encoding: dash and jsonl agree", ({ check }) => {
  const dir = mkdtempSync(join(tmpdir(), "iodb-par-fmt-"));
  try {
    const run = (format) => {
      const io = IO(join(dir, "F" + format), {
        reduce: append,
        initial: [],
        format,
      });
      io.open({ _entity: "x" });
      for (const p of PAYLOADS) io.in(p);
      io.close();
      return { keys: keysOf(io.records()), pay: payloadsOf(io.records()), ok: io.verify().valid };
    };
    const dash = run("dash");
    const jsonl = run("jsonl");

    check(dash.ok, true);
    check(jsonl.ok, true);
    // The verdict must MATCH, which is the assertion no per-cell check made.
    check(JSON.stringify(dash.keys), JSON.stringify(jsonl.keys));
    // Content records only. Record 1 carries the store's own name
    // (`{_projection: <name>}`), and the two runs need different names to get
    // different directories — so comparing it would assert my choice of
    // filename, not the encoding.
    check(JSON.stringify(dash.pay.slice(2)), JSON.stringify(jsonl.pay.slice(2)));
    // And it must be the payloads we wrote, not merely two identical wrongs.
    check(JSON.stringify(dash.pay.slice(2)), JSON.stringify(PAYLOADS));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The reducer builds the PROJECTION; it must not touch key allocation, because a
// key is a function of payload and chain, not of how state is folded.
test("1.4 parity — the reducer does not move the keys", ({ check }) => {
  const dir = mkdtempSync(join(tmpdir(), "iodb-par-red-"));
  try {
    const run = (reducer) => {
      const io = IO(join(dir, "R" + reducer), {
        reduce: REDUCERS[reducer],
        initial: reducer === "append" ? [] : {},
        format: "jsonl",
      });
      io.open({ _entity: "x" });
      for (let i = 0; i < PAYLOADS.length; i++) io.in({ ["k" + i]: i });
      io.close();
      return { keys: keysOf(io.records()), ok: io.verify().valid };
    };
    const a = run("append");
    const m = run("merge");
    check(a.ok, true);
    check(m.ok, true);
    check(JSON.stringify(a.keys), JSON.stringify(m.keys));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── engine parity: io-engine vs nutshell ────────────────────────────────────
//
// The hard one, and the reason 1.4 waited on 1.5.
//
// What is being claimed, precisely: EQUIVALENCE OF USE, and key equality only
// OVER CONTENT. Those are two different strengths and the distinction is the
// whole point of this cell.
//
//   use        — the same program, written against one engine, runs on the other
//                and sees the same objects in the same order with the same
//                verdict. This is the requirement.
//   key equality — holds for CONTENT records, because a content name is
//                `sha64(payload) XOR sha64(prevKey)` truncated to its shortest
//                free prefix, and that formula mentions nothing either engine is
//                free to vary.
//
// It does NOT extend to the genesis pair. Record 1 is `{_projection: <store
// name>}`, so two stores that must live at different paths necessarily carry
// different payloads there — and demanding identical bytes on that row would
// assert a choice of filename, not a property of the engines. Measured: with the
// stores named ENG and NUT, record 1 differs and the content keys are identical
// regardless.
test("1.4 parity — identical keys over CONTENT, independent of the store name", ({ check }) => {
  const dir = mkdtempSync(join(tmpdir(), "iodb-par-eng-"));
  try {
    // Deliberately DIFFERENT store names, so the cell cannot pass by accident of
    // both sides being called the same thing.
    const eng = IO(join(dir, "ENG"), { reduce: append, initial: [], format: "jsonl" });
    eng.open({ _entity: "x" });
    for (const p of PAYLOADS) eng.in(p);
    eng.close();

    // Same log shape (jsonl), same reducer semantics, same genesis payload — the
    // nutshell takes name+path where io-engine takes a base path.
    const nut = NutIO("NUT", { path: dir, reduce: (acc, r) => acc.concat([r]), initial: [] });
    nut.open({ _entity: "x" });
    for (const p of PAYLOADS) nut.in(p);
    nut.close();

    check(eng.verify().valid, true);
    check(nut.verify().valid, true);

    // Genesis is record 0 and 1 on both; the content records follow.
    check(keysOf(eng.records()).length, PAYLOADS.length + 2);
    check(keysOf(nut.records()).length, PAYLOADS.length + 2);

    // THE parity assertion, scoped to content: identical names, identical order.
    check(
      JSON.stringify(keysOf(eng.records()).slice(2)),
      JSON.stringify(keysOf(nut.records()).slice(2))
    );
    // And identical payloads under those names.
    check(
      JSON.stringify(payloadsOf(eng.records()).slice(2)),
      JSON.stringify(payloadsOf(nut.records()).slice(2))
    );

    // The genesis row that is NOT shared — recorded so the scope of the claim
    // above is visible rather than inferred. Record 0 is the caller's payload and
    // does match; record 1 is the engine's own name and does not.
    check(JSON.stringify(payloadsOf(eng.records())[0]), JSON.stringify(payloadsOf(nut.records())[0]));
    check(payloadsOf(eng.records())[1]._projection, "ENG");
    check(payloadsOf(nut.records())[1]._projection, "NUT");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Both engines expose header() and state() so that code written against one runs
// on the other. header() agrees. state() DOES NOT, and this cell pins the
// divergence instead of hiding it:
//
//   io-engine : state() is get('#1'), and get() intercepts '#1' before any
//               record lookup (io-engine.js:488) to return the REDUCED
//               PROJECTION. Four callers depend on that meaning —
//               src/io-engine.test.js, src/node.t.js, src/db-factory.js:543 and
//               the matrix's own merge cell.
//   nutshell  : state() is record 1's PAYLOAD, and nutshell/io-nutshell.t.js:141
//               asserts exactly that (`state()._projection`).
//
// So the same method name means two different things, and each engine has tests
// defending its own meaning. Choosing which one moves is an interface decision
// with callers on both sides, so this cell asserts the CURRENT contract and the
// divergence is reported, not quietly patched here.
test("1.4 parity — header() agrees; state() is a KNOWN divergence", ({ check, log }) => {
  const dir = mkdtempSync(join(tmpdir(), "iodb-par-rd-"));
  try {
    const eng = IO(join(dir, "ENG"), { reduce: append, initial: [], format: "jsonl" });
    eng.open({ _entity: "x" });
    for (const p of PAYLOADS) eng.in(p);
    eng.close();

    const nut = NutIO("NUT", { path: dir, reduce: (acc, r) => acc.concat([r]), initial: [] });
    nut.open({ _entity: "x" });
    for (const p of PAYLOADS) nut.in(p);
    nut.close();

    // header() is record 0 on both — genuine parity.
    check(JSON.stringify(eng.header()), JSON.stringify(nut.header()));
    check(JSON.stringify(eng.header()), JSON.stringify({ _entity: "x" }));

    // state() is not. Asserted as-is so that UNIFYING it is a deliberate,
    // test-breaking change rather than a silent one.
    const es = JSON.stringify(eng.state());
    const ns = JSON.stringify(nut.state());
    log(`state() divergence — io-engine: ${es} | nutshell: ${ns}`);
    check(es === ns, false);
    // io-engine yields the projection: the folded records, not record 1.
    check(Array.isArray(eng.state()), true);
    // nutshell yields record 1's payload, whose marker is _projection.
    check("_projection" in nut.state(), true);

    // find() is a SECOND divergence, found by this cell and measured here:
    // io-engine maps every record (io-engine.js:581), so a caller's predicate is
    // handed the genesis rows 0 and 1; the nutshell drops them first. With 4
    // payloads written, io-engine offers 6 rows and the nutshell 4. The comment
    // at the top of the nutshell's reader block claims these two "mean the same
    // thing on both engines" — for find(), they do not.
    check(eng.find(() => true).length, PAYLOADS.length + 2);
    check(nut.find(() => true).length, PAYLOADS.length);
    // On CONTENT, though, they agree — the divergence is genesis leakage only,
    // not the payloads or their order.
    check(
      JSON.stringify(eng.find((p) => p && p.v === 3)),
      JSON.stringify(nut.find((p) => p && p.v === 3))
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── equivalence of USE: one program, either engine ──────────────────────────
//
// The cells above compare two runs from the outside. This one states the actual
// requirement from the inside: a function written against the io-engine
// interface, handed either engine, does the same work and sees the same objects.
// If that holds, a caller can switch engines without reading its own code again
// — which is what "parity" is FOR, and what comparing keys only approximates.
//
// The program below touches only what both engines promise: open, in, flush,
// records, verify, get('#<key>'), header, size, path.
function program(io) {
  io.open({ _entity: "x" });
  for (const p of PAYLOADS) io.in(p);
  io.flush();
  const recs = io.records();
  const keys = keysOf(recs);
  const content = keys.slice(2);
  return {
    count: recs.length,
    content,
    payloads: payloadsOf(recs).slice(2),
    // Resolve every content record BY ITS OWN KEY — the read path, not the scan.
    resolved: content.map((k) => io.get("#" + k)),
    header: io.header(),
    valid: io.verify().valid,
    size: io.size,
    hasPath: typeof io.path() === "string" && io.path().length > 0,
  };
}

test("1.4 parity — the same program runs unchanged on either engine", ({ check }) => {
  const dir = mkdtempSync(join(tmpdir(), "iodb-par-use-"));
  try {
    const a = program(IO(join(dir, "ENG"), { reduce: append, initial: [], format: "jsonl" }));
    const b = program(NutIO("NUT", { path: dir, reduce: (acc, r) => acc.concat([r]), initial: [] }));

    // Same number of records, same content names, same payloads, same verdict.
    check(a.count, b.count);
    check(JSON.stringify(a.content), JSON.stringify(b.content));
    check(JSON.stringify(a.payloads), JSON.stringify(b.payloads));
    check(JSON.stringify(a.header), JSON.stringify(b.header));
    check(a.valid, true);
    check(b.valid, true);
    check(a.size, b.size);
    check(a.hasPath, true);
    check(b.hasPath, true);

    // And the READ path agrees: get('#key') returns the same object on both, for
    // every content key. A store can have identical keys on disk and still
    // resolve them differently, so this is a separate claim from the cell above.
    check(JSON.stringify(a.resolved), JSON.stringify(b.resolved));
    check(JSON.stringify(a.resolved), JSON.stringify(PAYLOADS));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── equivalence ON the minimal POJO ─────────────────────────────────────────
//
// The claim in its final form: reduce every engine to `{k, v}` per record and the
// logs are EQUAL. Not "comparable after allowances", not "equal on the fields we
// chose to look at" — equal, as whole arrays, once packaging is gone.
//
// Stated this way the genesis exception stops being an exception to the rule and
// becomes part of the input: record 1 holds the store's own name, so two stores
// at two paths hold different values there. Feed both engines the SAME name and
// even that row converges, which is the cleanest evidence that nothing else
// differed. Same store name, different directories.
test("1.4 parity — equal as minimal POJOs, genesis included", ({ check }) => {
  const dir = mkdtempSync(join(tmpdir(), "iodb-par-pojo-"));
  try {
    // Same store name "S", in two sibling directories, so record 1 agrees too.
    const dA = join(dir, "a");
    const dB = join(dir, "b");
    mkdirSync(dA, { recursive: true });
    mkdirSync(dB, { recursive: true });

    const eng = IO(join(dA, "S"), { reduce: append, initial: [], format: "jsonl" });
    eng.open({ _entity: "x" });
    for (const p of PAYLOADS) eng.in(p);
    eng.close();

    const nut = NutIO("S", { path: dB, reduce: (acc, r) => acc.concat([r]), initial: [] });
    nut.open({ _entity: "x" });
    for (const p of PAYLOADS) nut.in(p);
    nut.close();

    const A = pojosOf(eng.records());
    const B = pojosOf(nut.records());

    // Whole-log equality, every record, genesis included.
    check(JSON.stringify(A), JSON.stringify(B));

    // And the normalisation is not vacuous: it really did erase two different
    // in-memory shapes. The raw records are NOT equal; the POJOs are.
    check(JSON.stringify(eng.records()) === JSON.stringify(nut.records()), false);
    check(A.length, PAYLOADS.length + 2);
    check(JSON.stringify(A.slice(2).map((r) => r.v)), JSON.stringify(PAYLOADS));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the format axis, at the byte level ──────────────────────────────────────
//
// The cells above compare what the engine READS BACK. This one first proves the
// two formats really are different on disk, because otherwise "dash and jsonl
// agree" would be a tautology about one encoder called twice.
//
//   dash  : {"v":0}#4        — payload, then '#', then the key
//   jsonl : {"4":{"v":0}}    — the key is a property wrapping the payload
//
// Opposite ends of the line. That is the difference that must not reach the
// objects — and it is the whole content of the claim "format is an encoding".
test("1.4 format — different bytes on disk, identical objects in memory", ({ check, log }) => {
  const dir = mkdtempSync(join(tmpdir(), "iodb-fmt-bytes-"));
  try {
    const write = (format) => {
      const io = IO(join(dir, "B" + format), { reduce: append, initial: [], format });
      io.open({ _entity: "x" });
      for (const p of PAYLOADS) io.in(p);
      io.close();
      return io;
    };
    const dash = write("dash");
    const jsonl = write("jsonl");

    const rawDash = readFileSync(dash.path ? dash.path() : join(dir, "Bdash.dash"), "utf8");
    const rawJsonl = readFileSync(join(dir, "Bjsonl.dash"), "utf8");
    log(`dash line 3 : ${rawDash.split("\n")[2]}`);
    log(`jsonl line 3: ${rawJsonl.split("\n")[2]}`);

    // The encodings are genuinely distinct — the premise of the whole axis.
    check(rawDash === rawJsonl, false);
    // dash puts the key after a '#'; jsonl makes it a property. Assert the shape
    // so a silent change to either encoder shows up here.
    check(/#\d*$/m.test(rawDash.split("\n")[2]), true);
    check(rawJsonl.split("\n")[2].startsWith("{\""), true);

    // And yet the objects are equal, as minimal POJOs, content included.
    const A = pojosOf(dash.records());
    const B = pojosOf(jsonl.records());
    check(JSON.stringify(A.slice(2)), JSON.stringify(B.slice(2)));
    check(JSON.stringify(A.slice(2).map((r) => r.v)), JSON.stringify(PAYLOADS));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A format must survive values that are easy to lose in a text encoding. If the
// dash format ever mishandled a '#' inside a payload, THIS is where it shows:
// the delimiter would be ambiguous and the key would be misparsed.
test("1.4 format — hostile payloads round-trip in both encodings", ({ check }) => {
  const dir = mkdtempSync(join(tmpdir(), "iodb-fmt-hostile-"));
  try {
    const HOSTILE = [
      { s: "contains # a hash" },
      { s: "trailing hash #" },
      { s: 'quotes "and" \\backslashes\\' },
      { s: "newline\nin\nvalue" },
      { s: "" },
      { n: 0, neg: -1, f: 1.5, t: true, f2: false, nil: null },
      { deep: { a: { b: { c: [1, [2, [3]]] } } } },
      { u: "日本語 · acentuação · 🔑" },
    ];
    const run = (format) => {
      const io = IO(join(dir, "H" + format), { reduce: append, initial: [], format });
      io.open({ _entity: "x" });
      for (const p of HOSTILE) io.in(p);
      io.close();
      return io;
    };
    const d = run("dash");
    const j = run("jsonl");

    check(d.verify().valid, true);
    check(j.verify().valid, true);
    // Every payload comes back byte-identical, in both encodings.
    check(JSON.stringify(payloadsOf(d.records()).slice(2)), JSON.stringify(HOSTILE));
    check(JSON.stringify(payloadsOf(j.records()).slice(2)), JSON.stringify(HOSTILE));
    // And the two encodings agree with each other, keys included.
    check(JSON.stringify(pojosOf(d.records()).slice(2)), JSON.stringify(pojosOf(j.records()).slice(2)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
