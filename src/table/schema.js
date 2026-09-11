/**
 * schema.js — feature 8.2
 *
 * Duas gramaticas para a mesma coisa, e nenhuma delas e canonica. O POJO
 * `{fields: {name: {type,pk,unique,indexed,nullable,default}}}` e o unico
 * canonico (TABLE.md secao 3); SOML e CSV sao PARSERS para ele.
 *
 *   normalizeSchema(input)  — POJO | SOML | colunas-CSV -> POJO canonico
 *   schemaToCsvCols(pojo)   — POJO -> colunas no formato de tabular-projection.js
 *   csvColsToSchema(cols)   — colunas de tabular-projection.js -> POJO
 *   schemaLossToCsv(pojo)   — o que se perde ao serializar para CSV
 *
 * Mapa de tipos, escrito uma vez: str <-> string, int|float <-> number,
 * bool <-> boolean. A largura int/float nao existe no POJO — TABLE.md fala
 * so `number` — e por isso ela viaja como `{type:'number', width:'int'}`
 * quando a origem e CSV, para que o ida-e-volta nao perca informacao.
 */

const CSV_TO_POJO_TYPE = { str: 'string', int: 'number', float: 'number', bool: 'boolean' }

// Campos que uma linha de CSV nao tem onde guardar. Declarados, nao escondidos.
const LOST_TO_CSV = ['default', 'autoinc', 'autohash']

/** `'id number pk autohash|autoinc': 0` -> { name, type, pk, unique, indexed,
 *  nullable, autohash, autoinc, default }. Um par chave-DSL/default de cada vez. */
function parseSomlKey(key, def) {
  const parts = key.trim().split(/\s+/)
  const name = parts.shift()
  if (!name) throw new Error(`SOML: campo sem nome em ${JSON.stringify(key)}`)
  const field = { type: undefined }
  for (const mod of parts) {
    for (const alt of mod.split('|')) {
      switch (alt) {
        case 'string': case 'number': case 'boolean': field.type = alt; break
        case 'pk': field.pk = true; break
        case 'unique': field.unique = true; break
        case 'indexed': field.indexed = true; break
        case 'null': case 'nullable': field.nullable = true; break
        case 'autoinc': field.autoinc = true; break
        case 'autohash': field.autohash = true; break
        default: throw new Error(`SOML: modificador desconhecido "${alt}" em ${JSON.stringify(key)}`)
      }
    }
  }
  if (!field.type) throw new Error(`SOML: campo sem tipo em ${JSON.stringify(key)}`)
  field.default = def
  return { name, field }
}

function isSoml(input) {
  return input && typeof input === 'object' && !Array.isArray(input) &&
    !('fields' in input) &&
    Object.keys(input).every(k => /\s/.test(k))
}

function isCsvCols(input) {
  return Array.isArray(input) && input.every(c => c && typeof c === 'object' && 'name' in c && 'type' in c)
}

/** Qualquer forma reconhecida -> POJO canonico `{fields: {...}}`. Idempotente:
 *  normalizar um POJO ja normalizado devolve o mesmo conteudo. */
export function normalizeSchema(input) {
  if (input == null) throw new Error('normalizeSchema: schema ausente')

  if (input.fields && typeof input.fields === 'object') {
    const fields = {}
    for (const [name, f] of Object.entries(input.fields)) fields[name] = { ...f }
    return { fields }
  }

  if (isCsvCols(input)) return csvColsToSchema(input)

  if (isSoml(input)) {
    const fields = {}
    for (const [key, def] of Object.entries(input)) {
      const { name, field } = parseSomlKey(key, def)
      fields[name] = field
    }
    return { fields }
  }

  throw new Error('normalizeSchema: forma de schema nao reconhecida (nem POJO, nem SOML, nem colunas CSV)')
}

/** POJO -> colunas na forma de tabular-projection.js (parseSchema/formatSchema),
 *  mais o `loss` — os campos que essa serializacao nao consegue carregar. */
export function schemaToCsvCols(pojoInput) {
  const pojo = normalizeSchema(pojoInput)
  const loss = []
  const cols = Object.entries(pojo.fields).map(([name, f]) => {
    if (f.type !== 'number' && f.type !== 'string' && f.type !== 'boolean') {
      throw new Error(`schemaToCsvCols: tipo "${f.type}" nao tem representacao CSV (campo ${name})`)
    }
    const type = f.type === 'string' ? 'str' : f.type === 'boolean' ? 'bool' : (f.width === 'float' ? 'float' : 'int')
    for (const lostKey of LOST_TO_CSV) {
      if (f[lostKey] !== undefined && f[lostKey] !== false) loss.push({ field: name, key: lostKey, value: f[lostKey] })
    }
    return { name, type, nullable: !!f.nullable, indexed: !!f.indexed, pk: !!f.pk, unique: !!f.unique }
  })
  return { cols, loss }
}

/** Colunas de tabular-projection.js -> POJO canonico. */
export function csvColsToSchema(cols) {
  const fields = {}
  for (const c of cols) {
    const field = { type: CSV_TO_POJO_TYPE[c.type] }
    if (c.type === 'int' || c.type === 'float') field.width = c.type
    if (c.nullable) field.nullable = true
    if (c.indexed) field.indexed = true
    if (c.pk) field.pk = true
    if (c.unique) field.unique = true
    fields[c.name] = field
  }
  return { fields }
}

/** So a lista do que se perde — sem serializar. */
export function schemaLossToCsv(pojoInput) {
  return schemaToCsvCols(pojoInput).loss
}
