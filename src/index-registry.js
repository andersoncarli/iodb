/**
 * Registro nome -> factory de implementacoes de indice. Uma implementacao nova
 * se registra aqui e nunca precisa editar io-engine.js.
 */
import { assertIndexShape } from './index-contract.js'
import { TextPagesIndex } from './index-textpages.js'

const impls = new Map()

// text-pages e o default (ver 2.4-indice-paginado-4k.md): cat/grep continuam
// funcionando e roda em Node e Bun. sqlite se registra sozinho (ver
// adapters/sqlite.js) so quando importado, ja que bun:sqlite e Bun-only.
registerIndex('text-pages', TextPagesIndex)

export function registerIndex(name, factory) {
  impls.set(name, factory)
}

export function createIndex(name, file, opts) {
  const factory = impls.get(name)
  if (!factory) {
    const known = [...impls.keys()].join(', ') || '(nenhuma registrada)'
    throw new Error(`[index-registry] implementacao desconhecida: '${name}'. Conhecidas: ${known}`)
  }
  const impl = factory(file, opts)
  assertIndexShape(impl)
  return impl
}

export function knownIndexImpls() {
  return [...impls.keys()]
}
