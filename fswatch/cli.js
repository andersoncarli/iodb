#!/usr/bin/env bun
// fswatch CLI — a thin argv layer over the library. FSWatch/TypedScanner/MetadataStore
// stay pure and untouched; this only wires them to stdout and process.argv.
import { resolve, join } from 'node:path'
import { FSWatch, TypedScanner, MetadataStore } from './fswatch.js'
import { LazyTree } from './typed/lazytree.js'
import { TypedTree } from './typed/typedtree.js'

const human = n => {
  const units = ['B', 'K', 'M', 'G', 'T']
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)}${units[i]}`
}

const usage = () => {
  console.error('usage: fswatch <verbo> [args]')
  console.error('  scan <dir> [--totals]         topologia + metadata, sem observar')
  console.error('  watch <config.yaml|dir>       observa 24x7, imprime eventos')
  console.error('  find <termo> [dir]            busca por nome/path na arvore')
  console.error('  totals <dir|.fswatch/domain>  totais por diretorio (files/dirs/bytes)')
  process.exit(2)
}

const cmdScan = async (dir, { totals } = {}) => {
  if (!dir) usage()
  const tree = LazyTree(resolve(dir))
  if (!totals) {
    let count = 0
    const walk = async node => { count++; if (node.type == 'd') for (const c of await node.children()) await walk(c) }
    await walk(tree.root)
    console.log(JSON.stringify({ root: tree.rootPath, nodes: count }, null, 2))
    return
  }
  const t = await tree.root.totals()
  console.log(`${tree.rootPath}  ${t.files} files, ${t.dirs} dirs, ${human(t.bytes)}`)
  for (const child of await tree.root.children()) {
    if (child.type != 'd') continue
    const ct = await child.totals()
    console.log(`  ${child.name}/  ${ct.files} files, ${ct.dirs} dirs, ${human(ct.bytes)}`)
  }
}

const cmdFind = async (term, dir = '.') => {
  if (!term) usage()
  const tree = LazyTree(resolve(dir))
  const hits = []
  const walk = async node => {
    if (node.path.includes(term) || node.name.includes(term)) hits.push(node.path)
    if (node.type == 'd') for (const c of await node.children()) await walk(c)
  }
  await walk(tree.root)
  for (const h of hits) console.log(h)
  console.error(`${hits.length} match(es)`)
}

const cmdWatch = async target => {
  if (!target) usage()
  const fs = await FSWatch(target.endsWith('.yaml') ? target : { DEFAULT: { targets: [target] } })
  fs.on(e => console.log(JSON.stringify(e)))
  await fs.watch()
  console.error(`watching ${target} — ${fs.stats().watchers} dir(s), db at ${fs.stats().database}`)
  process.on('SIGINT', () => { fs.close(); process.exit(0) })
}

const cmdTotals = async target => {
  if (!target) usage()
  const abs = resolve(target)
  const isDomain = abs.includes('.fswatch')
  if (isDomain) {
    const store = MetadataStore(abs)
    const tree = TypedTree(store.all())
    const t = tree.totals()
    console.log(`${abs}  ${t.files} files, ${t.dirs} dirs, ${human(t.bytes)}`)
    for (const child of tree.children(tree.root())) {
      if (child.kind != 'dir') continue
      const ct = tree.totals(child.id)
      console.log(`  ${child.name}/  ${ct.files} files, ${ct.dirs} dirs, ${human(ct.bytes)}`)
    }
    store.close()
    return
  }
  await cmdScan(target, { totals: true })
}

// Guarded: importing this module (e.g. a test file's utest companion-import) must
// never dispatch a command — only running it directly as `bun cli.js ...` does.
if (import.meta.main) {
  const [, , verb, ...rest] = process.argv
  const flags = new Set(rest.filter(a => a.startsWith('--')))
  const args = rest.filter(a => !a.startsWith('--'))

  if (verb == 'scan') await cmdScan(args[0], { totals: flags.has('--totals') })
  else if (verb == 'watch') await cmdWatch(args[0])
  else if (verb == 'find') await cmdFind(args[0], args[1])
  else if (verb == 'totals') await cmdTotals(args[0])
  else usage()
}
