/**
 * SQL parser — sequential productions over match / next / consume.
 *
 * match(literal | productionName | fn) → value | null
 * expect(x) → match(x) or throw
 * kw(word)  → case-insensitive keyword (whole word)
 *
 * Output: algebra plan nodes (parser only recognizes + delegates).
 */

export const createParser = (algebra) => {
  const {
    is, source, filter, project, sort, limit, offset, distinct,
    join, group, aggregate, union, withCte,
    insert, update, remove, createTableStmt,
  } = algebra

  const parse = (input) => {
    const buffer = String(input)
    let pos = 0

    // ----- primitives -----
    const eof = () => pos >= buffer.length
    const next = (n = 1) => buffer.slice(pos, pos + n)
    const consume = (n = 1) => {
      const s = buffer.slice(pos, pos + n)
      pos += n
      return s
    }
    const mark = () => pos
    const reset = (p) => { pos = p }

    const error = (msg) => {
      const near = buffer.slice(Math.max(0, pos - 10), pos + 20)
      return new Error(`SQL parse error at ${pos}: ${msg} (near "${near}")`)
    }

    /** match string literal, production name, or function */
    const match = (target) => {
      if (typeof target === 'function') return target()
      if (typeof target === 'string' && prods[target]) return prods[target]()
      const n = target.length
      if (next(n) === target) return consume(n)
      return null
    }

    const kw = (word) => {
      const n = word.length
      if (next(n).toUpperCase() !== word.toUpperCase()) return null
      const after = buffer[pos + n]
      if (after && /[A-Za-z0-9_]/.test(after)) return null
      return consume(n)
    }

    const expect = (target) => {
      // ALLCAPS string → keyword
      const r = typeof target === 'string' && /^[A-Z_]+$/.test(target)
        ? kw(target)
        : match(target)
      if (r == null) throw error(`expected ${target}`)
      return r
    }

    const skipWs = () => {
      while (!eof()) {
        const c = next()
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') consume(1)
        else if (next(2) === '--') {
          consume(2)
          while (!eof() && next() !== '\n') consume(1)
        } else break
      }
    }

    // ----- productions registry -----
    const prods = {}

    // --- lex ---
    prods.number = () => {
      const m = mark()
      let s = ''
      if (next() === '+' || next() === '-') s += consume(1)
      if (!/[0-9.]/.test(next())) { reset(m); return null }
      while (/[0-9]/.test(next())) s += consume(1)
      if (next() === '.') {
        s += consume(1)
        while (/[0-9]/.test(next())) s += consume(1)
      }
      if (!s || s === '+' || s === '-' || s === '.') { reset(m); return null }
      return is.lit(Number(s))
    }

    prods.string = () => {
      const q = next()
      if (q !== "'" && q !== '"') return null
      consume(1)
      let s = ''
      while (!eof()) {
        if (next() === q) {
          if (next(2) === q + q) { consume(2); s += q; continue }
          consume(1)
          return is.lit(s)
        }
        if (next() === '\\') { consume(1); s += consume(1); continue }
        s += consume(1)
      }
      throw error('unterminated string')
    }

    prods.ident = () => {
      if (!/[A-Za-z_]/.test(next())) return null
      let s = consume(1)
      while (/[A-Za-z0-9_]/.test(next())) s += consume(1)
      return s
    }

    prods.nullLit = () => (kw('NULL') ? is.lit(null) : null)

    // --- expr layers ---
    prods.primary = () => {
      skipWs()
      // CASE WHEN ... THEN ... ELSE ... END
      if (kw('CASE')) {
        skipWs()
        const branches = []
        while (kw('WHEN')) {
          skipWs()
          const when = match('expr')
          if (when == null) throw error('expected WHEN expr')
          skipWs()
          if (!kw('THEN')) throw error('expected THEN')
          skipWs()
          const then = match('expr')
          if (then == null) throw error('expected THEN expr')
          branches.push({ when, then })
          skipWs()
        }
        let elseVal = is.lit(null)
        if (kw('ELSE')) {
          skipWs()
          elseVal = match('expr')
          if (elseVal == null) throw error('expected ELSE expr')
          skipWs()
        }
        if (!kw('END')) throw error('expected END')
        return is.case(branches, elseVal)
      }
      // EXISTS ( select ) — NOT EXISTS via unary NOT
      if (kw('EXISTS')) {
        skipWs()
        expect('(')
        skipWs()
        const sub = match('select')
        if (sub == null) throw error('expected subquery in EXISTS')
        skipWs()
        expect(')')
        return is.exists(sub)
      }
      // ( expr ) or ( select ) — subquery as scalar not yet; only grouping
      if (match('(')) {
        skipWs()
        const inner = match('expr')
        if (inner == null) throw error('expected expression')
        skipWs()
        expect(')')
        return inner
      }

      const n = match('number')
      if (n) return n
      const s = match('string')
      if (s) return s
      const nu = match('nullLit')
      if (nu) return nu

      const id = match('ident')
      if (id) {
        skipWs()
        // function call
        if (match('(')) {
          skipWs()
          const args = []
          if (match('*')) {
            args.push({ op: 'star' })
            skipWs()
            expect(')')
          } else if (!match(')')) {
            do {
              skipWs()
              const a = match('expr')
              if (a == null) throw error('expected arg')
              args.push(a)
              skipWs()
            } while (match(','))
            skipWs()
            expect(')')
          }
          const fn = id.toLowerCase()
          if (fn === 'upper') return is.upper(args[0])
          if (fn === 'lower') return is.lower(args[0])
          if (fn === 'length') return is.length(args[0])
          if (fn === 'abs') return is.abs(args[0])
          if (fn === 'coalesce') return is.coalesce(...args)
          // count/sum/avg/min/max and unknown fns
          return { op: fn, args }
        }
        // qualified name: table.col
        skipWs()
        if (match('.')) {
          skipWs()
          const col = match('ident')
          if (!col) throw error('expected column after .')
          return is.field(id + '.' + col)
        }
        return is.field(id)
      }
      return null
    }

    prods.unary = () => {
      skipWs()
      if (kw('NOT')) {
        skipWs()
        const e = match('unary')
        if (e == null) throw error('expected expression after NOT')
        return is.not(e)
      }
      if (match('-')) {
        skipWs()
        const e = match('unary')
        if (e == null) throw error('expected expression after -')
        return is.sub(is.lit(0), e)
      }
      return match('primary')
    }

    prods.mulDiv = () => {
      skipWs()
      let left = match('unary')
      if (left == null) return null
      for (;;) {
        skipWs()
        const m = mark()
        if (match('*')) {
          skipWs()
          const r = match('unary')
          if (r == null) { reset(m); break }
          left = is.mul(left, r)
        } else if (match('/')) {
          skipWs()
          const r = match('unary')
          if (r == null) { reset(m); break }
          left = is.div(left, r)
        } else break
      }
      return left
    }

    prods.addSub = () => {
      skipWs()
      let left = match('mulDiv')
      if (left == null) return null
      for (;;) {
        skipWs()
        const m = mark()
        if (match('+')) {
          skipWs()
          const r = match('mulDiv')
          if (r == null) { reset(m); break }
          left = is.add(left, r)
        } else if (match('-')) {
          skipWs()
          const r = match('mulDiv')
          if (r == null) { reset(m); break }
          left = is.sub(left, r)
        } else break
      }
      return left
    }

    prods.cmp = () => {
      skipWs()
      let left = match('addSub')
      if (left == null) return null
      skipWs()

      if (kw('IS')) {
        skipWs()
        const not = !!kw('NOT')
        skipWs()
        if (!kw('NULL')) throw error('expected NULL after IS')
        return not ? is.isNotNull(left) : is.isNull(left)
      }

      // NOT IN / NOT LIKE / NOT BETWEEN
      if (kw('NOT')) {
        skipWs()
        if (kw('IN')) {
          skipWs()
          expect('(')
          skipWs()
          const m = mark()
          if (kw('SELECT')) {
            reset(m)
            const sub = match('select')
            if (sub == null) throw error('expected subquery')
            skipWs()
            expect(')')
            return is.not(is.in(left, sub))
          }
          reset(m)
          const list = []
          if (!match(')')) {
            do {
              skipWs()
              const v = match('expr')
              if (v == null) throw error('expected value in NOT IN')
              list.push(v.op === 'lit' ? v.args[0] : v)
              skipWs()
            } while (match(','))
            skipWs()
            expect(')')
          }
          return is.not(is.in(left, is.lit(list)))
        }
        if (kw('LIKE')) {
          skipWs()
          const pat = match('addSub')
          if (pat == null) throw error('expected LIKE pattern')
          return is.not(is.like(left, pat))
        }
        if (kw('BETWEEN')) {
          skipWs()
          const lo = match('addSub')
          skipWs()
          if (!kw('AND')) throw error('expected AND')
          skipWs()
          const hi = match('addSub')
          return is.not(is.between(left, lo, hi))
        }
        throw error('expected IN, LIKE, or BETWEEN after NOT')
      }

      if (kw('BETWEEN')) {
        skipWs()
        const lo = match('addSub')
        skipWs()
        if (!kw('AND')) throw error('expected AND in BETWEEN')
        skipWs()
        const hi = match('addSub')
        if (lo == null || hi == null) throw error('BETWEEN needs bounds')
        return is.between(left, lo, hi)
      }

      if (kw('IN')) {
        skipWs()
        expect('(')
        skipWs()
        // subquery?
        const m = mark()
        if (kw('SELECT')) {
          reset(m)
          const sub = match('select')
          if (sub == null) throw error('expected subquery')
          skipWs()
          expect(')')
          return is.in(left, sub)
        }
        reset(m)
        const list = []
        if (!match(')')) {
          do {
            skipWs()
            const v = match('expr')
            if (v == null) throw error('expected value in IN')
            list.push(v.op === 'lit' ? v.args[0] : v)
            skipWs()
          } while (match(','))
          skipWs()
          expect(')')
        }
        return is.in(left, is.lit(list))
      }

      // LIKE
      if (kw('LIKE')) {
        skipWs()
        const pat = match('addSub')
        if (pat == null) throw error('expected LIKE pattern')
        return is.like(left, pat)
      }

      // comparison ops (longest first), peek via match
      const m = mark()
      let opTok = null
      for (const op of ['>=', '<=', '<>', '!=', '=', '>', '<']) {
        if (match(op)) { opTok = op; break }
      }
      if (opTok) {
        skipWs()
        const right = match('addSub')
        if (right == null) { reset(m); return left }
        const map = {
          '=': 'eq', '!=': 'ne', '<>': 'ne',
          '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte',
        }
        return is[map[opTok]](left, right)
      }
      return left
    }

    prods.andExpr = () => {
      skipWs()
      let left = match('cmp')
      if (left == null) return null
      for (;;) {
        skipWs()
        if (!kw('AND')) break
        skipWs()
        const r = match('cmp')
        if (r == null) throw error('expected expression after AND')
        left = is.and(left, r)
      }
      return left
    }

    prods.orExpr = () => {
      skipWs()
      let left = match('andExpr')
      if (left == null) return null
      for (;;) {
        skipWs()
        if (!kw('OR')) break
        skipWs()
        const r = match('andExpr')
        if (r == null) throw error('expected expression after OR')
        left = is.or(left, r)
      }
      return left
    }

    prods.expr = () => match('orExpr')

    // --- SELECT ---
    const RESERVED = new Set([
      'FROM', 'WHERE', 'ORDER', 'LIMIT', 'OFFSET', 'GROUP', 'HAVING',
      'AND', 'OR', 'AS', 'BY', 'SELECT', 'DISTINCT', 'ASC', 'DESC',
      'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'ON', 'OUTER',
      'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
      'UNION', 'ALL', 'WITH', 'EXISTS', 'LIKE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
      'IN', 'NOT', 'IS', 'NULL', 'BETWEEN',
    ])

    const AGG_FNS = new Set(['count', 'sum', 'avg', 'min', 'max'])

    /** Detect aggregate call node { op: 'count'|'sum'|..., args } */
    const isAggNode = (e) => e && AGG_FNS.has(String(e.op || '').toLowerCase())

    const walkAggs = (node, out = []) => {
      if (!node || typeof node !== 'object') return out
      if (isAggNode(node)) { out.push(node); return out }
      if (node.op === 'alias') return walkAggs(node.args[0], out)
      if (Array.isArray(node.args)) node.args.forEach((a) => walkAggs(a, out))
      return out
    }

    prods.selectList = () => {
      skipWs()
      if (match('*')) return null // all columns
      const cols = []
      do {
        skipWs()
        const e = match('expr')
        if (e == null) throw error('expected column')
        skipWs()
        let alias = null
        if (kw('AS')) {
          skipWs()
          alias = match('ident')
          if (!alias) throw error('expected alias')
        } else {
          const m = mark()
          const maybe = match('ident')
          if (maybe && !RESERVED.has(maybe.toUpperCase())) alias = maybe
          else reset(m)
        }
        if (alias) cols.push({ op: 'alias', args: [e, alias] })
        else cols.push(e)
        skipWs()
      } while (match(','))
      return cols
    }

    prods.tableRef = () => {
      skipWs()
      const name = match('ident')
      if (!name) return null
      skipWs()
      let as = null
      if (kw('AS')) {
        skipWs()
        as = match('ident')
      } else {
        const m = mark()
        const maybe = match('ident')
        if (maybe && !RESERVED.has(maybe.toUpperCase())) as = maybe
        else reset(m)
      }
      const node = source(name)
      if (as) node.as = as
      return node
    }

    prods.fromClause = () => {
      skipWs()
      if (!kw('FROM')) return null
      skipWs()
      let plan = match('tableRef')
      if (plan == null) throw error('expected table')

      for (;;) {
        skipWs()
        let type = null
        if (kw('CROSS')) {
          skipWs()
          if (!kw('JOIN')) throw error('expected JOIN after CROSS')
          type = 'cross'
        } else if (kw('LEFT')) {
          skipWs()
          kw('OUTER')
          skipWs()
          if (!kw('JOIN')) throw error('expected JOIN')
          type = 'left'
        } else if (kw('INNER')) {
          skipWs()
          if (!kw('JOIN')) throw error('expected JOIN')
          type = 'inner'
        } else if (kw('JOIN')) {
          type = 'inner'
        } else break

        skipWs()
        const right = match('tableRef')
        if (right == null) throw error('expected table after JOIN')
        let on = null
        if (type !== 'cross') {
          skipWs()
          if (kw('ON')) {
            skipWs()
            on = match('expr')
            if (on == null) throw error('expected ON expression')
          }
        }
        plan = join(plan, right, { type, on })
      }
      return plan
    }

    prods.orderBy = () => {
      skipWs()
      if (!kw('ORDER')) return null
      skipWs()
      if (!kw('BY')) throw error('expected BY')
      const keys = []
      do {
        skipWs()
        const e = match('expr')
        if (e == null) throw error('expected ORDER BY expr')
        skipWs()
        let dir = 'asc'
        if (kw('DESC')) dir = 'desc'
        else kw('ASC')
        keys.push({ expr: e, dir })
        skipWs()
      } while (match(','))
      return keys
    }

    /** Convert select-list agg expression into aggregate() arg */
    const toAggArg = (col) => {
      let expr = col
      let as = null
      if (col.op === 'alias') {
        expr = col.args[0]
        as = col.args[1]
      }
      const fn = String(expr.op).toLowerCase()
      const arg0 = expr.args && expr.args[0]
      const star = !arg0 || arg0 === '*' || (arg0.op === 'field' && arg0.args[0] === '*') || arg0.op === 'star'
      return {
        fn,
        ...(star || fn === 'count' && !arg0 ? { star: true } : arg0 ? { expr: arg0 } : {}),
        as: as || fn,
      }
    }


    const rewriteAggsToFields = (node) => {
      if (!node || typeof node !== 'object') return node
      if (isAggNode(node)) {
        const fn = String(node.op).toLowerCase()
        return is.field(fn)
      }
      if (node.op === 'alias') {
        return rewriteAggsToFields(node.args[0])
      }
      if (Array.isArray(node.args)) {
        return { ...node, args: node.args.map(rewriteAggsToFields) }
      }
      return node
    }

    prods.select = () => {
      skipWs()
      if (!kw('SELECT')) return null

      skipWs()
      const distinctFlag = !!kw('DISTINCT')
      skipWs()
      const cols = match('selectList')

      const fromPlan = match('fromClause')
      if (fromPlan == null) throw error('expected FROM')
      let plan = fromPlan

      skipWs()
      if (kw('WHERE')) {
        skipWs()
        const pred = match('expr')
        if (pred == null) throw error('expected WHERE expression')
        plan = filter(plan, pred)
      }

      // GROUP BY
      let groupKeys = null
      skipWs()
      if (kw('GROUP')) {
        skipWs()
        if (!kw('BY')) throw error('expected BY')
        groupKeys = []
        do {
          skipWs()
          const e = match('expr')
          if (e == null) throw error('expected GROUP BY expr')
          groupKeys.push(e)
          skipWs()
        } while (match(','))
      }

      // HAVING
      let having = null
      skipWs()
      if (kw('HAVING')) {
        skipWs()
        having = match('expr')
        if (having == null) throw error('expected HAVING expression')
      }

      // Aggregates in select list?
      const aggCols = []
      const nonAggCols = []
      if (cols) {
        for (const c of cols) {
          const found = walkAggs(c)
          if (found.length) aggCols.push(c)
          else nonAggCols.push(c)
        }
      }

      const needsAgg = (groupKeys && groupKeys.length) || aggCols.length > 0

      if (needsAgg) {
        if (groupKeys && groupKeys.length) plan = group(plan, groupKeys)
        const aggArgs = aggCols.map(toAggArg)
        // If GROUP BY but only key columns in SELECT, still need aggregate pass for structure
        if (aggArgs.length) plan = aggregate(plan, aggArgs)
        else if (groupKeys && groupKeys.length) {
          // group-only: materialize keys (aggregate with empty aggs keeps key cols)
          plan = aggregate(plan, [])
        }
        if (having) plan = filter(plan, rewriteAggsToFields(having))
        // project final shape: keys + agg aliases + non-agg
        if (cols) {
          // rewrite agg function nodes to field refs of their alias for final project
          const projCols = cols.map((c) => {
            if (c.op === 'alias' && isAggNode(c.args[0])) {
              return is.field(c.args[1])
            }
            if (isAggNode(c)) {
              const fn = String(c.op).toLowerCase()
              return is.field(fn)
            }
            return c
          })
          plan = project(plan, projCols)
        }
      } else {
        if (cols) plan = project(plan, cols)
      }

      if (distinctFlag) plan = distinct(plan)

      const orderKeys = match('orderBy')
      if (orderKeys) plan = sort(plan, orderKeys)

      skipWs()
      if (kw('LIMIT')) {
        skipWs()
        const n = match('number')
        if (n == null) throw error('expected LIMIT n')
        skipWs()
        if (kw('OFFSET')) {
          skipWs()
          const o = match('number')
          if (o == null) throw error('expected OFFSET n')
          plan = offset(plan, o.args[0])
        }
        plan = limit(plan, n.args[0])
      } else if (kw('OFFSET')) {
        skipWs()
        const o = match('number')
        if (o == null) throw error('expected OFFSET n')
        plan = offset(plan, o.args[0])
      }

      return plan
    }

    prods.withClause = () => {
      skipWs()
      if (!kw('WITH')) return null
      const ctes = []
      do {
        skipWs()
        const name = match('ident')
        if (!name) throw error('expected CTE name')
        skipWs()
        if (!kw('AS')) throw error('expected AS')
        skipWs()
        expect('(')
        skipWs()
        const rel = match('select')
        if (rel == null) throw error('expected CTE select')
        skipWs()
        expect(')')
        ctes.push({ name, rel })
        skipWs()
      } while (match(','))
      return ctes
    }

    prods.selectOrUnion = () => {
      let plan = match('select')
      if (plan == null) return null
      for (;;) {
        skipWs()
        if (!kw('UNION')) break
        skipWs()
        const all = !!kw('ALL')
        skipWs()
        const right = match('select')
        if (right == null) throw error('expected SELECT after UNION')
        plan = union(plan, right, all)
      }
      return plan
    }

    prods.insert = () => {
      skipWs()
      if (!kw('INSERT')) return null
      skipWs()
      if (!kw('INTO')) throw error('expected INTO')
      skipWs()
      const name = match('ident')
      if (!name) throw error('expected table')
      skipWs()
      let cols = null
      if (match('(')) {
        cols = []
        do {
          skipWs()
          const c = match('ident')
          if (!c) throw error('expected column')
          cols.push(c)
          skipWs()
        } while (match(','))
        skipWs()
        expect(')')
        skipWs()
      }
      if (!kw('VALUES')) throw error('expected VALUES')
      const rows = []
      do {
        skipWs()
        expect('(')
        const vals = []
        do {
          skipWs()
          const v = match('expr')
          if (v == null) throw error('expected value')
          vals.push(v)
          skipWs()
        } while (match(','))
        skipWs()
        expect(')')
        const row = {}
        if (cols) cols.forEach((c, i) => { row[c] = vals[i] })
        else vals.forEach((v, i) => { row['c' + i] = v })
        rows.push(row)
        skipWs()
      } while (match(','))
      return insert(name, rows)
    }

    prods.updateStmt = () => {
      skipWs()
      if (!kw('UPDATE')) return null
      skipWs()
      const name = match('ident')
      if (!name) throw error('expected table')
      skipWs()
      if (!kw('SET')) throw error('expected SET')
      const setMap = {}
      do {
        skipWs()
        const col = match('ident')
        if (!col) throw error('expected column')
        skipWs()
        expect('=')
        skipWs()
        const v = match('expr')
        if (v == null) throw error('expected value')
        setMap[col] = v
        skipWs()
      } while (match(','))
      let where = null
      skipWs()
      if (kw('WHERE')) {
        skipWs()
        where = match('expr')
      }
      return update(name, setMap, where)
    }

    prods.deleteStmt = () => {
      skipWs()
      if (!kw('DELETE')) return null
      skipWs()
      if (!kw('FROM')) throw error('expected FROM')
      skipWs()
      const name = match('ident')
      if (!name) throw error('expected table')
      let where = null
      skipWs()
      if (kw('WHERE')) {
        skipWs()
        where = match('expr')
      }
      return remove(name, where)
    }

    prods.createTable = () => {
      skipWs()
      if (!kw('CREATE')) return null
      skipWs()
      if (!kw('TABLE')) {
        return null
      }
      skipWs()
      const name = match('ident')
      if (!name) throw error('expected table name')
      skipWs()
      expect('(')
      const schema = {}
      do {
        skipWs()
        const col = match('ident')
        if (!col) throw error('expected column')
        skipWs()
        let typ = 'any'
        const m = mark()
        const t = match('ident')
        if (t && !['PRIMARY', 'UNIQUE', 'NOT', 'NULL', 'DEFAULT', 'KEY', 'AUTOINCREMENT'].includes(t.toUpperCase())) {
          typ = t.toLowerCase()
        } else reset(m)
        const parts = [col, typ]
        skipWs()
        if (kw('PRIMARY')) { skipWs(); kw('KEY'); parts.push('pk') }
        if (kw('UNIQUE')) parts.push('unique')
        if (kw('NOT')) { skipWs(); if (kw('NULL')) { /* not null default */ } }
        else if (kw('NULL')) parts.push('null')
        skipWs()
        let def = ''
        if (kw('DEFAULT')) {
          skipWs()
          const d = match('expr')
          if (d && d.op === 'lit') def = d.args[0]
        }
        schema[parts.join(' ')] = def
        skipWs()
      } while (match(','))
      skipWs()
      expect(')')
      return createTableStmt(name, schema)
    }

    prods.statement = () => {
      skipWs()
      const m = mark()
      let node = match('insert') || match('updateStmt') || match('deleteStmt')
      if (node) return node
      // CREATE TABLE — createTable returns null if not CREATE TABLE
      node = match('createTable')
      if (node) return node
      reset(m)
      const ctes = match('withClause')
      const main = match('selectOrUnion')
      if (main == null) return null
      if (ctes) return withCte(ctes, main)
      return main
    }

    // ----- entry -----
    skipWs()
    const plan = match('statement')
    if (plan == null) throw error('expected statement')
    skipWs()
    match(';')
    skipWs()
    if (!eof()) throw error('unexpected trailing input')
    return plan
  }

  return { parse }
}
