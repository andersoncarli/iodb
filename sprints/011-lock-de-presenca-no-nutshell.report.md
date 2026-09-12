---
sprint: 11
date: 2026-09-09
features: [3.3]
thread: null
---
# 011 — lock-de-presenca-no-nutshell

Intro: o lock de presenca (feature 4.3) agora e opt-in no nutshell via
`IO(name, { lock: true })`, passando pela mesma secao critica do io-engine
(`io-append.js`); as duas engines foram comparadas sob a mesma carga com o
tempo NO LOCK medido pelo mesmo ponto, e a interface do nutshell convergiu
com a do io-engine no que nao toca os call sites (`open`/`close`/`header`/
`state`/`find`).

## Objetivo

Pedido do usuario (2026-09-09): *"aplicar o mesmo mecanismo de lock em nutshell
e comparar as performances e diferencas entre as engines."* Depois, no curso do
sprint: *"aproximar as interfaces aproveitando as melhores ideias de cada lado"*
e *"deixar claro os tempos do lock em ambos os casos"*.

## O que entrou

### 1. Lock portado (ja estava no codigo, validado aqui)

`io-nutshell.js` ja importava `io-append.js` e ja tinha o ramo `lock: true`
chamando `appendGuarded`. `ensureLock` ja era chamado UMA vez na construcao
(nao em `flush()`), com a guarda de `existsSync` removida — sob ausencia = livre
ele e no-op. Este sprint fechou a metade que faltava: os testes e a comparacao.

- `io-nutshell.concurrency.test.js`: novo caso "3.3 — 8 concurrent writers,
  { lock: true }: no loss, no crash, no lock timeout". O criterio textual da
  feature (240/240, 0 crashes, 0 timeouts sob 8 processos) roda como teste.
- Contrato preservado: `lock = false` continua o default, a doc segue dizendo
  "No locks. No WAL. No fsync." O teste caracterizador da 3.2 (modo sem lock)
  segue valendo e É a guarda de regressao desse modo.

### 2. Comparacao entre engines, com o tempo NO LOCK medido igual nas duas

- `io-append.js`: hook `onPhase(name, ns)` opcional em `appendGuarded` — zero
  custo sem callback. Dispara `'lockWait'` (ns girando no spin ate pegar o lock)
  e `'critical'` (ns com o lock efetivamente seguro). O nutshell o repassa; o
  io-engine ganhou marcas hrtime `t._lockWaitNs` / `t._criticalNs` ao lado das
  marcas `Date.now()` que `io-engine.bench.js` ja consumia (esse bench ficou
  intacto).
- `bench/compare-3.3.js`: reescrito. 3 workers quentes, cada um martelando SO a
  sua chave (chave = PID) — sem colisao de prefixo entre workers, o que isola o
  custo do PROTOCOLO do defeito de prefixo curto (feature 1.5). Warm-up fora da
  medicao, janela cronometrada, duas tabelas: custo por `io.in()` e tempo NO
  LOCK.
- `bench/resultado-3.3.txt`: a tabela + a explicacao das divergencias, ao lado
  dos baselines `baseline-2.1.txt` / `resultado-2.2.txt`.

**Achado.** O nutshell PEGA o lock ~3x mais rapido (lockWait p50 ~150us vs
~310us) e o SEGURA 3x menos no p50 (~370us vs ~1100us) — a secao critica dele e
so `stat + append`, enquanto o io-engine faz `computeKeys` + o reduce da
projecao sob o lock. MAS a cauda de `critical` do nutshell explode (p99 ~65ms
vs ~10ms): o `onResync` do nutshell rele o log INTEIRO sob o lock, e sob 3
workers resync e o caso comum. Vazao agregada: empate. O nutshell e mais leve
por PUBLICAR MENOS, nao por travar melhor — e a prova e a cauda, onde o lock
aparece e o nutshell fica atras.

### 3. Convergencia de interface (lado do nutshell, sem tocar call sites)

A assimetria real entre as engines nao e a API — e que o io-engine ADIA a
projecao YAML (publica 1 a cada 100 flushes, `stringify` O(n) caro) e por isso
exige `close()`; o nutshell publica JSON a cada flush e nao tem o que fechar.

`io-nutshell.js` (+40 linhas):
- `open(initPayload)` — opcional. Semeia o registro `#0` com payload do chamador
  (a unica coisa que o `open` do io-engine fazia que o nutshell nao); senao
  no-op. Retorna `this`.
- `close()` — no-op, retorna `this`.
- `header()` / `state()` — registros `#0` / `#1`, lidos direto do log (o genesis
  e mantido fora do `hashMap` de proposito).
- `find(pred)` — `records()` sem genesis, payloads filtrados.
- `writeGenesis` passou a aceitar `initPayload` opcional.

Resultado: `in`/`out`/`get`/`flush`/`verify`/`size`/`open`/`close`/`header`/
`state`/`find` significam o mesmo nas duas engines. Codigo escrito-para-io-engine
(`io.open()` ... `io.close()`) roda sobre o nutshell sem branch.

`io-nutshell.t.js` (+3 testes): "open/close are optional no-ops",
"open(payload) seeds record #0", "header / state / find match io-engine's
readers". `io-nutshell.md`: subsecao "Interop with io-engine" em The Interface —
uma tabela, nao uma reescrita.

## Nota — hogs e a fronteira com o sprint 009

Ao rodar a suite inteira, `io-engine.matrix.test.js` aparece com 🐢35 e 6 falhas
`check(r.valid, true)`, e `io-engine.concurrency.test.js` com +1. **Nada disso e
regressao deste sprint** — confirmado com `git stash`: as mesmas 6 falhas
existem no HEAD. Sao o defeito de prefixo curto (feature 1.5) e a matriz que o
cita (feature 1.4 / sprint 009). O hog dessa matriz — 8 processos por celula,
`bun` spawn a cada um — e trabalho do sprint 009, nao deste.

O que ESTE sprint corrigiu de hog foi proprio: o primeiro rascunho tinha um
teste "{ lock: false } is unchanged" que refazia `run(8, 30)` unlocked —
identico ao teste "3.2 — 8 concurrent writers" que ja existe. Alem de +8 spawns
(~3s), rodando em paralelo com os outros dois casos de 8 processos ele
produzia um `✘` intermitente por contencao (24 processos disputando o mesmo
disco). Removido: `io-nutshell.concurrency.test.js` caiu de ~7s (flaky) para
~1-2s (13 checks estaveis). O teste 3.2 JA e a guarda do modo sem lock.

## Escopo

`src/adapters/io-append.js` e `src/io-engine.js` foram adicionados ao `files:`
da feature 3.3 (agora reivindicados por 3.3 E 5.1) — as mudancas neles sao o
hook de timing e as marcas hrtime, inertes fora do bench, e existem so para a
comparacao que a feature pede. `sprint files --drift` limpo.

A convergencia COMPLETA de assinatura (`IO(name, {path})` unificada, genesis
lazy no io-engine, `close()` genuinamente opcional, reescrita dos 5 call sites
`io-engine.test.js` / `.concurrency` / `.matrix` / `.bench.js` / `db-factory.js`)
NAO entrou: toca arquivos da feature 5.1, dois deles travados pelos sprints 009
(1.4) e 010 (1.5) ainda abertos. Fica para um sprint proprio, planejado em
seguida rumo ao v0.1.

## Verify

  sprint test 3.3                         → 13 + 32 ✓
  sprint eval 3.3 --yes                   → 33 passos ✓  (🟢)
  utest src/io-engine.test.js --force   → 55 ✓  (sem regressao)
  bun src/io-engine.bench.js              → roda; marcas ms intactas
