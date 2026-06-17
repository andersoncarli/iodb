import { existsSync } from "fs"
import { join } from "path"
import { memory, Memory } from "../memory.js"

describe("lib/adapters/memory.t.js - adapter-facing smoke", () => {
  test("state memory uses canonical DB/STATE yaml + dash paths", async ({ check, withTempDir }) => {
    await withTempDir(async dir => {
      const m = memory({ cwd: dir, branch: "t", turn: 1 })
      m.write({ foo: "bar" })

      check(m.read("foo"), "bar")
      check(existsSync(join(dir, "DB", "STATE", "state.yaml")))
      check(existsSync(join(dir, "DB", "STATE", "state.dash")))
    })
  })

  test("custom namespaces stay in their own DB collection", async ({ check, withTempDir }) => {
    await withTempDir(async dir => {
      const m = new Memory({ cwd: dir, branch: "t", turn: 1 }, "HITTASK")
      m.write({ event: "ok" })

      check(m.read("event"), "ok")
      check(existsSync(join(dir, "DB", "HITTASK", "hittask.yaml")))
      check(!existsSync(join(dir, "DB", "STATE", "state.yaml")))
    })
  })
})
