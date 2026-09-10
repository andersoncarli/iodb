/**
 * lib/adapters/find-root.js — Project root resolution (no dependency on db.js/config.js)
 */

import { existsSync } from 'fs'
import { join, resolve } from 'path'

export function findProjectRoot(cwd = process.cwd()) {
  let dir = cwd
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'MODELS.yaml')) || existsSync(join(dir, '.bot')) || existsSync(join(dir, '.git')) || existsSync(join(dir, 'package.json'))) {
      return dir
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return cwd
}
