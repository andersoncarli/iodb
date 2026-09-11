// O cursor e um protocolo, nao uma classe: next() -> Row|null, close() opcional,
// e iteravel via Symbol.iterator para `for (const r of table.scan())`.

export function cursorFromArray(rows) {
  let i = 0
  return {
    next() {
      return i < rows.length ? rows[i++] : null
    },
    close() {
      i = rows.length
    },
    [Symbol.iterator]() {
      return {
        next: () => {
          const v = this.next()
          return v === null ? { done: true, value: undefined } : { done: false, value: v }
        }
      }
    }
  }
}

export function filterCursor(cursor, pred) {
  return {
    next() {
      let v
      while ((v = cursor.next()) !== null) {
        if (pred(v)) return v
      }
      return null
    },
    close() {
      cursor.close?.()
    },
    [Symbol.iterator]() {
      return {
        next: () => {
          const v = this.next()
          return v === null ? { done: true, value: undefined } : { done: false, value: v }
        }
      }
    }
  }
}

export function limitCursor(cursor, n) {
  let count = 0
  return {
    next() {
      if (count >= n) return null
      const v = cursor.next()
      if (v === null) return null
      count++
      return v
    },
    close() {
      cursor.close?.()
    },
    [Symbol.iterator]() {
      return {
        next: () => {
          const v = this.next()
          return v === null ? { done: true, value: undefined } : { done: false, value: v }
        }
      }
    }
  }
}

export function mapCursor(cursor, fn) {
  return {
    next() {
      const v = cursor.next()
      return v === null ? null : fn(v)
    },
    close() {
      cursor.close?.()
    },
    [Symbol.iterator]() {
      return {
        next: () => {
          const v = this.next()
          return v === null ? { done: true, value: undefined } : { done: false, value: v }
        }
      }
    }
  }
}

export function firstOf(cursor) {
  const v = cursor.next()
  cursor.close?.()
  return v
}

export function countOf(cursor) {
  let n = 0
  while (cursor.next() !== null) n++
  cursor.close?.()
  return n
}

export function toArray(cursor) {
  const out = []
  let v
  while ((v = cursor.next()) !== null) out.push(v)
  cursor.close?.()
  return out
}
