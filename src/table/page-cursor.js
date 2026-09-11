/**
 * page-cursor.js — feature 8.3
 *
 * A unidade e a LINHA, o custo e a PAGINA. pageCursor(store, from) cede linhas
 * uma a uma; internamente avanca de pagina em pagina consumindo
 * `store.readPage(i)`/`store.pageCount()` — o material bruto que a 2.2 ja
 * deixou pronto. O consumidor nunca ve pagina; o medidor so ve pagina.
 *
 * Reentrancia por CONSTRUCAO: cada chamada a pageCursor() fecha seu proprio
 * `{pageIndex, lineIndex}` em closure, entao dois cursores sobre o mesmo
 * store sao independentes por definicao, nao por disciplina do chamador.
 *
 * `readPage` e opcional e sobrescreve o leitor de pagina (default
 * `store.readPage`) — a 8.4 usa isso para ceder ROWS DECODIFICADAS (via
 * `TabularProjection._pageRows`, que ja pula schema e enchimento) em vez de
 * linhas cruas, sem duplicar a logica de avanco-por-pagina.
 */

export function pageCursor(store, from = 0, readPage = (i) => store.readPage(i)) {
  let pageIndex = 0
  let lineIndex = 0
  let globalIndex = 0
  let currentPage = null
  let done = false

  // pagesRead cresce so quando uma pagina NOVA e aberta — a prova de que a
  // preguica e real, e nao um numero de decoracao.
  let pagesRead = 0

  // O cursor nunca segura mais de uma pagina decodificada viva: currentPage e
  // trocado, nunca acumulado. livePages e 0 ou 1 o tempo todo, nunca mais.
  let livePages = 0

  function loadPage(i) {
    if (i >= store.pageCount()) { currentPage = null; livePages = 0; return }
    currentPage = readPage(i)
    livePages = currentPage ? 1 : 0
    pagesRead++
  }

  // Pula direto para a pagina que contem `from`, sem decodificar as
  // anteriores — `from` e um indice GLOBAL de linha, nao de pagina.
  function seek(target) {
    let skipped = 0
    let p = 0
    // pageCount() e por pagina, nao por linha; sem um indice linha->pagina
    // dedicado, o seek teria que abrir paginas para contar linhas. Como as
    // paginas da 2.2 nao carregam contagem de linha fora da propria pagina,
    // o seek avanca pagina a pagina mas SO decodifica a que efetivamente
    // contem o alvo — as anteriores sao contadas, nao lidas, quando o layout
    // permite (sequential: uma pagina por indice, sem contagem previa
    // disponivel sem leitura). Para nao mentir sobre custo, o seek le cada
    // pagina que teria que pular tambem — e conta como pagesRead, porque
    // FOI aberta. limit()+range() cuidam do caso comum (from=0) em O(1).
    while (p < store.pageCount()) {
      const lines = readPage(p)
      pagesRead++
      const n = lines ? lines.length : 0
      if (skipped + n > target) {
        currentPage = lines
        livePages = lines ? 1 : 0
        pageIndex = p
        lineIndex = target - skipped
        globalIndex = target
        return
      }
      skipped += n
      p++
    }
    currentPage = null
    livePages = 0
    done = true
  }

  let started = false
  if (from > 0) { seek(from); started = true }

  function advancePage() {
    pageIndex++
    lineIndex = 0
    loadPage(pageIndex)
  }

  const cursor = {
    get pagesRead() { return pagesRead },
    get livePages() { return livePages },

    next() {
      if (done) return null
      if (!started) { started = true; loadPage(0) }
      while (currentPage !== null) {
        if (lineIndex < currentPage.length) {
          const line = currentPage[lineIndex]
          lineIndex++
          globalIndex++
          return line
        }
        advancePage()
      }
      done = true
      return null
    },

    close() {
      done = true
      currentPage = null
      livePages = 0
    },

    [Symbol.iterator]() {
      return {
        next: () => {
          const v = cursor.next()
          return v === null ? { done: true, value: undefined } : { done: false, value: v }
        }
      }
    }
  }

  return cursor
}
