/**
 * io/adapters/transition.js — The TRANSITION bus as addressable nodes
 *
 * node('//transition')           → the full bus
 * node('//transition/io:write')  → a specific event channel
 *
 * Each channel has the Collection interface:
 *   channel.in(payload)   → TRANSITION(event, payload)
 *   channel.out(handler)  → ON(event, handler)
 *   channel.get()         → last payload received on this event
 */

export function TransitionBus(TRANSITION_fn, ON_fn) {
  const channels = new Map()

  function channel(event) {
    if (!channels.has(event)) {
      let last = null
      ON_fn(event, (t) => { last = t })

      const ch = {
        in:  (payload)  => TRANSITION_fn(event, payload),
        out: (handler)  => ON_fn(event, handler),
        get: (key)      => key ? last?.[key] : last,
        open: ()        => ch,
        header: ()      => ({ _entity: event, _type: 'transition', _created: 0 }),
        state:  ()      => last,
        records: ()     => [],
        verify:  ()     => ({ valid: true, length: 0 }),
        get size()      { return last ? 1 : 0 },
      }

      // Proxy: ch.payload → ch.get('payload')
      channels.set(event, new Proxy(ch, {
        get(t, k) { if (typeof k === 'symbol' || k in t) return t[k]; return t.get(String(k)) },
      }))
    }
    return channels.get(event)
  }

  // The bus root — get(event) returns its channel
  const bus = {
    open: () => bus,
    get(key) {
      if (!key || key === '#1') return null
      return channel(key)
    },
    in(payload) {
      if (payload?.event) TRANSITION_fn(payload.event, payload)
    },
    out(handler) { return ON_fn('*', handler) },
    header:  () => ({ _entity: 'transition', _type: 'bus', _created: 0 }),
    state:   () => Object.fromEntries(channels),
    records: () => [],
    verify:  () => ({ valid: true, length: 0 }),
    get size() { return channels.size },
  }

  return new Proxy(bus, {
    get(t, k) {
      if (typeof k === 'symbol' || k in t) return t[k]
      // bus['io:write'] → channel('io:write')
      return channel(String(k))
    },
  })
}
