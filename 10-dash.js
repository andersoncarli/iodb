/**
 * io/adapters/10-dash.js — Dashed DSL format (key{json}\n, Dashed projection)
 * Used specifically for PLANS.yaml high-density task registry.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { parse as parseYaml, stringify as stringifyYAML } from 'yaml'
import { LogCollection, deepMerge } from './collection-base.js'

const RECOGNIZERS = [
  // meta: bare `-:` or `-#hash:` or `meta:` or `meta#hash:` — no content ID between prefix and colon
  { id: 'meta', re: /^(?:\-|meta)(?:#[a-zA-Z0-9_+\-]{0,16})?:\s*/ },
  // dash: must come before root — lines starting with one or more dashes. Strip trailing hash from ID part.
  { id: 'dash', re: /^([\-]+)\s*([^#:]*?)(?:#[a-zA-Z0-9_+\-]{0,16})?:\s*(.*)/ },
  { id: 'num', re: /^([0-9\.]+)([\-\w]*)(?:#[a-zA-Z0-9_+\-]{0,16})?:\s*(.*)/ },
  { id: 'root', re: /^([\w\.\-\>]*?)(?:#[a-zA-Z0-9_+\-]{0,16})?:\s*(.*)/ },
]

const INTERNAL = new Set(['_val', '_hash', '_path', '_root', '_depth', '_isAttr', '_isImplicit', 'id', 'slug', 'notes', 'priority', 'estimate', 'status', '_hashes', '_type', '_extras', 'tasks', 'files', 'title', 'spec', 'depends', 'children'])

export function Node(id, val = '', hash = '', meta = {}, extra = {}, path = '', root = null) {
  const node = { id, _val: val, _hash: hash, _path: path, _root: root, ...meta, ...extra }
  return new Proxy(node, {
    get(t, k, p) {
      if (k === 'toString') return () => (t.id === 'root' ? stringifyDashed(p) : formatDashedNode(p))
      if (k === 'toJSON') return () => { const { _val, _hash, _path, _root, ...rest } = t; return rest }
      if (k === 'title') return t._val

      if (k === 'children') {
        const prefix = t._path ? t._path + '>' : ''
        const r = (t._root) || t, hashes = r._hashes || {}, seen = new Set()
        const keys = new Set(Object.keys(hashes)
          .filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('>') && p !== t._path)
          .map(p => p.slice(prefix.length).split('#')[0])
          .filter(p => p && !INTERNAL.has(p))) // Exclude attributes like 'files' from children

        for (const k of Object.keys(t)) {
          if (!k.startsWith('_') && !INTERNAL.has(k) && !k.includes('>')) keys.add(k)
        }

        return Array.from(keys)
          .map(k => {
            const val = t[k] || r[prefix + k]
            if (val && typeof val === 'object' && val.id !== undefined) return val
            return Node(k, val, r._hashes?.[prefix + k] || '', {}, {}, prefix + k, r)
          })
          .filter(n => n && typeof n === 'object' && n.id !== undefined)
          .sort((a, b) => (a.id || '').localeCompare(b.id || '', undefined, { numeric: true }))
      }

      if (k === 'tasks') {
        const res = {}, visit = (n) => {
          if (!n || typeof n !== 'object') return
          const nid = n.id
          if (nid && /^\d+\.\d+\.\d+/.test(nid)) res[nid] = n
          const ch = n.children; if (ch) for (const c of ch) visit(c)
        }
        visit(p); return res
      }

      const s = String(k)
      if (t[s] !== undefined) return t[s]

      // Virtual discovery: if we have a root and path, try looking up directly in root
      if (t._root && t._path) {
        const full = t._path + '>' + s
        if (t._root[full] !== undefined) return t._root[full]
      } else if (t.id === 'root' && s.includes('>')) {
        // Root access for flat paths
        return t[s]
      }
      return undefined
    },
    set(t, k, v) {
      const s = String(k)
      if (s.includes('>') && t.id === 'root') {
        const segs = s.split('>')
        let parent = t
        const root = t._root || t
        for (let j = 0; j < segs.length - 1; j++) {
          const seg = segs[j]
          const existing = parent[seg]
          if (!existing || typeof existing !== 'object') {
            // Transform existing leaf into a node to support children
            parent[seg] = Node(seg, (typeof existing === 'string' ? existing : ''), '', {}, {}, segs.slice(0, j + 1).join('>'), root)
          }
          parent = parent[seg]
        }
        const leaf = segs[segs.length - 1]
        // leaf is already a Node if created by the loop above or previously set
        if (!parent[leaf] || typeof parent[leaf] !== 'object') {
          parent[leaf] = Node(leaf, v?._val ?? v, '', {}, v && typeof v === 'object' ? v : {}, s, root)
        } else if (v && typeof v === 'object') {
          Object.assign(parent[leaf], v)
        } else {
          parent[leaf]._val = v
        }
      }
      t[s] = v // Always set on target too for ownKeys/LogCollection visibility
      return true
    },
    ownKeys(t) {
      const keys = new Set(Reflect.ownKeys(t))
      const r = t._root || t, prefix = t._path ? t._path + '>' : ''
      for (const path of Object.keys(r._hashes || {})) {
        if (path.startsWith(prefix) && path !== t._path) {
          const remainder = path.slice(prefix.length)
          if (!remainder.includes('>')) {
            const sub = remainder.split('#')[0]
            if (sub && !INTERNAL.has(sub)) keys.add(sub) // Exclude attributes from keys
          }
        }
      }
      return Array.from(keys)
    },
    has(t, k) {
      if (Reflect.has(t, k)) return true
      const childPath = (t._path ? t._path + '>' : '') + String(k)
      return t._root && !!t._root[childPath]
    },
    getOwnPropertyDescriptor(t, k) {
      const desc = Reflect.getOwnPropertyDescriptor(t, k)
      if (desc) return desc
      if (this.has(t, k)) return { enumerable: true, configurable: true, value: this.get(t, k), writable: true }
    }
  })
}

function parseNodeConstructor(line) {
  let val = '', hash = '', meta = {}, extra = {}, idPart = ''
  const mHashEnd = line.match(/\s+#([^\s:]+)\s*$/)
  if (mHashEnd) { hash = mHashEnd[1]; line = line.slice(0, mHashEnd.index).trim() }
  const mJson = line.match(/\s*(\{.*\})\s*$/)
  if (mJson) { try { extra = parseYaml(mJson[1]); line = line.slice(0, mJson.index).trim() } catch { } }
  const mMeta = line.match(/\s*\[([^\]]+)\]\s*$/)
  if (mMeta) {
    const parts = mMeta[1].split(',').map(s => s.trim())
    let anyMatch = false
    for (const p of parts) {
      if (['critical', 'high', 'medium', 'low'].includes(p)) { meta.priority = p; anyMatch = true }
      else if (['open', 'done', 'todo', 'wip', 'active', 'blocked'].includes(p)) { meta.status = p; anyMatch = true }
      else if (p.endsWith('h') || p.endsWith('d') || !isNaN(p)) { meta.estimate = parseFloat(p) || p; anyMatch = true }
    }
    if (anyMatch) line = line.slice(0, mMeta.index).trim()
  }
  if (!hash) {
    const mHashInline = line.match(/#([a-zA-Z0-9_+\-]{1,16})(?=[: \n]|$)/)
    if (mHashInline) {
      hash = mHashInline[1]; line = line.slice(0, mHashInline.index) + line.slice(mHashInline.index + 1 + mHashInline[1].length)
    }
  }
  const b = line.indexOf(':')
  if (b !== -1) { idPart = line.slice(0, b).trim(); val = line.slice(b + 1).trim() }
  else { idPart = line.trim() }

  // Type-aware value casting
  if (val.startsWith('[') && val.endsWith(']')) {
    try { const arr = parseYaml(val); if (Array.isArray(arr)) val = arr } catch { }
  } else if (val.startsWith('{') && val.endsWith('}')) {
    try { val = parseYaml(val) } catch { }
  } else if (val.startsWith('"') && val.endsWith('"')) {
    val = val.slice(1, -1)
  } else if (val !== '' && !isNaN(val)) {
    val = Number(val)
  } else if (val === 'true') {
    val = true
  } else if (val === 'false') {
    val = false
  } else if (val === 'null') {
    val = null
  }

  return { idPart, val, hash, meta, extra }
}

function parseDashed(raw) {
  const lines = raw.split('\n'), pathStack = []
  const root = Node('root', '', '', {}, { _type: 'dashed', _hashes: {}, _extras: [] })
  let currentTask = null, readingNotes = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; if (!line) continue
    const trimmed = line.trim()
    if (readingNotes && currentTask) {
      if (/^\s+/.test(line)) {
        const content = line.trimStart()
        currentTask.notes += (currentTask.notes === '|' ? '' : '\n') + content
        continue
      } else { readingNotes = false }
    }
    if (trimmed.startsWith('#')) { root._extras.push({ type: 'comment', value: line, index: i }); continue }
    const rec = RECOGNIZERS.find(r => (r.starts ? line.startsWith(r.starts) : r.re.test(line)))
    if (!rec) { root._extras.push({ type: 'line', value: line, index: i }); continue }
    const { idPart, val, hash, meta, extra } = parseNodeConstructor(line)
    const m = line.match(rec.re)
    let depth = 0, fullId = idPart
    if (rec.id === 'meta') {
      const metaVal = val ? (parseYaml(val) || val) : null
      root.meta = metaVal || (Object.keys(extra).length ? extra : undefined)
      if (hash) root._hashes['meta'] = hash
      continue
    }
    if (rec.id === 'root') { root[fullId] = Node(fullId, val, hash, meta, extra); root._hashes[fullId] = hash; continue }
    if (rec.id === 'num') {
      const segs = m[1].split('.')
      depth = segs.length
      // Only override ancestor slots that are unset or inconsistent with this numeric key.
      // This preserves slug-rich paths set by dash lines (e.g. '1-sprint' is kept when '1.1.1' is parsed).
      for (let j = 0; j < depth - 1; j++) {
        const numPrefix = segs.slice(0, j + 1).join('.')
        if (!pathStack[j] || !String(pathStack[j]).startsWith(numPrefix)) pathStack[j] = numPrefix
      }
      pathStack[depth - 1] = segs.join('.')
      if (m[2]) pathStack[depth - 1] += m[2]
      fullId = pathStack[depth - 1]
    } else if (rec.id === 'dash') {
      depth = m[1].length
      const cleanIdTemp = fullId.replace(/^[\-]+/, '').trim()
      if (currentTask && cleanIdTemp && !/^\d/.test(cleanIdTemp)) depth = 4
      if (currentTask && !cleanIdTemp) { depth = 4 }
      else { pathStack[depth - 1] = cleanIdTemp }
    }
    const path = pathStack.slice(0, depth).filter(s => s !== undefined).join('>')
    if (!path) continue
    let parsedVal = val
    const cleanId = fullId.replace(/^[\-]+/, '').trim()

    // Hardened metadata mapping: if it matches INTERNAL, it's an attribute of currentTask
    if (currentTask && INTERNAL.has(cleanId)) {
      if (cleanId === 'notes' && val === '|') readingNotes = true
      currentTask[cleanId] = parsedVal
      const attrPath = currentTask._path + '>' + cleanId
      if (hash) root._hashes[attrPath] = hash // Don't append '#' for named attributes, handle in stringify
      continue
    }

    const isAnonAttr = currentTask && !cleanId
    const n = Node(fullId, parsedVal, hash, meta, extra, path, root)

    if (isAnonAttr) {
      // Anonymous patch: merge into currentTask only; store hash separately so stringify can emit it
      Object.assign(currentTask, meta, extra)
      if (hash) {
        root._hashes[path + '#'] = hash
        if (!currentTask._anonPatches) currentTask._anonPatches = []
        currentTask._anonPatches.push({ hash, data: { ...meta, ...extra } })
      }
    } else {
      if (hash) root._hashes[path] = hash
      // Build hierarchical tree
      let parent = root
      const segs = path.split('>')
      for (let j = 0; j < segs.length - 1; j++) {
        const seg = segs[j]
        if (!parent[seg]) parent[seg] = Node(seg, '', '', {}, {}, pathStack.slice(0, j + 1).join('>'), root)
        parent = parent[seg]
      }
      const leaf = segs[segs.length - 1]
      parent[leaf] = n
      root[path] = n
    }

    if ((depth === 2 || depth === 3) && /^\d/.test(cleanId)) {
      currentTask = n; n.id = cleanId; n._depth = depth; n.slug = cleanId.split('-').slice(1).join('-') || ''
      n.files = n.files || []; n.notes = n.notes || ''; n.spec = n.spec || ''; n.depends = n.depends || []
      Object.assign(n, meta, extra)
    }
    else if (currentTask && (depth >= 4 || !cleanId)) {
      const attr = pathStack[depth - 1]
      if (attr === 'notes' && val === '|') readingNotes = true
      else if (!cleanId) { Object.assign(currentTask, meta, extra) }
      else { currentTask[attr] = n; Object.assign(currentTask, meta, extra) }
    } else {
      Object.assign(n, meta, extra)
    }
  }
  return root
}

function formatDashedNode(n, overrides = {}) {
  let id = String(overrides.id || n?.id || ''),
    val = overrides._val != null ? overrides._val : (n?._val != null ? n?._val : ''),
    hash = overrides._hash || n?._hash || '',
    d = overrides._depth || n?._depth || 1

  const hashInside = overrides._hashInside ?? true
  const extra = {}
  if (n) {
    for (const k of Object.keys(n)) {
      if (INTERNAL.has(k) || k.startsWith('_') || k.includes('>')) continue
      const v = n[k]
      if (v && typeof v === 'object' && v._root !== undefined) continue // skip child nodes
      extra[k] = v
    }
  }
  const hashStr = hash ? `#${hash}` : ''
  if (id === 'meta') {
    const rawVal = n?._val || n?.meta || n || val
    const jsonStr = (rawVal && typeof rawVal === 'object') ? JSON.stringify(rawVal) : JSON.stringify(rawVal || '')
    return `meta${hashInside ? hashStr : ''}: ${jsonStr}`
  }
  if (id === 'PROJECT') {
    const exProj = n?.version ? ` {version: ${n.version}}` : ''
    return `PROJECT: ${val || ''}${exProj}${hashInside && hashStr ? ' ' + hashStr : ''}`
  }
  const cleanId = id.replace(/^[\-]+/, '').trim()
  const isImplicit = overrides._isImplicit !== undefined ? overrides._isImplicit : n?._isImplicit !== undefined ? n?._isImplicit : /^[0-9\.]+/.test(id)
  if (id.includes('>')) overrides._isImplicit = true // Paths are always implicit
  const isAttr = overrides._isAttr !== undefined ? overrides._isAttr : n?._isAttr !== undefined ? n?._isAttr : d >= 4
  const prefix = isAttr ? '-' : (isImplicit ? '' : '-'.repeat(d))
  const displayVal = (val && typeof val === 'object' && val._val !== undefined) ? val._val : val
  const isLiteralObj = displayVal && typeof displayVal === 'object' && !Array.isArray(displayVal) && displayVal._path === undefined
  const valStr = (Array.isArray(displayVal) || isLiteralObj) ? JSON.stringify(displayVal) : (displayVal || '')
  const tags = []
  if (n?.priority && n?.priority !== 'medium') tags.push(n?.priority)
  if (n?.estimate != null) tags.push(`${n?.estimate}h`)
  if (n?.status && n?.status !== 'open') tags.push(n?.status)
  const metaStr = tags.length ? ` [${tags.join(', ')}]` : ''
  let finalVal = valStr; if (n?.notes) finalVal += (finalVal ? ' ' : '') + '|'
  if (!cleanId && !id.includes('>')) {
    const attrData = { ...extra }
    if (n?.priority && n?.priority !== 'medium') attrData.priority = n?.priority
    if (n?.estimate != null) attrData.estimate = n?.estimate
    if (n?.status && n?.status !== 'open') attrData.status = n?.status
    const anonymousStr = Object.keys(attrData).length ? ` ${JSON.stringify(attrData)}` : ''
    return `${prefix}${hashInside ? hashStr : ''}:${anonymousStr}`
  }
  const slugStr = (n?.slug && !id.includes('>')) ? `-${n?.slug}` : ''
  const displayId = slugStr ? cleanId.split('-')[0] : cleanId
  const lineStr = isImplicit ? `${displayId}${slugStr}${hashInside ? hashStr : ''}: ${finalVal}${metaStr}${Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''}` : `${prefix}${displayId}${slugStr}${hashInside ? hashStr : ''}: ${finalVal}${metaStr}${Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''}`
  if (n?.notes) {
    const indentSize = isAttr ? 2 : (isImplicit ? 3 : d + 3)
    const indent = ' '.repeat(indentSize)
    const notesStr = String(n.notes).trim()
    return lineStr + '\n' + notesStr.split('\n').map(l => indent + l).join('\n')
  }
  return lineStr
}

// Attributes that get their own sub-lines (with hash anchors if anchored)
const ATTR_LINES = ['files', 'spec', 'depends']

function stringifyDashed(root) {
  const lines = [], hashes = root._hashes || {}
  if (Object.keys(hashes).length > 0) {
    const firstKey = Object.keys(hashes)[0];
  }

  const visit = (n, d = 0) => {
    if (!n || typeof n !== 'object' || n.id === 'root') return
    const path = n._path || ''

    // Blank line before sprints (d=1) and pillars (d=2)
    if (d <= 2 && lines.length > 0) lines.push('')

    lines.push(formatDashedNode(n, { _hash: hashes[path], _depth: d }))

    // Emit named attribute sub-lines (files, spec, depends)
    for (const attr of ATTR_LINES) {
      const val = n[attr]
      if (!val || (Array.isArray(val) && val.length === 0) || val === '') continue
      lines.push(formatDashedNode(null, { id: attr, _val: val, _depth: d + 1, _isAttr: true, _hash: hashes[path + '>' + attr] }))
    }

    // Emit anonymous patches that have hash anchors
    if (n._anonPatches) {
      for (const ap of n._anonPatches) {
        lines.push(`-#${ap.hash}: ${JSON.stringify(ap.data)}`)
      }
    }

    // Recurse direct children
    const ch = n.children
    if (ch) for (const c of ch) visit(c, d + 1)
  }

  if (root.meta) {
    const h = hashes['meta'] || hashes['tasks>meta']
    lines.push(formatDashedNode(root.meta, { id: 'meta', _val: root.meta, _hash: h, _depth: 1 }))
  }
  if (root.PROJECT) {
    const proj = root.PROJECT
    const projStr = typeof proj === 'string' ? proj : undefined
    lines.push(formatDashedNode(
      projStr ? null : proj,
      { id: 'PROJECT', _val: projStr, _hash: hashes['PROJECT'] || hashes['tasks>PROJECT'], _depth: 1 }
    ))
  }

  for (const s of (root.children || [])) {
    if (s.id === 'meta' || s.id === 'PROJECT') continue
    visit(s, 1)
  }

  // Collapse consecutive blank lines and trim trailing
  return lines.filter((l, i, a) => !(l === '' && (i === 0 || a[i - 1] === ''))).join('\n').trimEnd()
}

export const dashFmt = (filePath) => {
  const base = filePath ? filePath.replace(/\.yaml$/, '') : null
  const pathStack = [] // State for relative ID resolution in log replay

  return {
    logPath: base ? base + '.dash' : null, indexPath: base ? base + '.index' : null, type: 'dash', sep: '>',
    formatLine: (key, patch) => {
      const lines = []
      const hashStr = key ? `#${key}` : ''
      for (const [path, val] of Object.entries(patch)) {
        if (path.startsWith('_')) continue
        let notation = ''
        if (val && typeof val === 'object' && val._root !== undefined) {
          // Node instance: Use formatDashedNode to preserve metadata.
          // In the log, we use the full path as ID for global addressability.
          notation = formatDashedNode(val, { id: path, _hashInside: false })
        } else {
          // Attribute line: Use dashed notation if possible, but keep path-like identity.
          const isAtTaskLevel = path.split('>').length >= 4
          const cleanKey = path.split('>').pop().replace(/^[\-]+/, '').trim()
          const prefix = isAtTaskLevel ? '-' : ''
          let valStr = (val && typeof val === 'object') ? JSON.stringify(val) : String(val ?? '')
          // Escape physical newlines to keep the log record on a single line
          valStr = valStr.replace(/\n/g, '\\n')
          notation = `${prefix}${cleanKey}: ${valStr}`
        }
        lines.push(`{${notation}} ${hashStr}`)
      }
      return lines.join('\n')
    },
    parseLine: (line) => {
      line = line.trim()
      if (line.startsWith('{')) {
        const e = line.lastIndexOf('}')
        if (e === -1) return { key: null, patch: {} }
        const inner = line.slice(1, e).trim()
        const afterBrace = line.slice(e + 1).trim()
        const hashMatch = afterBrace.match(/^#([a-zA-Z0-9_+\-]+)/)
        const key = hashMatch ? hashMatch[1] : null

        // Reuse parseNodeConstructor to handle the DASH notation inside the log record.
        // It already performs numeric casting and type-aware resolution.
        const { idPart, val: finalVal, meta, extra } = parseNodeConstructor(inner)
        const rec = RECOGNIZERS.find(r => (r.starts ? inner.startsWith(r.starts) : r.re.test(inner)))
        let depth = 0, fullId = idPart

        if (!rec) {
          // Fallback: straight path key
          return { key, patch: { [idPart]: finalVal } }
        }

        if (rec.id === 'meta' || rec.id === 'root') return { key, patch: { [idPart]: (Object.keys(extra).length ? extra : finalVal) } }

        const m = inner.match(rec.re)
        if (rec.id === 'num') {
          const segs = m[1].split('.')
          depth = segs.length
          for (let j = 0; j < depth - 1; j++) {
            const numPrefix = segs.slice(0, j + 1).join('.')
            if (!pathStack[j] || !String(pathStack[j]).startsWith(numPrefix)) pathStack[j] = numPrefix
          }
          pathStack[depth - 1] = segs.join('.')
          if (m[2]) pathStack[depth - 1] += m[2]
          fullId = pathStack[depth - 1]
        } else if (rec.id === 'dash') {
          depth = m[1].length
          const cleanIdTemp = fullId.replace(/^[\-]+/, '').trim()
          // Heuristic: if we see a dash property after a task node, it's depth 4
          const prev = pathStack[2]
          if (prev && cleanIdTemp && !/^\d/.test(cleanIdTemp)) depth = 4
          pathStack[depth - 1] = cleanIdTemp
        }

        const path = pathStack.slice(0, depth).filter(s => s !== undefined).join('>')
        // Re-inject metadata into the value if present (rehydrates as a Node-friendly object)
        const unescapedVal = typeof finalVal === 'string' ? finalVal.replace(/\\n/g, '\n') : finalVal
        const rehydratedVal = (Object.keys(meta).length || Object.keys(extra).length)
          ? { _val: unescapedVal, ...meta, ...extra }
          : unescapedVal

        return { key, patch: { [path || idPart]: rehydratedVal } }
      }
      return { key: null, patch: {} }
    },
    syncFile: (fp, cache) => writeFileSync(fp, stringifyDashed(cache)),
    loadFile: (fp) => (fp && existsSync(fp)) ? parseDashed(readFileSync(fp, 'utf8')) : parseDashed(''),

    // Called by collection.open() when a new log is created from an existing projection.
    // Assimilates every addressable node into the log, giving each a cryptographic anchor.
    seed(cache, colIn) {
      const hashes = cache._hashes || {}
      const SKIP = new Set(['_type', '_extras', '_hashes', 'meta', 'id', '_val', '_hash', '_path', '_root',
        '_entity', '_created', '_depth', '_isImplicit', '_isAttr', 'currentSprint', 'currentPillar'])

      const assimilate = (path, data) => {
        if (hashes[path]) return
        colIn({ [path]: data })
      }

      if (cache.meta) assimilate('meta', cache.meta)

      // Top-level structural nodes (sprint, pillar, PROJECT)
      for (const path of Object.keys(cache)) {
        if (SKIP.has(path) || path === 'meta' || path.startsWith('tasks>')) continue
        const clean = path.replace(/^[\-]+/, '').trim()
        if (!/^\d/.test(clean) && clean !== 'PROJECT') continue
        assimilate(path, cache[path])
      }

      // Nested nodes (separator '>')
      for (const path of Object.keys(cache).filter(k => k.includes('>'))) {
        if (path.startsWith('tasks>')) continue
        const clean = path.split('>').pop().replace(/^[\-]+/, '').trim()
        if (!/^\d/.test(clean) && clean !== 'PROJECT') continue
        assimilate(path, cache[path])

        // Attribute lines (files, spec, depends) on task-depth nodes
        if (path.split('>').length === 3) {
          const node = cache[path]
          if (node && typeof node === 'object') {
            for (const attr of ['files', 'spec', 'depends']) {
              const val = node[attr]
              if (!val || (Array.isArray(val) && val.length === 0) || val === '') continue
              assimilate(path + '>' + attr, val)
            }
          }
        }
      }
    },

    // Uses deepMerge to preserve Node proxies and hierarchical links
    merge(cache, patch) {
      // console.log(`[10-dash.js] merge patch=${JSON.stringify(patch)}`);
      deepMerge(cache, patch, '>')
    },
    extractFromBuffer: (buf, k) => {
      if (globalThis._debugBus) console.log(`[dash] extractFromBuffer key: ${k}`);
      const needle = Buffer.from(' #' + k);
      let pos = buf.indexOf(needle);
      if (pos === -1) return null;
      let start = buf.lastIndexOf(10, pos);
      if (start === -1) start = 0; else start++;
      let end = buf.indexOf(10, pos);
      if (end === -1) end = buf.length;
      const line = buf.subarray(start, end).toString().trim();
      // Temporary object to avoid recursion: use a one-off parser
      const { patch } = dashFmt().parseLine(line);
      return patch;
    }
  }
}

export const extensions = ['dash', 'flow']
export const DashCollection = (filePath, opts = {}) => LogCollection(filePath, { ...dashFmt(filePath), genesis: opts.genesis })
export default DashCollection

// ── Flow format (superset of 10-dash.js) ─────────────────────────────────────
// Uses key{json} log format for backward compatibility with plain-YAML collections.
// loadFile auto-detects Dash annotations vs plain YAML — same collection engine.

const hasDashAnnotations = (content) =>
  /^[0-9]+\.[0-9]/m.test(content) ||
  /#[a-zA-Z0-9_+\-]{2,16}[:\s]/m.test(content) ||
  /\[(?:critical|high|medium|low|open|done|wip)/m.test(content)

export const flowFmt = (filePath) => {
  const base = filePath ? filePath.replace(/\.yaml$/, '') : null
  return {
    logPath: base ? base + '.dash' : null,
    indexPath: base ? base + '.index' : null,
    type: 'dash',
    sep: '/',

    formatLine: (key, patch) => `${key}${JSON.stringify(patch)}`,

    parseLine: (line) => {
      // Dash format: {path#key: value}
      if (line.startsWith('{')) {
        const e = line.lastIndexOf('}')
        if (e > 0) {
          const inner = line.slice(1, e).trim()
          const hm = inner.match(/^([^#:]+)#([a-zA-Z0-9_+\-]+):\s*(.*)$/)
          const nm = inner.match(/^([^:]+):\s*(.*)$/)
          const m = hm || nm
          if (m) {
            const path = m[1].trim(), key = hm ? m[2] : null
            let val = (hm ? m[3] : m[2]).trim()
            try { val = JSON.parse(val) } catch { }
            return { key, patch: { [path]: val } }
          }
        }
        return { key: null, patch: {} }
      }
      // Flow format: key{json}
      const b = line.indexOf('{')
      if (b < 0) return { key: null, patch: {} }
      const key = line.slice(0, b).trim(), raw = line.slice(b).trim()
      try { return { key, patch: JSON.parseYaml(raw) } } catch {
        try { return { key, patch: parseYaml(raw) } } catch { return { key: null, patch: {} } }
      }
    },

    extractFromBuffer: (buf, k) => {
      const needle = Buffer.from(k + '{')
      let pos = buf.indexOf(needle)
      while (pos > 0 && buf[pos - 1] !== 10) {
        pos = buf.indexOf(needle, pos + 1)
        if (pos === -1) return null
      }
      if (pos === -1) return null
      let end = buf.indexOf(10, pos)
      if (end === -1) end = buf.length
      const raw = buf.subarray(pos, end).toString().slice(k.length).trim()
      try { return JSON.parseYaml(raw) } catch { return parseYaml(raw) }
    },

    syncFile: (fp, cache) => {
      if (cache?._type === 'dashed') writeFileSync(fp, stringifyDashed(cache))
      else writeFileSync(fp, stringifyYAML(cache, { collectionStyle: 'block', indent: 2 }))
    },

    loadFile: (fp) => {
      if (!fp || !existsSync(fp)) return {}
      const content = readFileSync(fp, 'utf8')
      if (hasDashAnnotations(content)) return parseDashed(content)
      return parseYaml(content) || {}
    },
  }
}

export const FlowCollection = (filePath) => LogCollection(filePath, flowFmt(filePath))
