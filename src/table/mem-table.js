import { cursorFromArray } from './cursor.js'

// Tabela de memoria: a implementacao de referencia de nivel 0 ({schema, scan}).
// Deliberadamente burra -- so um array e um indice de posicao por cursor -- porque
// e o piso contra o qual todo backend esperto e comparado (TABLE.md secao 17).
export function memTable(rows, schema) {
  // Copia congelada na criacao: mutar o array de entrada depois nao pode vazar
  // para dentro da tabela (pureza de observacao, TABLE.md secao 14).
  const snapshot = Object.freeze(rows.map(r => Object.freeze({ ...r })))

  return {
    schema,
    scan() {
      return cursorFromArray(snapshot)
    }
  }
}
