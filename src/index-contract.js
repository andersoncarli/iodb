/**
 * O contrato de indice — a forma que qualquer implementacao (text-pages, sqlite,
 * uma B-tree futura) tem que satisfazer para o io-engine.js falar com ela sem
 * conhecer o algoritmo por baixo.
 *
 * factory(file, opts) => {
 *   open(),
 *   close(),
 *   get(key)      => offset | undefined,
 *   put(key, offset),
 *   del(key),
 *   range(lo, hi) => Iterable<[key, offset]>,   // ordenado por chave
 *   rebuild(fromOffset, records),               // reconstroi a partir do .dash
 * }
 *
 * Nao ha classe base aqui de proposito — o contrato e estrutural (duck typing),
 * o mesmo estilo que o resto do iodb usa para adapters. `assertIndexShape` existe
 * so para os testes provarem que uma implementacao nao esqueceu um metodo.
 */

export const INDEX_METHODS = ['open', 'close', 'get', 'put', 'del', 'range', 'rebuild']

export function assertIndexShape(impl) {
  for (const m of INDEX_METHODS) {
    if (typeof impl[m] !== 'function') {
      throw new Error(`[index-contract] implementacao nao tem o metodo obrigatorio: ${m}`)
    }
  }
  return true
}
