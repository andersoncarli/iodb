// O contrato como codigo, nao como prosa (TABLE.md secao 12).
// Deteccao por PRESENCA DE METODO -- uma tabela nao pode mentir sobre o que tem.

export function isTable(t) {
  return !!t && typeof t === 'object' && typeof t.scan === 'function' && 'schema' in t
}

export function capabilities(t) {
  const has = {
    get: typeof t?.get === 'function',
    find: typeof t?.find === 'function',
    range: typeof t?.range === 'function',
    count: typeof t?.count === 'function',
    filter: typeof t?.filter === 'function',
    group: typeof t?.group === 'function'
  }

  let level = 0
  if (has.get) level = 1
  if (has.get && has.find) level = 2
  if (has.get && has.find && has.range) level = 3
  if (has.get && has.find && has.range && has.count) level = 4
  if (level === 4 && (has.filter || has.group)) level = 5

  return { level, has }
}
