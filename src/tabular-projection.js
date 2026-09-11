/**
 * tabular-projection.js — feature 2.2
 *
 * A TERCEIRA leitura da mesma projecao. Nao e um storage novo: keyed le as
 * paginas como mapa, sequential as le como ordem, e esta as le como TABELA com
 * schema. Os tres sao codecs sobre o mesmo PagedText, que e a tese do
 * docs/04-projecao-tabular-hierarquica.md — hierarquica e tabular sao duas
 * interpretacoes, nao dois arquivos.
 *
 * O que a tabular acrescenta as outras duas e o que o schema torna possivel:
 *
 *   1. O SCHEMA E A PRIMEIRA LINHA DO ARQUIVO, na forma
 *      `name:str,age:int?,email:str@`. Nao e um objeto JSON na linha 1 — isso
 *      quebraria o formato. A declaracao de coluna E uma linha de CSV valida,
 *      entao o arquivo continua sendo lido por qualquer parser comum, com os
 *      nomes das colunas onde um CSV os poe. Isso so e possivel depois da 2.1:
 *      enquanto a pagina 0 era JSON de header e metade do arquivo era byte NUL,
 *      a primeira linha ja estava ocupada.
 *
 *   2. O INDICE E POR PAGINA, nao por registro. Uma coluna marcada com `@`
 *      guarda min/max por pagina, entao um range descarta paginas INTEIRAS sem
 *      abri-las. E o que torna indexavel um arquivo de muitos GB: o indice
 *      cresce com o numero de PAGINAS, nao de registros.
 *
 * Os tipos sao deliberadamente restritos a str/int/float/bool. Nao e um sistema
 * de tipos generico: e o conjunto que tem representacao textual canonica e
 * ORDEM TOTAL, e e a ordem que sustenta o range index. Campo vazio e null, e
 * essa e a unica codificacao de null — o que obriga o str vazio a viajar
 * entre aspas, para que `` e `""` nao colidam.
 */

import { PagedText } from '../pagedtext/pagedtext.js'

const PAGE_SIZE = 4096
const CACHE_PAGES = 64

const TYPES = new Set(['str', 'int', 'float', 'bool'])

// ---- schema ------------------------------------------------------------

/**
 * `name:str,age:int?,email:str@` -> colunas.
 *
 * A gramatica e a do docs/05: `campo : tipo [nullabilidade] [indice]`. Os
 * sufixos sao aceitos em qualquer ordem (`str?@` e `str@?`) porque sao dois
 * eixos independentes, e exigir ordem seria rigor sem conteudo.
 */
export function parseSchema(line) {
  const cols = splitCsv(line).map(decl => {
    const colon = decl.indexOf(':')
    if (colon === -1) throw new Error(`coluna sem tipo: ${JSON.stringify(decl)}`)
    const name = decl.slice(0, colon).trim()
    let rest = decl.slice(colon + 1).trim()
    let nullable = false, indexed = false
    // Os sufixos saem do fim, um de cada vez, para que a ordem entre eles nao
    // importe. O que sobra tem que ser o tipo inteiro — nao um prefixo dele.
    for (;;) {
      if (rest.endsWith('?')) { nullable = true; rest = rest.slice(0, -1) }
      else if (rest.endsWith('@')) { indexed = true; rest = rest.slice(0, -1) }
      else break
    }
    if (!name) throw new Error(`coluna sem nome: ${JSON.stringify(decl)}`)
    if (!TYPES.has(rest)) throw new Error(`tipo desconhecido: ${JSON.stringify(rest)}`)
    return { name, type: rest, nullable, indexed }
  })
  const seen = new Set()
  for (const c of cols) {
    if (seen.has(c.name)) throw new Error(`coluna repetida: ${c.name}`)
    seen.add(c.name)
  }
  return cols
}

export function formatSchema(cols) {
  return cols.map(c =>
    `${csvField(c.name)}:${c.type}${c.nullable ? '?' : ''}${c.indexed ? '@' : ''}`
  ).join(',')
}

// ---- valores -----------------------------------------------------------

/**
 * Texto -> valor tipado. O campo VAZIO e null e so ele: e por isso que o str
 * vazio e escrito como `""`, senao os dois seriam o mesmo byte.
 */
export function decodeValue(raw, col, quoted = false) {
  // `""` e string vazia; vazio cru e null. So o `quoted` separa os dois.
  if (raw === '' && quoted && col.type === 'str') return ''
  if (raw === '') {
    if (!col.nullable) throw new Error(`coluna ${col.name} nao e nullable`)
    return null
  }
  switch (col.type) {
    case 'str': return raw
    case 'int': {
      if (!/^-?\d+$/.test(raw)) throw new Error(`int invalido em ${col.name}: ${raw}`)
      return Number(raw)
    }
    case 'float': {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new Error(`float invalido em ${col.name}: ${raw}`)
      return n
    }
    case 'bool': {
      if (raw === 'true') return true
      if (raw === 'false') return false
      throw new Error(`bool invalido em ${col.name}: ${raw}`)
    }
  }
}

/** Valor -> texto canonico. Canonico importa: e o texto que o range index
 *  compara, e duas escritas do mesmo valor tem que dar o mesmo byte. */
export function encodeValue(v, col) {
  if (v === null || v === undefined) {
    if (!col.nullable) throw new Error(`coluna ${col.name} nao aceita null`)
    return ''
  }
  switch (col.type) {
    // O str vazio vira `""` porque o vazio cru ja significa null. Fora esse
    // caso, o escaping e o convencional de CSV.
    case 'str': return v === '' ? '""' : csvField(String(v))
    case 'int': {
      if (!Number.isInteger(v)) throw new Error(`int invalido em ${col.name}: ${v}`)
      return String(v)
    }
    case 'float': {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`float invalido em ${col.name}: ${v}`)
      return String(v)
    }
    case 'bool': {
      if (typeof v !== 'boolean') throw new Error(`bool invalido em ${col.name}: ${v}`)
      return v ? 'true' : 'false'
    }
  }
}

// ---- CSV ---------------------------------------------------------------

function csvField(s) {
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** Split de uma linha de CSV respeitando aspas. Uma linha so — o formato nao
 *  permite newline dentro de campo, porque a LINHA e a unidade de paginacao:
 *  um campo multilinha atravessaria a fronteira de pagina.
 *
 *  Com `marks`, devolve tambem quais campos vieram ENTRE ASPAS. Sem isso o
 *  `""` chega ao decode como string vazia, indistinguivel do vazio cru — e o
 *  vazio cru e null. A diferenca entre `` e `""` e a diferenca entre null e
 *  string vazia, e ela so existe antes do unquote. */
export function splitCsv(line, marks) {
  const out = []
  const wasQuoted = []
  let cur = '', quoted = false, seen = false, i = 0
  while (i < line.length) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      cur += ch; i++
    } else if (ch === '"' && cur === '') { quoted = true; seen = true; i++ }
    else if (ch === ',') { out.push(cur); wasQuoted.push(seen); cur = ''; seen = false; i++ }
    else { cur += ch; i++ }
  }
  out.push(cur)
  wasQuoted.push(seen)
  if (marks) marks.length = 0, marks.push(...wasQuoted)
  return out
}

// ---- ordem -------------------------------------------------------------

/** A ordem total de que o range index depende. Numerica para int/float,
 *  lexicografica para str, false<true para bool. Null fica FORA do min/max:
 *  ele nao tem posicao na ordem, e fingir que tem responderia errado a um
 *  range. Uma pagina com null numa coluna indexada e sempre candidata. */
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0 }

export function TabularProjection(file, { schema, pageSize = PAGE_SIZE } = {}) {
  const store = PagedText(file, {
    pageSize, layout: 'sequential', kind: 'csv', cachePages: CACHE_PAGES
  })._store

  let cols = null
  let index = []          // por pagina: { n, cols: { nome: [min,max] } }
  let pending = []

  // O schema vem do arquivo quando ele ja existe, e do chamador quando nasce.
  // O do arquivo GANHA: ele descreve os bytes que estao la, e um schema novo
  // por cima deles seria uma reinterpretacao silenciosa.
  function boot() {
    if (store.pageCount() > 0) {
      const first = store.readPage(0)?.[0]
      if (first != null) cols = parseSchema(first)
      const saved = store.keys
      if (Array.isArray(saved) && saved.length && typeof saved[0] === 'object') index = saved
      else rebuildIndex()
      return
    }
    if (!schema) throw new Error('arquivo novo exige schema')
    cols = typeof schema === 'string' ? parseSchema(schema) : schema
    store.replaceAll([formatSchema(cols)])
    store.flush()
    rebuildIndex()
  }

  const indexed = () => cols.filter(c => c.indexed)

  /** As linhas de UMA pagina, ja sem o schema e sem o enchimento. */
  function pageRows(i) {
    const lines = store.readPage(i)
    if (!lines) return []
    const rows = []
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j]
      if (i === 0 && j === 0) continue                 // o schema
      if (line === '' || /^\s*,?\s*$/.test(line)) continue   // enchimento
      rows.push(decodeRow(line))
    }
    return rows
  }

  function decodeRow(line) {
    const marks = []
    const parts = splitCsv(line, marks)
    const row = {}
    for (let i = 0; i < cols.length; i++) {
      row[cols[i].name] = decodeValue(parts[i] ?? '', cols[i], marks[i] || false)
    }
    return row
  }

  function encodeRow(row) {
    return cols.map(c => encodeValue(row[c.name] ?? null, c)).join(',')
  }

  /** min/max por pagina, para as colunas `@`. E ISTO que deixa um range pular
   *  pagina: com o min/max na mao, uma pagina cujo intervalo nao cruza o do
   *  range nunca e aberta. */
  function summarize(rows) {
    const out = { n: rows.length, cols: {} }
    for (const c of indexed()) {
      let min = null, max = null, hasNull = false
      for (const r of rows) {
        const v = r[c.name]
        if (v === null || v === undefined) { hasNull = true; continue }
        if (min === null || cmp(v, min) < 0) min = v
        if (max === null || cmp(v, max) > 0) max = v
      }
      out.cols[c.name] = { min, max, hasNull }
    }
    return out
  }

  function rebuildIndex() {
    index = []
    for (let i = 0; i < store.pageCount(); i++) index.push(summarize(pageRows(i)))
  }

  function flush() {
    if (pending.length) {
      store.spliceLines(store.totalLines(), 0, pending.map(encodeRow))
      pending = []
    }
    rebuildIndex()
    store.keys = index
    store.flush()
  }

  // Quantas paginas foram ABERTAS na ultima consulta. E a metrica da feature:
  // sem ela, "o range le menos paginas" e afirmacao sem prova.
  let pagesRead = 0

  const api = {
    get schema() { return cols.map(c => ({ ...c })) },
    get pageCount() { return store.pageCount() },
    get pagesRead() { return pagesRead },

    push(row) { pending.push(row); return api },
    flush() { flush(); return api },

    /** Varredura completa. O piso contra o qual o range e medido. */
    all() {
      flushIfPending()
      pagesRead = 0
      const out = []
      for (let i = 0; i < store.pageCount(); i++) { pagesRead++; out.push(...pageRows(i)) }
      return out
    },

    /**
     * Range sobre uma coluna. Se ela e `@`, as paginas cujo [min,max] nao cruza
     * [lo,hi] sao descartadas SEM leitura — e o ganho da feature. Se nao e, o
     * resultado e o mesmo, so que lendo tudo: correto, apenas mais caro.
     */
    range(name, lo, hi) {
      flushIfPending()
      const col = cols.find(c => c.name === name)
      if (!col) throw new Error(`coluna desconhecida: ${name}`)
      pagesRead = 0
      const out = []
      for (let i = 0; i < store.pageCount(); i++) {
        if (col.indexed && index[i] && index[i].cols[name] && !index[i].cols[name].hasNull) {
          const { min, max } = index[i].cols[name]
          // Pagina vazia (so o schema) ou fora do intervalo: nao se abre.
          if (min === null) continue
          if (hi !== undefined && cmp(min, hi) > 0) continue
          if (lo !== undefined && cmp(max, lo) < 0) continue
        }
        pagesRead++
        for (const r of pageRows(i)) {
          const v = r[name]
          if (v === null || v === undefined) continue
          if (lo !== undefined && cmp(v, lo) < 0) continue
          if (hi !== undefined && cmp(v, hi) > 0) continue
          out.push(r)
        }
      }
      return out
    }
  }

  function flushIfPending() { if (pending.length) flush() }

  boot()
  return api
}
