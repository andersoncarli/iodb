import IO, { merge, append, assign } from './io-engine.js'
import { readTrailer, readGenesis } from '../pagedtext/pagedtext.js'
import { statSync, readFileSync, copyFileSync } from 'fs'
import { join } from 'path'

const PS = 4096
// Pagina pequena: o que estes testes precisam e ATRAVESSAR PAGINAS, e pagina e
// uma razao entre bytes e pageSize. Encolhendo a pagina, dezenas de registros
// fazem o que antes exigia centenas — e a escrita por registro (sem batching,
// com fsync de verdade) continua sendo o caminho exercitado, que e o que a 2.0
// comprou. O teste fica em milissegundos em vez de segundos.
//
// 512 e nao 256, e a razao e um BUG ENCONTRADO ao encolher, nao uma escolha de
// gosto: o guarda de replay do io-engine.js:273 e
// `statSync(f.proj).size > 4096` — um literal, e nao o pageSize do store. Com
// pagina menor que 4096, uma projecao de VARIAS paginas ainda mede menos que
// 4096 bytes, o guarda a le como vazia, o replay do log roda por cima do que ja
// estava la e TODO registro duplica (medido: 40 escritas -> 80 registros, em
// 2048/1024/512/256/128; so 4096 escapa, porque ai tudo cabe numa pagina).
// Esta registrado em PROJ-REPLAY-ISSUE.md.
//
// A consequencia para ESTE arquivo: enquanto o guarda for um literal 4096, os
// testes que passam pelo io-engine NAO PODEM encolher a pagina — qualquer
// valor menor cai no defeito, e o que eles mediriam seria o bug e nao a
// propriedade. Entao aqui a pagina continua 4096 e o que encolhe e a CONTAGEM,
// ate o minimo que ainda atravessa pagina. Os testes do pagedtext e da
// projecao tabular, que nao passam pelo engine, usam pagina pequena de fato.
const PS_MINI = 4096

// O `{ timeout: 5000 }` SAIU. Ele era o contorno de uma contagem alta: com
// centenas de registros e um commit real por registro, o teste nao cabia no
// default de 1000ms, e a saida tinha sido levantar o teto.
//
// Levantar o teto esconde o problema em vez de resolve-lo — e um teto de 5s num
// teste que afirma correcao, nao desempenho, e um teste que ninguem percebe
// ficar lento. A contagem desceu para o minimo que ainda exibe a propriedade
// (80 registros onde o invariante e multi-pagina, 40 onde e so atravessar), e o
// arquivo inteiro voltou a caber em ~1s — o orcamento de UM teste.
//
// O teto acompanha trabalho real, nao mascara crescimento. O custo por registro
// e PLANO — 100 registros: 1.10ms/rec, 200: 1.00, 400: 0.96 — que e exatamente a
// propriedade O(paginas sujas): o custo de uma escrita nao cresce com o tamanho
// do store. Se ele voltar a crescer, o teto estoura e o teste acusa.
//
// O preco disso e que este arquivo saiu de ~1s para ~8s. E deliberado: o caminho
// que o engine usa de verdade e uma escrita por registro, e era ele que ficava
// sem cobertura enquanto os testes batchavam para contornar a reescrita total.

test('io-engine paged: kv round-trips like the plain path', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: assign, initial: {}, pageSize: 4096 })
    io.open()
    io.in({ host: 'localhost' })
    io.in({ port: 8080 })
    io.in({ port: 9090 })          // overwrite
    io.close()

    const re = IO(base, { reduce: assign, initial: {}, pageSize: 4096 })
    re.open()
    const s = re.get('#1')
    check(s.host, 'localhost')
    check(s.port, 9090)
    check('host' in s, true)
  })
})

test('io-engine paged: matches the plain path key-for-key', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const runs = {}
    const N = 40
    for (const [label, pageSize] of [['plain', 0], ['paged', PS_MINI]]) {
      const base = join(dir, label)
      const io = IO(base, { reduce: merge, initial: {}, pageSize })
      io.open()
      // NOT batched. Before feature 2.0 the paged flush was a full-file
      // rewrite, so one flush per record was O(n^2) and these tests had to
      // batch around it. The commit is now O(dirty pages), so the per-record
      // path is the one worth exercising.
      for (let i = 0; i < N; i++) io.in({ ['k' + String(i).padStart(3, '0')]: i * 2 }, { flush: 0 })
      io.flush()
      io.in({ k020: null })          // tombstone
      io.close()

      const re = IO(base, { reduce: merge, initial: {}, pageSize })
      re.open()
      const st = re.get('#1')
      runs[label] = Object.fromEntries(
        Object.keys(st).filter(k => k.startsWith('k')).sort().map(k => [k, st[k]])
      )
    }
    check(JSON.stringify(runs.paged), JSON.stringify(runs.plain))
    check('k020' in runs.paged, false)         // tombstone survived
    check(runs.paged.k000, 0)
    const ultima = 'k' + String(N - 1).padStart(3, '0')
    check(runs.paged[ultima], (N - 1) * 2)
  })
})

test('io-engine paged: append preserves order and application semantics', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'log')
    const N = 40
    const io = IO(base, { reduce: append, initial: [], pageSize: PS_MINI })
    io.open()
    for (let i = 0; i < N; i++) io.in({ seq: i }, { flush: 0 })
    io.flush()
    io.close()

    const re = IO(base, { reduce: append, initial: [], pageSize: PS_MINI })
    re.open()
    const s = re.get('#1')
    // append stores each record as { <key>: payload }; genesis contributes
    // #0/#1, then N { seq: i } payloads under allocated keys.
    const seqs = [...s]
      .map(x => Object.values(x)[0])
      .filter(v => v && typeof v === 'object' && 'seq' in v)
      .map(v => v.seq)
    check(seqs.length, N)
    check(seqs[0], 0)
    check(seqs[N - 1], N - 1)
    check(seqs.every((v, i) => v === i), true)   // application order preserved
  })
})

test('io-engine paged: .proj file is 4096-aligned', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: merge, initial: {}, pageSize: PS_MINI })
    io.open()
    // 80 e o MINIMO que produz duas paginas com estes registros (medido: 60 da
    // uma, 80 da duas). O teste afirma multi-pagina, entao 80 e o menor numero
    // que ainda o afirma — eram 400.
    // Append BUFFERIZADO (`flush:0` + um `flush()` no fim): o que este teste
    // afirma e o LAYOUT do arquivo depois do close, nao o flush-por-registro.
    // Medido: 869ms -> 73ms, mesmas 9 paginas, mesmo alinhamento.
    for (let i = 0; i < 80; i++) io.in({ ['key' + String(i).padStart(4, '0')]: { n: i, pad: 'x'.repeat(30) } }, { flush: 0 })
    io.flush()
    io.close()

    const size = statSync(base + '.proj').size
    check(size % PS_MINI === 0, true)
    const header = readGenesis(base + '.proj')
    check(header.magic, 'PAGEDTEXT')
    // O header e genesis; a contagem de paginas esta no rodape.
    check(readTrailer(base + '.proj').pages.length > 1, true)   // genuinely multi-page
  })
})

test('io-engine paged: .yaml still readable and correct', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    io.open()
    io.in({ alpha: 1, beta: 2 })
    io.close()

    const yaml = readFileSync(base + '.yaml', 'utf8')
    check(yaml.includes('alpha: 1'), true)
    check(yaml.includes('beta: 2'), true)
  })
})

test('io-engine paged: verify() chain stays valid', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    io.open()
    for (let i = 0; i < 50; i++) io.in({ ['x' + i]: i }, { flush: 0 })
    io.flush()
    io.close()

    const re = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    re.open()
    check(re.verify().valid, true)
  })
})

// O `.yaml` deixou de ser reescrito a cada 100 flushes (feature 2.5) e passou a
// ser derivado SOB DEMANDA. A razao e medida: `stringify` da projecao e O(n) e
// rodava periodicamente para produzir um arquivo que NINGUEM le de volta — nao
// ha um so `readFileSync(f.yaml)` no src/. Custo O(n) recorrente por um artefato
// de leitura humana que talvez ninguem abra.
//
// O arquivo existe desde a genese do store, entao o teste nao pergunta "existe?"
// e sim "acompanha?": depois de escritas SUFICIENTES ele continua no tamanho da
// genese, e so cresce quando alguem pede.
//
// "Suficientes" aqui tem um piso real, e por isso este e o unico numero que nao
// desceu ao minimo trivial: o comportamento antigo reescrevia o yaml a cada 100
// flushes, entao o teste precisa PASSAR de 100 para que "nao cresceu sozinho"
// afirme alguma coisa. 120 cruza o limiar com folga; 250 so pagava mais caro
// pela mesma prova.
test('io-engine paged: o .yaml e derivado sob demanda, nao a cada 100 flushes', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const base = join(dir, 'store')
    const io = IO(base, { reduce: assign, initial: {}, pageSize: PS })
    io.open()
    for (let i = 0; i < 120; i++) io.in({ [`k${i}`]: { v: i } }, { flush: 0 })
    io.flush()

    const y = base + '.yaml'
    const parado = statSync(y).size
    check(parado < 200, true)          // ainda no tamanho da genese

    io.yaml()                          // quem quer olhar, pede
    const pedido = statSync(y).size
    check(pedido > parado, true)
    check(pedido > 1000, true)         // a projecao inteira, agora sim

    io.close()
    check(statSync(y).size >= pedido, true)   // o close mantem em dia
  })
})

// ── feature 4.5 — o .proj sabe ATE ONDE do log ele chegou ──────────────────
//
// O guarda de replay era `statSync(f.proj).size > 4096`: um literal, e nao o
// pageSize do store. Com pagina menor, uma projecao de varias paginas ainda
// mede menos que 4096 bytes, o guarda a lia como VAZIA, o log inteiro era
// reaplicado por cima do que ja estava la e todo registro DUPLICAVA.
//
// Estes dois testes cobrem os dois lados do mesmo guarda, e por isso usam
// pagina pequena de proposito: e exatamente a faixa que nenhum teste visitava.

test('io-engine paged: reabrir com pagina pequena nao duplica a projecao', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    const N = 40
    for (const pageSize of [256, 1024, 4096]) {
      const base = join(dir, 'log' + pageSize)
      const io = IO(base, { reduce: append, initial: [], pageSize })
      io.open()
      for (let i = 0; i < N; i++) io.in({ seq: i }, { flush: 0 })
      io.flush()
      io.close()

      const re = IO(base, { reduce: append, initial: [], pageSize })
      re.open()
      const seqs = [...re.get('#1')]
        .map(x => Object.values(x)[0])
        .filter(v => v && typeof v === 'object' && 'seq' in v)
        .map(v => v.seq)
      check(seqs.length, N)
      check(new Set(seqs).size, N)              // sao duplicatas, nao registros a mais
      check(seqs.every((v, i) => v === i), true)
    }
  })
})

test('io-engine paged: um .proj ATRASADO recupera o delta em vez de perde-lo', async ({ check, withTempDir }) => {
  await withTempDir(dir => {
    // Pagina de 4096: e o tamanho em que o guarda ANTIGO de fato pulava o
    // replay (a projecao passa dos 4096 bytes e ele a via como "em dia"). Com
    // pagina pequena o guarda antigo erraria para o outro lado e reaplicaria
    // tudo, o que daria a resposta certa por acidente e o teste nao
    // discriminaria nada.
    const base = join(dir, 'stale')
    const io = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    io.open()
    // 80 chaves com padding: o bastante para a projecao passar de 4096 bytes,
    // que e o limiar do guarda antigo.
    const pad = 'x'.repeat(40)
    for (let i = 0; i < 80; i++) io.in({ ['k' + String(i).padStart(3, '0')]: { v: i, pad } }, { flush: 0 })
    io.flush()
    io.close()
    // Guarda a projecao deste momento: ela cobre as 80 primeiras chaves.
    copyFileSync(base + '.proj', base + '.proj.velho')

    const io2 = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    io2.open()
    for (let i = 80; i < 100; i++) io2.in({ ['k' + String(i).padStart(3, '0')]: { v: i, pad } }, { flush: 0 })
    io2.flush()
    io2.close()

    // Devolve a projecao velha: agora ela esta atrasada em relacao ao log.
    copyFileSync(base + '.proj.velho', base + '.proj')

    // O guarda antigo pulava o replay inteiro quando o .proj "tinha conteudo",
    // e as 10 chaves que faltavam sumiam em silencio — o gap que o proprio
    // comentario do codigo declarava e nao fechava.
    const re = IO(base, { reduce: merge, initial: {}, pageSize: 4096 })
    re.open()
    const ks = Object.keys(re.get('#1')).filter(k => k.startsWith('k'))
    check(ks.length, 100)
    check(new Set(ks).size, 100)
  })
})
