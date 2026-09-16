// Quebra um export de chat (ChatGPT-style, ## Prompt: / ## Response:) em
// fragmentos deterministicos por assunto, via TF-IDF sobre o texto do turno
// + headings markdown como pista extra de fronteira.

const TURN_SPLIT_RE = /^## (Prompt|Response):\s*$/m

export function parseTurns(text) {
  const lines = text.split('\n')
  const marks = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## (Prompt|Response):\s*$/)
    if (m) marks.push({ line: i, kind: m[1] })
  }

  const turns = []
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].kind !== 'Prompt') continue
    const promptStart = marks[i].line
    const responseMark = marks[i + 1]
    if (!responseMark || responseMark.kind !== 'Response') continue
    const responseStart = responseMark.line
    const nextStart = marks[i + 2] ? marks[i + 2].line : lines.length

    const promptTimestamp = (lines[promptStart + 1] || '').trim()
    const promptText = lines.slice(promptStart + 2, responseStart).join('\n').trim()
    const responseTimestamp = (lines[responseStart + 1] || '').trim()
    const responseText = lines.slice(responseStart + 2, nextStart).join('\n').trim()

    turns.push({
      index: turns.length,
      promptTimestamp,
      promptText,
      responseTimestamp,
      responseText,
      headings: extractHeadings(responseText),
      raw: lines.slice(promptStart, nextStart).join('\n').trim(),
    })
  }
  return turns
}

function extractHeadings(responseText) {
  const out = []
  for (const line of responseText.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.*\S)\s*$/)
    if (m) out.push({ level: m[1].length, text: m[2] })
  }
  return out
}

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9à-öø-ÿç]+/gi) || []).filter(t => t.length > 2)
}

export function buildIDF(turns) {
  const N = turns.length
  const df = new Map()
  for (const turn of turns) {
    const seen = new Set(tokenize(turn.promptText + ' ' + turn.responseText))
    for (const term of seen) df.set(term, (df.get(term) || 0) + 1)
  }
  const idf = new Map()
  for (const [term, freq] of df) idf.set(term, Math.log((N + 1) / (freq + 1)) + 1)
  return idf
}

export function tfidfVector(turn, idf) {
  const tokens = tokenize(turn.promptText + ' ' + turn.responseText)
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
  const vec = new Map()
  for (const [term, count] of tf) {
    const weight = idf.get(term)
    if (weight) vec.set(term, (count / tokens.length) * weight)
  }
  return vec
}

export function cosineSim(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0
  for (const [term, w] of vecA) {
    normA += w * w
    const wb = vecB.get(term)
    if (wb) dot += w * wb
  }
  for (const w of vecB.values()) normB += w * w
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

const HEADING_DISCOUNT = 0.15

export function chooseCuts(turns, idf, targetTurnsPerGroup = 6) {
  const N = turns.length
  if (N <= 1) return []

  const vectors = turns.map(t => tfidfVector(t, idf))
  const sims = []
  for (let i = 0; i < N - 1; i++) {
    let sim = cosineSim(vectors[i], vectors[i + 1])
    const priorHeadings = new Set(turns[i].headings.map(h => h.text))
    const introducesNewHeading = turns[i + 1].headings.some(h => !priorHeadings.has(h.text))
    if (introducesNewHeading) sim = Math.max(0, sim - HEADING_DISCOUNT)
    sims.push(sim)
  }

  const K = Math.max(1, Math.min(sims.length, Math.round(N / targetTurnsPerGroup)))
  const ranked = sims
    .map((sim, i) => ({ sim, i }))
    .sort((a, b) => a.sim - b.sim || a.i - b.i)
    .slice(0, K)
    .map(x => x.i)

  return ranked.sort((a, b) => a - b)
}

export function groupTurns(turns, cuts) {
  const groups = []
  let start = 0
  for (const cut of cuts) {
    groups.push(turns.slice(start, cut + 1))
    start = cut + 1
  }
  groups.push(turns.slice(start))
  return groups.filter(g => g.length > 0)
}

export function slugify(text, maxLen = 40) {
  const slug = text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, maxLen).replace(/-+$/, '')
}

export function slugifyGroup(group, idf) {
  for (const turn of group) {
    if (turn.headings.length > 0) {
      const top = turn.headings.reduce((a, b) => (a.level <= b.level ? a : b))
      return slugify(top.text)
    }
  }
  const agg = new Map()
  for (const turn of group) {
    for (const [term, w] of tfidfVector(turn, idf)) agg.set(term, (agg.get(term) || 0) + w)
  }
  const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t)
  return slugify(top.join('-')) || 'assunto'
}

export function splitFile(text, { targetTurnsPerGroup = 6 } = {}) {
  const turns = parseTurns(text)
  if (turns.length === 0) return []

  const idf = buildIDF(turns)
  const cuts = chooseCuts(turns, idf, targetTurnsPerGroup)
  const groups = groupTurns(turns, cuts)

  const headerMatch = text.match(/^([\s\S]*?)\n## Prompt:/)
  const header = headerMatch ? headerMatch[1].trim() : ''

  return groups.map((group, i) => {
    const first = group[0].index
    const last = group[group.length - 1].index
    const rangeNote = group.length > 1
      ? `> Turnos ${first + 1}-${last + 1} de ${turns.length}`
      : `> Turno ${first + 1} de ${turns.length}`
    const body = group.map(t => t.raw).join('\n\n')
    const content = `${header}\n\n${rangeNote}\n\n${body}\n`
    return {
      index: i,
      slug: slugifyGroup(group, idf),
      turnRange: [first, last],
      content,
    }
  })
}

export function fragmentFilename(index, slug) {
  return `${String(index + 1).padStart(2, '0')}-${slug}.md`
}

async function main() {
  const [, , inputPath, ...rest] = process.argv
  if (!inputPath) {
    console.error('uso: node tools/splitchat.js <arquivo.md> [--target N]')
    process.exit(1)
  }

  const targetIdx = rest.indexOf('--target')
  const targetTurnsPerGroup = targetIdx >= 0 ? Number(rest[targetIdx + 1]) : 6

  const fs = await import('node:fs/promises')
  const path = await import('node:path')

  const text = await fs.readFile(inputPath, 'utf8')
  const fragments = splitFile(text, { targetTurnsPerGroup })

  const dir = path.dirname(inputPath)
  const base = path.basename(inputPath, '.md')
  const outDir = path.join(dir, base)
  await fs.mkdir(outDir, { recursive: true })

  for (const frag of fragments) {
    const outPath = path.join(outDir, fragmentFilename(frag.index, frag.slug))
    await fs.writeFile(outPath, frag.content, 'utf8')
    console.log(outPath)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
