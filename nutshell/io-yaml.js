/* YAML adapter for the io system:
 *   import IO, { yaml } from './io-nutshell.js'
 *   const cfg = IO('CONFIG', { path: './data', projection: yaml })
 *   cfg.get()   // → parsed YAML content
*/

function yamlParseValue(s) {
  if (s === '' || s === undefined) return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  if (/^-?\d+$/.test(s)) return parseInt(s)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  if ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'")) return s.slice(1, -1)
  return s
}

function yamlParse(str) {
  const root = {}, stack = [{ obj: root, indent: -2, key: null }]
  for (const raw of str.split('\n')) {
    if (!raw.trim() || raw.trim()[0] === '#') continue
    const indent = raw.search(/\S/)
    const line = raw.trim()

    while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop()
    const parent = stack.at(-1)

    // Array item
    if (line.startsWith('- ')) {
      const val = yamlParseValue(line.slice(2).trim())
      if (parent.key != null) {
        if (!Array.isArray(parent.obj[parent.key])) parent.obj[parent.key] = []
        parent.obj[parent.key].push(val)
      }
      continue
    }

    const ci = line.indexOf(':')
    if (ci === -1) continue
    const key = line.slice(0, ci).trim()
    const rawVal = line.slice(ci + 1).trim()

    if (!rawVal) {
      // Nested map
      parent.obj[key] = {}
      stack.push({ obj: parent.obj[key], indent, key: null })
    } else {
      parent.obj[key] = yamlParseValue(rawVal)
      // Track last key for potential array children
      stack.at(-1).key = key
    }
  }
  return root
}

function yamlStringify(obj, indent = 0) {
  const pad = '  '.repeat(indent)
  let out = ''
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out += `${pad}${k}:\n${yamlStringify(v, indent + 1)}`
    } else if (Array.isArray(v)) {
      out += `${pad}${k}:\n`
      for (const item of v) {
        out += typeof item === 'object' && item !== null
          ? `${pad}  - ${JSON.stringify(item)}\n`
          : `${pad}  - ${item}\n`
      }
    } else {
      const val = v === null ? 'null'
        : typeof v === 'string' && /[:#{}[\],&*?|>!%@`]/.test(v) ? `"${v}"` : v
      out += `${pad}${k}: ${val}\n`
    }
  }
  return out
}

/** YAML adapter — plug into IO projection or log */
const yaml = {
  ext: '.yaml',
  to: (v) => yamlStringify(v),
  from: yamlParse,
}
export default yaml
