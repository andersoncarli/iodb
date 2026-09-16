#!/usr/bin/env bun
// topology-only Typed CSV; no stat(), hash() or file reads are performed
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { LazyTree } from './lazytree.js'
import { Typed, builtins } from './typed.js'

const root = process.argv[2], out = process.argv[3] || join('.', 'tree.csv')
if (!root || root == '-h' || root == '--help') {
  console.error('usage: ./tree.js <directory> [output.csv]')
  process.exit(root ? 0 : 2)
}

// The Type Tree is the source of truth for the header; the CSV columns below
// are named after (and ordered like) the Schema fields it resolves.
const t = Typed(); builtins(t)
t.define('i', 'integer'); t.define('u', 'unsigned integer')
t.define('ftype', { d: 'dir', f: 'file', l: 'link', s: 'socket', b: 'block', c: 'char', p: 'fifo' })
t.define('pk', 'i autoinc'); t.define('node-id', 'pk'); t.define('node-id-delta', 'node-id delta')
const schema = t.schema({ type: 'ftype', name: 's', id: 'pk', parent_dt: 'node-id-delta' })
const columns = Object.keys(schema)
const typeLine = (name, expr) => `# ${name}=${typeof expr == 'object' ? `{${Object.entries(expr).map(([k, v]) => `${k}:${v}`).join(',')}}` : expr}`

const tree = LazyTree(root), fd = await open(out, 'w'), escape = s => String(s).replaceAll('\\', '\\\\').replaceAll(',', '\\,').replaceAll('\n', '\\n').replaceAll('\r', '\\r')
let buffer = '', count = 0
const put = text => buffer += text
const flush = async () => buffer && (await fd.write(buffer), buffer = '')
put([
  '# typed-csv=1,version=0.1',
  `# root=${tree.rootPath}`,
  '# s=string,i=integer,u=unsigned integer',
  typeLine('pk', 'i autoinc'),
  typeLine('node-id', 'pk'),
  typeLine('node-id-delta', 'node-id delta'),
  typeLine('ftype', { d: 'dir', f: 'file', l: 'link', s: 'socket', b: 'block', c: 'char', p: 'fifo' }),
  `# Schema={${columns.map(c => `${c}:${schema[c].source}`).join(',')}}`,
  columns.join(','), ''
].join('\n'))
const visit = async (node, parent = 0) => {
  put(`${node.type},${escape(node.name)},${node.id},${parent ? node.id - parent : 0}\n`); count++
  if (node.type == 'd') for (const child of await node.children()) await visit(child, node.id)
  if (buffer.length > 65536) await flush()
}
await visit(tree.root); await flush(); await fd.close()
console.log(JSON.stringify({ root: tree.rootPath, out, nodes: count }, null, 2))
