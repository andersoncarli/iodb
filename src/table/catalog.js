/**
 * catalog.js — feature 8.7
 *
 * `IO('mydb/')` e depois `db.users` representa `mydb/users.table.*` SEM
 * materializar o arquivo (TABLE.md secao 18). `db.users` produz um NO,
 * `{op:'source', name:'users'}`, nao a tabela -- a resolucao acontece na
 * execucao, o que mantem a camada de query independente do sistema de
 * arquivos.
 *
 * `require('fs')` (nao `import`) de proposito: exports de modulo ES sao
 * somente-leitura mesmo quando `writable:true` no descriptor -- um spy que
 * reatribui `fsmod.existsSync` levantaria "assign to readonly property".
 * O objeto de exports do CommonJS e mutavel, e e o que deixa um teste
 * espionar "acessar db.foo nao faz syscall" de verdade, em vez de so
 * afirmar.
 */
import { join } from 'path'
const fsmod = require('fs')
import { tabularTable } from './tabular-table.js'
import { ioTable } from './io-table.js'
import { sqliteTable } from './sqlite-table.js'
import { IO } from '../io-engine.js'

/** Por extensao, na ordem em que o catalogo prefere resolver: CSV tipado
 *  primeiro (o formato mais barato de abrir), depois o log append-only.
 *  sqlite precisa do nome da tabela, que o catalogo nao inventa -- fica de
 *  fora da resolucao automatica por arquivo; quem quiser sqlite registra
 *  explicitamente (ver `registerBacking`). */
function resolveByFile(dir, name) {
  const csvPath = join(dir, `${name}.csv`)
  if (fsmod.existsSync(csvPath)) return () => tabularTable(csvPath)

  const dashPath = join(dir, `${name}.dash`)
  if (fsmod.existsSync(dashPath)) {
    return () => {
      const io = IO(dashPath)
      io.open()
      return ioTable(io)
    }
  }

  return null
}

/** Resolve um no `{op:'source', name}` para uma Table. E o unico ponto que
 *  toca disco -- chamado so quando o no e EXECUTADO, nunca na criacao dele. */
export function resolveSource(node, opts = {}) {
  if (!node || node.op !== 'source') throw new Error('resolveSource: no invalido')
  const { dir, backings } = opts
  if (backings && backings[node.name]) return backings[node.name]()
  const make = resolveByFile(dir, node.name)
  if (!make) return null
  return make()
}

/** `catalog(dir)` devolve um objeto cujo acesso a QUALQUER propriedade
 *  produz um no `{op:'source', name}`, sem tocar o disco -- e resolvido
 *  preguicosamente por quem executa a query, nao por quem escreve `db.x`.
 *
 *  Identidade estavel: `db.users === db.users` (mesmo objeto no dentro da
 *  mesma sessao), para que uma query que referencia a mesma fonte duas
 *  vezes (self-join, subquery) nao crie dois nos diferentes. */
export function catalog(dir, opts = {}) {
  const nodeCache = new Map()

  function nodeFor(name) {
    if (!nodeCache.has(name)) {
      nodeCache.set(name, Object.freeze({ op: 'source', name }))
    }
    return nodeCache.get(name)
  }

  return new Proxy({}, {
    get(_t, k) {
      if (typeof k === 'symbol') return undefined
      return nodeFor(k)
    },
    has() { return true }
  })
}

/** Executa um no do catalogo (ou qualquer no `{op:'source'}`) contra um
 *  diretorio, com cache de RESULTADO (nao so de no) para que resolver duas
 *  vezes o mesmo nome nao abra o arquivo duas vezes na mesma sessao. */
export function catalogExecutor(dir, opts = {}) {
  const tableCache = new Map()
  return {
    resolve(node) {
      if (!tableCache.has(node.name)) {
        tableCache.set(node.name, resolveSource(node, { dir, backings: opts.backings }))
      }
      return tableCache.get(node.name)
    }
  }
}
