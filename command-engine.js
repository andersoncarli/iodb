/**
 * io/command.js — Modular tool/command registry for HELIX.
 *
 * Re-aligned to use a single "MGF" input node.
 */

import { readdirSync, existsSync } from 'fs'
import { join } from 'path'

class CommandRegistry {
  constructor() {
    this.registry = new Map()
    this.aliases = new Map()
  }

  register(name, fn, meta = {}, renderFn = null, file = null) {
    this.registry.set(name, { fn, meta, render: renderFn, file })
    if (meta.aliases) {
      for (const alias of meta.aliases) this.aliases.set(alias, name)
    }
  }

  async validate(file) {
    const { resolve } = await import('path')
    const { readFileSync, existsSync } = await import('fs')
    const abs = resolve(file)
    const name = abs.split('/').pop().split('.')[0]
    const mod = await import(abs)
    const fn = mod.default || mod[name] || mod.run
    if (!fn) return null

    const metaFile = abs.replace(/\.js$/, '.meta')
    const helpFile = abs.replace(/\.js$/, '.help')
    const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : (fn._meta || mod.meta || fn.meta || {})

    let help = {}
    if (existsSync(helpFile)) {
      const helpContent = readFileSync(helpFile, 'utf8')
      const sections = helpContent.split(/^##\s+/m).filter(Boolean)
      for (const s of sections) {
        const lines = s.split('\n')
        const title = lines.shift().trim()
        help[title] = lines.join('\n').trim()
      }
    }

    return { name, fn, meta, help, run: fn }
  }

  use(mw) {
    this.middleware = this.middleware || []
    this.middleware.push(mw)
  }

  resolve(name) {
    if (!name) return null
    if (this.registry.has(name)) return name
    return this.aliases.get(name) || null
  }

  async load(cmdDir) {
    if (typeof cmdDir === 'object' && cmdDir.path) cmdDir = cmdDir.path
    if (!existsSync(cmdDir)) return
    if (globalThis._debugBus) console.log(`[command] Scanning ${cmdDir}`)
    const { resolve } = await import('path')
    const { readdirSync } = await import('fs')
    const entries = readdirSync(cmdDir, { withFileTypes: true }).filter(e => e.isDirectory() || (e.isFile() && e.name.endsWith('.js')))

    for (const ent of entries) {
      const name = ent.name.split('.')[0]
      const file = ent.isDirectory() ? join(cmdDir, name, `${name}.js`) : join(cmdDir, ent.name)
      if (!existsSync(file)) continue

      try {
        if (globalThis._debugBus) console.log(`[command] Importing ${name} from ${file}`)
        const start = performance.now()
        const mod = await import(resolve(file))
        const elapsed = Math.round(performance.now() - start)
        if (globalThis._debugBus && elapsed > 50) console.error(`[command:timing] ${name} import ${elapsed}ms`)
        const fn = mod.default || mod[name] || mod.run
        if (fn) {
          const meta = fn._meta || mod.meta || fn.meta || {}
          const renderFn = fn.render || mod.render || null
          this.register(name, fn, meta, renderFn, resolve(file))
        }
      } catch {
        // Silently skip if it doesn't match the new pattern
      }
    }
  }

  async loadConstructors() {
    try {
      const { resolve } = await import('path')
      const skillsPath = resolve(join(import.meta.dirname, '../../kvchat/src/skills.ts'))
      if (!existsSync(skillsPath)) return

      const { loadAdapters } = await import(skillsPath)
      const adapters = loadAdapters()

      for (const [key, def] of Object.entries(adapters)) {
        // Register constructor as a command with 'kv:' prefix or direct if non-colliding
        const name = key.includes(':') ? key : `kv:${key}`
        this.register(name, def.handler, { description: def.spec, help: def.fullSpec })
      }
    } catch (e) {
      console.error(`[command] Failed to load constructors: ${e.message}`)
    }
  }

  async run(name, ...rawArgs) {
    const VERBS = ['list', 'ls', 'show', 'add', 'help', 'note', 'done', 'stats', 'summary']

    // 1. Internal Resolve for the primary term
    let resolved = this.resolve(name)
    let cmd = this.registry.get(resolved)

    const firstArg = (typeof rawArgs[0] === 'string') ? rawArgs[0].split(/\s+/)[0] : (rawArgs[0]?.args?.[0]);
    const firstArgResolved = this.resolve(firstArg);

    // 2. Subject-Verb Symmetry (Isomorphism)
    if (resolved && VERBS.includes(resolved) && firstArgResolved && !VERBS.includes(firstArgResolved)) {
      if (this.registry.has(firstArgResolved)) {
        const newName = firstArgResolved;
        const newArgs = (typeof rawArgs[0] === 'string')
          ? [resolved, ...rawArgs[0].split(/\s+/).slice(1)].join(' ')
          : { ...rawArgs[0], args: [resolved, ...rawArgs[0].args.slice(1)] };
        return this.run(newName, newArgs, ...rawArgs.slice(1));
      }
    }

    // 3. Fallback Symmetry
    if (!cmd && firstArgResolved && this.registry.has(firstArgResolved)) {
      const newName = firstArgResolved;
      const newArgs = (typeof rawArgs[0] === 'string')
        ? [name, ...rawArgs[0].split(/\s+/).slice(1)].join(' ')
        : { ...rawArgs[0], args: [name, ...rawArgs[0].args.slice(1)] };
      return this.run(newName, newArgs, ...rawArgs.slice(1));
    }

    if (!cmd) return { type: 'error', message: `unknown tool ${name}` }

    const argsObj = (rawArgs.length === 1 && typeof rawArgs[0] === 'object' && !Array.isArray(rawArgs[0])) ? rawArgs[0] : { args: rawArgs };
    const ctx = {
      name: resolved,
      commands: this,
      args: argsObj.args,
      media: argsObj.media || 'text',
      ...argsObj,
      result: null,
      output: null
    }

    const execute = async () => {
      try {
        const finalArgs = Array.isArray(ctx.args) ? ctx.args : [ctx.args]

        // Helix Unitary Dispatcher: Detect if it's a KV handler or a CLI command
        // KV Handlers: (key, value, kv_fn)
        // CLI Commands: (args, ctx)
        let res
        if (name.startsWith('kv:') || name.includes(':')) {
           // Bridge: CLI -> KV signature
           // (key, value, kv_fn)
           const kv_fn = async (k, v) => (await this.run(k, v)).result
           res = await cmd.fn(name.replace(/^kv:/, ''), finalArgs[0], kv_fn)
        } else {
           res = await cmd.fn(...finalArgs, ctx)
        }

        ctx.result = res
        ctx.output = res
        if (cmd.render && res && typeof res === 'object' && !Array.isArray(res)) res._render = cmd.render
      } catch (err) {
        ctx.error = err.message
        ctx.result = { type: 'error', message: `tool ${resolved} failed: ${err.message}` }
      }
    }

    const chain = [...(this.middleware || []), execute]
    let idx = 0
    const next = async () => {
      if (idx < chain.length) {
        const fn = chain[idx++]
        if (fn === execute) await execute()
        else await fn(ctx, next)
      }
    }

    await next()
    return ctx
  }
}

export const commands = new CommandRegistry()
export { CommandRegistry as Commands }
