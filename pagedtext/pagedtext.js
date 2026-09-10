import {
  openSync, closeSync, readSync, writeSync, fsyncSync, ftruncateSync,
  fstatSync, existsSync, mkdirSync, renameSync, readFileSync, writeFileSync
} from 'node:fs'
import path from 'node:path'

/**
 * PagedText — a large text file as a logical line sequence, physically stored
 * in fixed-size pages.
 *
 * v0.3 (sprint 015, feature 2.0): synchronous page core with POSITIONAL COMMIT.
 *
 *   - page 0..headerPages-1 is a VERSIONED HEADER: magic + version + pageSize +
 *     layout + kind + per-page line counts + per-page extents + keys[] +
 *     logOffset. A file whose header version we do not recognise is NOT parsed
 *     and NOT reinterpreted as legacy text — the caller rebuilds from its own
 *     source of truth. (Reinterpreting it would rewrite it destructively.)
 *   - ALIGNMENT INVARIANT: every data page occupies an exact multiple of
 *     pageSize. A line longer than a page occupies k contiguous pages, and k is
 *     recorded in extents[]. Without this, a page's byte offset is not
 *     computable and positional writing is incorrect.
 *   - only DIRTY pages are written, each with a positioned writeSync. Writing
 *     one line into a 1000-page store writes 2 pages (the dirty one and the
 *     header), not 1001.
 *   - the page cache holds only VISITED pages, not the whole file. Identity of
 *     a page is its position in the logical sequence, never its byte offset
 *     (inserting into an early page shifts every later offset).
 *   - filling ("ws" default, "comment" explicit) is physical capacity inside a
 *     page. It never appears in the logical API. The authority on where a page
 *     ends is the header's line count, not a run of spaces an editor might trim.
 *
 * The public interface is unchanged from v0: array-of-lines access, cursor,
 * atomic flush, pages().
 */

const MAGIC = 'PAGEDTEXT'
const HEADER_VERSION = 3
const DEFAULT_PAGE_SIZE = 4096
const indexKey = p => typeof p === 'string' && /^(0|[1-9]\d*)$/.test(p)

const builtinKinds = {
  clike: {
    fill: () => ' \n',
    commentFill: () => '//- pagedtext filling\n',
    isFill: line => line.trimStart().startsWith('//- pagedtext filling') || line === ' '
  },
  text: {
    fill: () => ' \n',
    commentFill: () => '#- pagedtext filling\n',
    isFill: line => line.trimStart().startsWith('#- pagedtext filling') || line === ' '
  }
}

function kindOf(kind, filling = 'ws') {
  if (!kind) kind = 'text'
  if (typeof kind === 'string') {
    const k = builtinKinds[kind]
    if (!k) throw new Error(`Unknown kind: ${kind}`)
    return { ...k, fillMode: filling, fill: filling === 'comment' ? k.commentFill : k.fill }
  }
  return kind
}

function stripFill(lines, kind) {
  return lines.filter(line => !kind.isFill(line))
}

function joinLines(lines) {
  return lines.length ? lines.join('\n') + '\n' : ''
}

/**
 * Pack a flat line array into pages, each ≤ pageSize bytes of content.
 * A line longer than pageSize gets its own page (a split would corrupt it).
 */
function packPages(lines, pageSize) {
  const pages = []
  let page = []
  let bytes = 0
  for (const line of lines) {
    const n = Buffer.byteLength(line) + 1
    if (page.length && bytes + n > pageSize) {
      pages.push(page)
      page = []
      bytes = 0
    }
    page.push(line)
    bytes += n
  }
  if (page.length) pages.push(page)
  return pages.length ? pages : [[]]
}

/**
 * Render one data page: the content lines, then filling up to pageSize so the
 * next page starts exactly at a pageSize boundary. The header's line count is
 * what marks the real end; the filling is padding, not a terminator.
 */
function extentOf(lines, pageSize) {
  const n = Buffer.byteLength(joinLines(lines))
  return Math.max(1, Math.ceil(n / pageSize))
}

/**
 * Render one data page to an EXACT MULTIPLE of pageSize — the alignment
 * invariant. A page of ordinary lines occupies one page; a line longer than a
 * page occupies k contiguous pages, and the caller records k in extents[].
 *
 * This is what makes a page's byte offset computable, and positional writing
 * therefore correct. The previous version returned a short buffer for an
 * oversized line, which left every later offset undefined.
 */
function renderPage(lines, kind, pageSize) {
  let out = joinLines(lines)
  const span = extentOf(lines, pageSize) * pageSize
  let free = span - Buffer.byteLength(out)
  const unit = kind.fill()
  const unitLen = Buffer.byteLength(unit)
  while (free >= unitLen) {
    out += unit
    free -= unitLen
  }
  if (free > 0) out += ' '.repeat(free)
  return Buffer.from(out, 'utf8')
}

/**
 * O header e o GENESIS do arquivo: magic, version, pageSize, layout, kind.
 * Nada ali muda depois que o arquivo existe, entao em condicao normal ele NAO e
 * reescrito — e uma pagina so, gravada uma vez.
 *
 * O que muda a cada escrita (contagem de linhas por pagina, extents, chaves de
 * split, logOffset) e ESTATISTICA DERIVADA, e vive fora daqui: no trailer. Foi
 * misturar as duas naturezas que fazia o header crescer com o arquivo e ser
 * reescrito inteiro a cada commit — 55 paginas por append num arquivo de 12MB.
 */
function serializeHeader(meta, pageSize) {
  const body = JSON.stringify({
    magic: MAGIC,
    version: HEADER_VERSION,
    pageSize,
    layout: meta.layout || 'sequential',
    kind: meta.kind || 'text'
  })
  const buf = Buffer.alloc(pageSize)
  buf.write(body, 0, 'utf8')
  return buf
}

/**
 * O TRAILER — as estatisticas derivadas do arquivo, gravadas DEPOIS das paginas
 * de dados: contagem de linhas por pagina, extents, chaves de split, logOffset.
 *
 * Fica no fim, e nao no comeco, por uma razao aritmetica: no comeco ele empurra
 * todas as paginas de dados quando cresce, e ai crescer custa reescrever o
 * arquivo. No fim ele so anda para frente, e nenhuma pagina de dados se move.
 *
 * E derivavel: se o trailer estiver corrompido ou ausente, as paginas de dados
 * bastam para reconstrui-lo (elas sao autodescritivas — o alinhamento diz onde
 * cada uma comeca e o filling diz onde o conteudo acaba). Por isso ele nao e
 * fonte de verdade, e sim cache do que as paginas ja dizem.
 */
// Um prefixo que nenhuma linha de dados produz: e assim que um leitor sabe que
// chegou ao trailer e nao a mais uma pagina de conteudo.
//
// O trailer tem dois regimes, e a escolha e do chamador:
//
//   volatil (padrao)  reconstruido a cada flush. Simples, mas gravar as stats
//                     inteiras por escrita faz o custo do append crescer com o
//                     arquivo — medido: 63 paginas por append em 12MB.
//   checkpoint        gravado so a cada N flushes. Entre checkpoints o append
//                     escreve UMA pagina de dados e mais nada. Na abertura, o
//                     que passou do checkpoint e reconstruido lendo as paginas
//                     a partir dali — elas sao autodescritivas, entao o trailer
//                     nunca foi fonte de verdade, so cache.
const TRAILER_MARK = '\u0000PAGEDTEXT-TRAILER\n'

function serializeTrailer(meta, pageSize) {
  const body = JSON.stringify({
    pages: meta.counts,
    extents: meta.extents,
    keys: meta.keys || [],
    logOffset: meta.logOffset ?? 0
  })
  // Alinhado a pageSize como qualquer outra pagina: o arquivo inteiro continua
  // sendo um multiplo exato, que e o invariante que torna offset calculavel.
  const span = Math.max(1, Math.ceil((Buffer.byteLength(body) + 1) / pageSize))
  const buf = Buffer.alloc(span * pageSize)
  buf.write(TRAILER_MARK + body + '\n', 0, 'utf8')
  return buf
}

function parseTrailer(buf) {
  try {
    const raw = buf.toString('utf8')
    if (!raw.startsWith(TRAILER_MARK)) return null
    const t = JSON.parse(raw.slice(TRAILER_MARK.length).trim())
    if (!Array.isArray(t.pages)) return null
    return t
  } catch { return null }
}

/** UNKNOWN is a distinct outcome from null: the file HAS a header we cannot
 *  read, so it must be discarded and rebuilt — never reinterpreted as legacy
 *  plain text, which would rewrite it destructively. */
const UNKNOWN = Symbol('unknown-header')

function parseHeader(buf) {
  const nul = buf.indexOf(0)
  const text = buf.toString('utf8', 0, nul === -1 ? buf.length : nul).trim()
  if (!text) return null
  let h
  try { h = JSON.parse(text) } catch { return null }
  if (h.magic !== MAGIC) return null
  if (h.version !== HEADER_VERSION) return UNKNOWN
  return h
}

function atomicReplace(file, buffers) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const fd = openSync(tmp, 'w')
  try {
    let pos = 0
    for (const b of buffers) {
      writeSync(fd, b, 0, b.length, pos)
      pos += b.length
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file)
}

/**
 * The synchronous page store. Owns the fd, the header, the visited-page cache
 * and the DIRTY SET. Reads a page on demand; on flush writes only the pages
 * that actually changed, each with a positioned writeSync.
 */
function makeStore(file, kind, pageSize, layout, opts = {}) {
  const CACHE_PAGES = opts.cachePages ?? 64
  let fd = null
  let counts = []            // line count per data page (from header)
  let extents = []           // pages OCCUPIED per data page (>=1; >1 = oversized line)
  let offsets = []           // byte offset of each data page (prefix sum of extents)
  let headerPages = 1
  const cache = new Map()    // pageIndex -> { lines: string[], dirty: bool }
  const dirty = new Set()    // page indices awaiting a positional write
  let headerDirty = false
  let structuralDirty = false   // page count/extents changed: offsets shifted
  let headerLayout = layout
  let splitKeys = []         // codec-owned; carried in the header, opaque here
  let logOffset = 0
  let needsRebuild = false   // header present but unreadable: caller must rebuild
  let lastWriteStats = { pages: 0, bytes: 0 }
  let headerWritten = false   // o genesis ja esta no disco?
  // Rodape: volatil (a cada flush) ou checkpoint (a cada N). O padrao e 1 —
  // volatil — porque e o comportamento mais simples de raciocinar; quem escreve
  // muito num arquivo grande sobe o N e paga so uma pagina por append.
  const checkpointEvery = Math.max(1, opts.checkpointEvery ?? 1)
  let sinceCheckpoint = 0

  function ensureFile() {
    mkdirSync(path.dirname(file), { recursive: true })
    if (!existsSync(file)) {
      writeFileSync(file, serializeHeader({ layout, kind: opts.kindName, counts: [], extents: [] }, pageSize))
    }
  }

  function openFd() {
    if (fd == null) fd = openSync(file, 'r+')
  }

  /** Recompute the byte offset of every data page from the extents. O(pages),
   *  and only when the page structure actually moved. */
  function recomputeOffsets() {
    offsets = new Array(counts.length)
    let pos = headerPages * pageSize
    for (let i = 0; i < counts.length; i++) {
      offsets[i] = pos
      pos += (extents[i] || 1) * pageSize
    }
    return pos
  }

  function dataEnd() {
    return counts.length ? offsets[counts.length - 1] + (extents[counts.length - 1] || 1) * pageSize
                         : headerPages * pageSize
  }

  /**
   * Reconstroi as stats lendo as paginas de dados. O trailer e cache, nao fonte
   * de verdade: cada pagina comeca num limite de pageSize e o filling marca onde
   * o conteudo dela acaba, entao as paginas se descrevem sozinhas.
   */
  function rebuildStatsFromPages(size) {
    counts = []
    extents = []
    let pos = pageSize                      // logo apos o header de genesis
    while (pos + pageSize <= size) {
      const buf = Buffer.alloc(pageSize)
      readSync(fd, buf, 0, pageSize, pos)
      const raw = buf.toString('utf8')
      // O trailer se anuncia; ele encerra as paginas de dados.
      if (raw.startsWith(TRAILER_MARK)) break
      const lines = raw.replace(/\r\n/g, '\n').split('\n')
      if (lines.at(-1) === '') lines.pop()
      const clean = stripFill(lines, kind)
      if (!clean.length && counts.length) break
      counts.push(clean.length)
      extents.push(1)
      pos += pageSize
    }
  }

  /**
   * Le as paginas que existem depois do ponto que o trailer declara e completa
   * as stats com elas. E o outro lado do checkpoint: o trailer diz ate onde
   * sabia, e as paginas dizem o resto.
   */
  function appendStatsFromPages(from, size) {
    let pos = from
    while (pos + pageSize <= size) {
      const buf = Buffer.alloc(pageSize)
      readSync(fd, buf, 0, pageSize, pos)
      const raw = buf.toString('utf8')
      if (raw.startsWith(TRAILER_MARK)) break
      const lines = raw.replace(/\r\n/g, '\n').split('\n')
      if (lines.at(-1) === '') lines.pop()
      const clean = stripFill(lines, kind)
      if (!clean.length) break
      counts.push(clean.length)
      extents.push(1)
      pos += pageSize
    }
  }

  function loadHeader() {
    openFd()
    const st = fstatSync(fd)
    const probe = Buffer.alloc(Math.min(pageSize, Math.max(0, st.size)))
    if (probe.length) readSync(fd, probe, 0, probe.length, 0)
    let h = probe.length ? parseHeader(probe) : null

    if (h === UNKNOWN) {
      // A header we cannot read is NOT legacy text. Reinterpreting it as lines
      // and flushing would rewrite the file with the wrong interpretation —
      // exactly how a v1 .proj used to be destroyed by a v2 reader. Present as
      // empty and let the caller rebuild from its source of truth.
      needsRebuild = true
      counts = []; extents = []; headerPages = 1; recomputeOffsets()
      return true
    }

    if (h) {
      headerWritten = true
      headerPages = 1
      headerLayout = h.layout || layout

      // O trailer esta depois das paginas de dados, no fim do arquivo. Ele e a
      // ultima linha: le-se a cauda e pega-se o que vem depois da ultima quebra.
      const tail = Math.min(st.size, 1 << 20)
      const tbuf = Buffer.alloc(tail)
      readSync(fd, tbuf, 0, tail, st.size - tail)
      const text = tbuf.toString('utf8')
      const at = text.lastIndexOf(TRAILER_MARK)
      const t = at === -1 ? null
        : parseTrailer(Buffer.from(text.slice(at).replace(/\u0000+$/, ''), 'utf8'))

      if (t) {
        counts = (t.pages || []).slice()
        extents = (t.extents || []).slice()
        while (extents.length < counts.length) extents.push(1)
        splitKeys = t.keys || []
        logOffset = t.logOffset ?? 0
        // O trailer pode estar ATRASADO: sob checkpoint, os appends desde o
        // ultimo gravaram paginas de dados sem regravar as stats. As paginas que
        // sobram depois do que o trailer declara sao reais, e sao lidas aqui.
        // E por isso que o trailer pode ficar para tras sem risco.
        const declared = pageSize + counts.reduce((a, e, i) => a + (extents[i] || 1) * pageSize, 0)
        if (st.size > declared) appendStatsFromPages(declared, st.size)
      } else {
        // Trailer ausente ou corrompido. Nao e perda: as paginas de dados sao
        // autodescritivas — o alinhamento diz onde cada uma comeca e o filling
        // diz onde o conteudo acaba — entao reconstroi-se a partir delas.
        rebuildStatsFromPages(st.size)
      }
      recomputeOffsets()
      return true
    }

    // No header at all. Either a fresh empty file, or legacy plain text: read
    // it, split, repage. This is the one O(file) path, taken once per file.
    if (st.size > 0) {
      const raw = Buffer.alloc(st.size)
      readSync(fd, raw, 0, st.size, 0)
      const lines = raw.toString('utf8').replace(/\r\n/g, '\n').split('\n')
      if (lines.at(-1) === '') lines.pop()
      replaceAll(stripFill(lines, kind))
      flush()
      return true
    }
    counts = []; extents = []; recomputeOffsets()
    return true
  }

  function evictIfNeeded() {
    while (cache.size > CACHE_PAGES) {
      let victim = null
      for (const [k, v] of cache) { if (!v.dirty) { victim = k; break } }
      if (victim == null) break        // everything dirty; keep until flush
      cache.delete(victim)
    }
  }

  function readPage(i) {
    if (cache.has(i)) return cache.get(i).lines
    if (i < 0 || i >= counts.length) return null
    openFd()
    const len = (extents[i] || 1) * pageSize
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, offsets[i])
    let lines = buf.toString('utf8').replace(/\r\n/g, '\n').split('\n')
    if (lines.at(-1) === '') lines.pop()
    lines = stripFill(lines, kind).slice(0, counts[i])
    cache.set(i, { lines, dirty: false })
    evictIfNeeded()
    return lines
  }

  function pageCount() { return counts.length }

  function totalLines() {
    let n = 0
    for (let i = 0; i < counts.length; i++) n += counts[i]
    return n
  }

  /** Materialise every logical line. O(file) — callers that can work
   *  page-local should. Bounded memory in the CACHE, not in the result. */
  function allLines() {
    const out = []
    for (let i = 0; i < counts.length; i++) out.push(...readPage(i))
    return out
  }

  /** Locate the page and in-page offset of a global logical index. */
  function locate(globalIdx) {
    let acc = 0
    for (let i = 0; i < counts.length; i++) {
      if (globalIdx < acc + counts[i]) return { page: i, local: globalIdx - acc }
      acc += counts[i]
    }
    return { page: counts.length, local: 0 }   // past the end
  }

  function lineAt(globalIdx) {
    if (globalIdx < 0) globalIdx += totalLines()
    const { page, local } = locate(globalIdx)
    const lines = readPage(page)
    return lines ? lines[local] : undefined
  }

  /** Mark page i changed: its lines are already updated in the cache. */
  function touch(i) {
    const entry = cache.get(i)
    if (!entry) return
    entry.dirty = true
    dirty.add(i)
    const before = extents[i] || 1
    const after = extentOf(entry.lines, pageSize)
    counts[i] = entry.lines.length
    if (after !== before) { extents[i] = after; structuralDirty = true }
    headerDirty = true
  }

  /**
   * Splice within the logical sequence, touching only the pages involved.
   * The tail is repaged ONLY from the first page that overflows — this is what
   * keeps an ordinary edit O(1) pages instead of O(file).
   */
  function spliceLines(at, delCount, insert) {
    const total = totalLines()
    if (at < 0) at = Math.max(0, total + at)
    at = Math.min(at, total)

    if (counts.length === 0) { replaceAll(insert.slice()); return [] }

    let { page, local } = locate(at)
    if (page >= counts.length) {
      // Appending past the last line: land at the END of the last page, not at
      // its start. Clamping the index alone would insert at the wrong offset.
      page = counts.length - 1
      local = counts[page]
    }
    const start = page

    // Collect the pages the operation spans: from `start` through whatever the
    // deletion reaches. Everything after stays untouched on disk.
    let need = delCount
    let last = start
    let acc = local
    while (need > 0 && last < counts.length) {
      const avail = counts[last] - acc
      const take = Math.min(avail, need)
      need -= take
      acc = 0
      if (need > 0) last++
      else break
    }
    if (last >= counts.length) last = counts.length - 1

    const window = []
    for (let i = start; i <= last; i++) window.push(...readPage(i))
    const removed = window.splice(local, delCount, ...insert)

    // Repage the window. If it still fits in the same number of pages, only
    // those pages are dirty and the tail never moves.
    const repacked = window.length ? packPages(window, pageSize) : []
    const span = last - start + 1

    if (repacked.length === span) {
      for (let i = 0; i < span; i++) {
        cache.set(start + i, { lines: repacked[i], dirty: true })
        counts[start + i] = repacked[i].length
        const e = extentOf(repacked[i], pageSize)
        if (e !== (extents[start + i] || 1)) { extents[start + i] = e; structuralDirty = true }
        dirty.add(start + i)
      }
      headerDirty = true
      return removed
    }

    // Caso do APPEND: a janela e a ultima pagina e ela transbordou em paginas
    // NOVAS no fim. Nada que ja existe se move — as paginas anteriores ficam nos
    // mesmos offsets — entao so as paginas da janela sao sujas. Sem este ramo o
    // caminho generico abaixo marcaria a cauda inteira e o custo do append
    // passaria a crescer com o arquivo (medido: 73 paginas por transbordo num
    // arquivo de 12MB, contra 2 num pequeno).
    if (last === counts.length - 1 && repacked.length > span) {
      for (let i = 0; i < repacked.length; i++) {
        const at = start + i
        counts[at] = repacked[i].length
        extents[at] = extentOf(repacked[i], pageSize)
        cache.set(at, { lines: repacked[i], dirty: true })
        dirty.add(at)
      }
      headerDirty = true
      recomputeOffsets()
      return removed
    }

    // The window changed page count: everything after `last` shifts. Splice the
    // page arrays and mark from `start` onward dirty.
    const tail = []
    for (let i = last + 1; i < counts.length; i++) tail.push(i)
    const tailPages = tail.map(i => ({ lines: readPage(i), count: counts[i], ext: extents[i] || 1 }))

    const newCounts = counts.slice(0, start)
    const newExtents = extents.slice(0, start)
    const newCache = new Map()
    for (let i = 0; i < start; i++) if (cache.has(i)) newCache.set(i, cache.get(i))

    let w = start
    for (const p of repacked) {
      newCounts.push(p.length)
      newExtents.push(extentOf(p, pageSize))
      newCache.set(w, { lines: p, dirty: true })
      w++
    }
    for (const p of tailPages) {
      newCounts.push(p.count)
      newExtents.push(p.ext)
      newCache.set(w, { lines: p.lines, dirty: true })
      w++
    }

    counts = newCounts
    extents = newExtents
    cache.clear()
    for (const [k, v] of newCache) cache.set(k, v)
    dirty.clear()
    for (let i = start; i < counts.length; i++) dirty.add(i)
    structuralDirty = true
    headerDirty = true
    return removed
  }

  /** Replace ONE page's lines in place, marking only it dirty. The page count
   *  does not change, so no later offset moves. */
  function writePage(i, lines) {
    if (i < 0 || i >= counts.length) return false
    cache.set(i, { lines: lines.slice(), dirty: true })
    dirty.add(i)
    counts[i] = lines.length
    const e = extentOf(lines, pageSize)
    if (e !== (extents[i] || 1)) { extents[i] = e; structuralDirty = true }
    headerDirty = true
    return true
  }

  /** Replace the entire logical content. Every page is dirty by definition. */
  function replaceAll(lines) {
    const clean = stripFill(lines, kind)
    const pages = clean.length ? packPages(clean, pageSize) : []
    cache.clear()
    dirty.clear()
    counts = pages.map(p => p.length)
    extents = pages.map(p => extentOf(p, pageSize))
    pages.forEach((p, i) => { cache.set(i, { lines: p, dirty: true }); dirty.add(i) })
    structuralDirty = true
    headerDirty = true
    recomputeOffsets()
  }

  /**
   * Commit. Writes the header (always — it is the arbiter) plus ONLY the pages
   * in the dirty set, each with a positioned writeSync. Writing one line into a
   * 1000-page store writes 2 pages.
   *
   * Durability is fsync on the same fd rather than temp+rename: rename would
   * mean re-materialising the whole file, which is the very cost this removes.
   * Torn-page recovery is by rebuild from the caller's source of truth, the
   * doctrine this project already applies to a corrupt page.
   */
  function flush() {
    if (!headerDirty && !dirty.size) { lastWriteStats = { pages: 0, bytes: 0 }; return }
    openFd()

    let pagesWritten = 0
    let bytes = 0

    // O header e genesis: uma pagina, escrita so quando o arquivo nasce. Em
    // regime normal ele NAO e tocado, e por isso nao aparece no custo do append.
    if (!headerWritten) {
      const header = serializeHeader({ layout: headerLayout, kind: opts.kindName }, pageSize)
      writeSync(fd, header, 0, header.length, 0)
      headerWritten = true
      pagesWritten += 1
      bytes += header.length
    }

    recomputeOffsets()

    const targets = structuralDirty
      ? Array.from({ length: counts.length }, (_, i) => i)
      : [...dirty].sort((a, b) => a - b)

    for (const i of targets) {
      const lines = readPage(i)
      if (lines == null) continue
      const buf = renderPage(lines, kind, pageSize)
      writeSync(fd, buf, 0, buf.length, offsets[i])
      pagesWritten += buf.length / pageSize
      bytes += buf.length
    }

    // O trailer vai DEPOIS das paginas de dados: crescer nao empurra pagina
    // nenhuma, ele so anda para frente.
    //
    // E ele so e gravado no CHECKPOINT. Gravar as stats a cada flush faz o
    // append pagar pelo tamanho do arquivo (medido: 63 paginas/append em 12MB),
    // que e exatamente o custo que esta feature existe para remover. Entre
    // checkpoints o append escreve uma pagina de dados e mais nada; o que ficou
    // para tras e reconstruido na abertura, lendo as paginas.
    const end = dataEnd()
    sinceCheckpoint++
    const due = sinceCheckpoint >= checkpointEvery
    if (due) {
      const trailer = serializeTrailer({ counts, extents, keys: splitKeys, logOffset }, pageSize)
      writeSync(fd, trailer, 0, trailer.length, end)
      bytes += trailer.length
      sinceCheckpoint = 0
      const total = end + trailer.length
      if (fstatSync(fd).size > total) ftruncateSync(fd, total)
    } else if (fstatSync(fd).size > end) {
      // Ha um trailer velho logo depois dos dados. Ele descreve uma versao
      // anterior, entao seria pior que nao ter nenhum: some com ele.
      ftruncateSync(fd, end)
    }

    fsyncSync(fd)
    for (const [, entry] of cache) entry.dirty = false
    dirty.clear()
    headerDirty = false
    structuralDirty = false
    lastWriteStats = { pages: pagesWritten, bytes, checkpoint: due }
  }

  function pagesInfo() {
    const info = []
    for (let i = 0; i < counts.length; i++) {
      const lines = readPage(i)
      info.push({
        index: i,
        lines: lines.length,
        bytes: Buffer.byteLength(joinLines(lines)),
        offset: offsets[i],
        extent: extents[i] || 1,
        aligned: offsets[i] % pageSize === 0
      })
    }
    return info
  }

  function close() {
    if (fd != null) { closeSync(fd); fd = null }
  }

  ensureFile()
  loadHeader()

  return {
    get layout() { return headerLayout },
    get needsRebuild() { return needsRebuild },
    get logOffset() { return logOffset },
    set logOffset(v) { logOffset = v; headerDirty = true },
    get keys() { return splitKeys },
    set keys(v) { splitKeys = v; headerDirty = true },
    get lastWrite() { return lastWriteStats },
    get cacheSize() { return cache.size },
    pageCount, totalLines, allLines, lineAt, locate, readPage,
    replaceAll, spliceLines, touch, writePage, flush,
    pagesInfo, close, _cache: cache
  }
}

function makeCursor(owner, start = 0, initial = null) {
  let lines = initial ? initial.slice() : owner._snapshot()
  let pos = Math.max(0, Math.min(start, lines.length))
  let dirty = !!initial

  const cursor = {
    get pos() { return pos },
    get length() { return lines.length },
    get dirty() { return dirty },
    tell() { return pos },
    seek(n) {
      if (!Number.isInteger(n)) throw new TypeError('cursor position must be an integer')
      pos = Math.max(0, Math.min(n, lines.length))
      return cursor
    },
    next(n = 1) { return cursor.seek(pos + n) },
    prev(n = 1) { return cursor.seek(pos - n) },
    read(n = 1) {
      const out = lines.slice(pos, pos + n)
      pos = Math.min(lines.length, pos + n)
      return n === 1 ? out[0] : out
    },
    peek(n = 1) {
      const out = lines.slice(pos, pos + n)
      return n === 1 ? out[0] : out
    },
    insert(...values) {
      const a = values.flat()
      lines.splice(pos, 0, ...a)
      pos += a.length
      dirty = true
      return cursor
    },
    write(...values) {
      const a = values.flat()
      lines.splice(pos, a.length, ...a)
      pos += a.length
      dirty = true
      return cursor
    },
    overwrite(value) { return cursor.write(value) },
    delete(n = 1) {
      lines.splice(pos, n)
      dirty = true
      return cursor
    },
    replace(n, ...values) {
      const a = values.flat()
      lines.splice(pos, n, ...a)
      pos += a.length
      dirty = true
      return cursor
    },
    save() {
      return owner._saveCursor({ version: 1, pos, lines, dirty })
    },
    rollback() {
      lines = owner._snapshot()
      pos = Math.min(pos, lines.length)
      dirty = false
      return cursor
    },
    flush() {
      owner._flushLines(lines)
      dirty = false
      return cursor
    },
    [Symbol.iterator]() {
      return lines.slice(pos)[Symbol.iterator]()
    }
  }
  return cursor
}

/**
 * PagedText(options) or PagedText(path, options).
 * Synchronous — returns the Proxy directly, no await.
 */
export function PagedText(options, maybeOptions = {}) {
  const opt = typeof options === 'string' ? { ...maybeOptions, path: options } : options
  if (!opt?.path) throw new TypeError('PagedText requires path')

  const file = path.resolve(opt.path)
  const stateFile = path.resolve(opt.state || `${file}.cursor`)
  const kind = kindOf(opt.kind, opt.filling || 'ws')
  const pageSize = opt.pageSize || DEFAULT_PAGE_SIZE
  const layout = opt.layout || 'sequential'

  const store = makeStore(file, kind, pageSize, layout, {
    kindName: typeof opt.kind === 'string' ? opt.kind : 'text',
    cachePages: opt.cachePages,
    checkpointEvery: opt.checkpointEvery
  })

  // Mutations are write-through, as they were before this sprint: the caller
  // sees the file updated after each one. What changed is the COST — the
  // commit now writes the dirty page and the header, not the whole file.
  const commit = () => { store.flush(); return store }

  const api = {
    _store: store,
    get length() { return store.totalLines() },
    get text() { return joinLines(store.allLines()) },
    get layout() { return store.layout },

    at(i) { return store.lineAt(i) },
    slice(...a) { return store.allLines().slice(...a) },
    join(sep = '\n') { return store.allLines().join(sep) },
    includes(x) { return store.allLines().includes(x) },
    indexOf(x) { return store.allLines().indexOf(x) },
    lastIndexOf(x) { return store.allLines().lastIndexOf(x) },
    map(fn) { return store.allLines().map(fn) },
    filter(fn) { return store.allLines().filter(fn) },
    find(fn) { return store.allLines().find(fn) },
    findIndex(fn) { return store.allLines().findIndex(fn) },
    some(fn) { return store.allLines().some(fn) },
    every(fn) { return store.allLines().every(fn) },
    forEach(fn) { return store.allLines().forEach(fn) },
    reduce(fn, init) {
      return arguments.length > 1 ? store.allLines().reduce(fn, init) : store.allLines().reduce(fn)
    },
    reduceRight(fn, init) {
      return arguments.length > 1 ? store.allLines().reduceRight(fn, init) : store.allLines().reduceRight(fn)
    },
    entries() { return store.allLines().entries() },
    keys() { return store.allLines().keys() },
    values() { return store.allLines().values() },

    // Every mutation is PAGE-LOCAL: it locates the page and rewrites only it
    // (cascading further only when a page overflows). Previously each of these
    // materialised the whole file and rewrote it, which made a loop of unit
    // mutations O(n^2) — the reason the engine's own tests had to batch.
    push(...x) {
      const a = x.flat()
      store.spliceLines(store.totalLines(), 0, a)
      commit()
      return store.totalLines()
    },
    pop() {
      const n = store.totalLines()
      if (!n) return undefined
      const r = store.spliceLines(n - 1, 1, [])[0]
      commit()
      return r
    },
    shift() {
      if (!store.totalLines()) return undefined
      const r = store.spliceLines(0, 1, [])[0]
      commit()
      return r
    },
    unshift(...x) {
      store.spliceLines(0, 0, x.flat())
      commit()
      return store.totalLines()
    },
    splice(at, delCount, ...items) {
      const n = store.totalLines()
      const start = at < 0 ? Math.max(0, n + at) : Math.min(at, n)
      const del = delCount === undefined ? n - start : Math.max(0, delCount)
      const r = store.spliceLines(start, del, items.flat())
      commit()
      return r
    },
    reverse() { return store.allLines().slice().reverse() },

    cursor(pos = 0) { return makeCursor(api, pos) },
    loadCursor() {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'))
      return makeCursor(api, state.pos, state.lines)
    },
    _snapshot() { return store.allLines() },
    _saveCursor(state) {
      atomicReplace(stateFile, [Buffer.from(JSON.stringify(state), 'utf8')])
      return api
    },
    _flushLines(lines) {
      store.replaceAll(lines)
      store.flush()
      return api
    },
    flush() {
      store.flush()
      return api
    },
    pages() {
      return store.pagesInfo()
    },
    close() { store.close() },

    [Symbol.iterator]() { return store.allLines()[Symbol.iterator]() }
  }

  return new Proxy(api, {
    get(target, prop, receiver) {
      if (indexKey(prop)) return store.lineAt(Number(prop))
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, value, receiver) {
      if (indexKey(prop)) {
        const i = Number(prop)
        const n = store.totalLines()
        if (i < n) {
          // In-place overwrite: locate the page, replace the line, mark dirty.
          const { page, local } = store.locate(i)
          store.readPage(page)[local] = value
          store.touch(page)
          commit()
        } else {
          const pad = Array.from({ length: i - n }, () => '')
          store.spliceLines(n, 0, [...pad, value])
          commit()
        }
        return true
      }
      return Reflect.set(target, prop, value, receiver)
    },
    deleteProperty(target, prop) {
      if (indexKey(prop)) {
        store.spliceLines(Number(prop), 1, [])
        commit()
        return true
      }
      return Reflect.deleteProperty(target, prop)
    }
  })
}

/**
 * Le o rodape de stats de um arquivo paginado sem abrir um store.
 * Util para testes e ferramentas de inspecao: e a resposta a "o que este
 * arquivo diz de si mesmo?" sem instanciar nada.
 */
export function readTrailer(file) {
  const raw = readFileSync(file)
  const at = raw.lastIndexOf(TRAILER_MARK)
  if (at === -1) return null
  return parseTrailer(Buffer.from(raw.toString('utf8', at).replace(/\u0000+$/, ''), 'utf8'))
}

export default PagedText
