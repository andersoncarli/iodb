/**
 * src/adapters/index.js — Central adapter registry (explicit load order)
 *
 * Replaces the old numeric-prefix convention (0-folder.js, 01-file.js, ...)
 * that db-factory.js used to discover and order adapters via readdirSync().
 * The filenames no longer carry an order; this file is the order.
 *
 * Order preserved from the original prefixes:
 *   0-folder, 01-file, 01-file.lines, 01-lines, 02-blob, 02-file.blob,
 *   10-dash, 15-jsonl, 20-yaml, 30-json, 40-env, 50-sqlite, 60-node/transition
 *
 * Each entry mirrors what db-factory.js used to compute from the filename:
 *   handle    — the BACKENDS/EXT_MAP key (was the de-prefixed filename stem)
 *   module    — the imported adapter module (factory resolution replicates
 *               db-factory's old lookup: `${Cap}Collection` ?? `${Cap}Factory`
 *               ?? module[handle] ?? module.default)
 */

import * as folder from './folder.js'
import * as file from './file.js'
import * as fileLines from './file.lines.js'
import * as lines from './lines.js'
import * as blob from './blob.js'
import * as fileBlob from './file.blob.js'
import * as dash from './dash.js'
import * as jsonl from './jsonl.js'
import * as yaml from './yaml.js'
import * as json from './json.js'
import * as env from './env.js'
import * as sqlite from './sqlite.js'
import { NodeAdapter } from './node-adapter.js'
import { TransitionBus } from './transition.js'

export const ADAPTERS = [
  { handle: 'folder', module: folder },
  { handle: 'file', module: file },
  { handle: 'file.lines', module: fileLines },
  { handle: 'lines', module: lines },
  { handle: 'blob', module: blob },
  { handle: 'file.blob', module: fileBlob },
  { handle: 'dash', module: dash },
  { handle: 'jsonl', module: jsonl },
  { handle: 'yaml', module: yaml },
  { handle: 'json', module: json },
  { handle: 'env', module: env },
]

// sqlite and node/transition are consumed directly (not through the
// generic handle/module list) — same as db-factory.js did before.
export { sqlite, NodeAdapter, TransitionBus }

export default ADAPTERS
