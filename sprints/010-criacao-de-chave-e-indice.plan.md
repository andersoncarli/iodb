# 010 — Plano: criacao de chave e indice

Plano do sprint 010 (feature 1.5). Requisitos e criterio: `sprint fronts 1.5`.

Em uma linha: o `.index` deixa de ser write-only e vira a **fonte de verdade da
alocacao de nomes** — quem escolhe a chave curta consulta um mapa de ocupacao
persistido, nao um `prefixSet` que so existe na memoria de quem chamou.

## O reescopo

O titulo antigo ("prefixo curto colide entre processos") nomeava o **sintoma**. A
causa e mais funda: nao havia onde a alocacao de nomes viver fora do processo, e
por isso cada escritor reconstruia o `prefixSet` relendo o log — para responder
uma pergunta que o arquivo ao lado ja sabia. A feature passa a cobrir o mecanismo
inteiro: como o nome curto e alocado, o que persiste a alocacao, e como ela se
reconstroi.

## Entregue nesta rodada (nucleo, passos 1-5 do desenho)

1. **Lock por arquivo** — `acquireLock(base, 'dash'|'index'|'yaml')`, PID no NOME,
   mutex por **scan + recheck com desempate por PID**. Dois processos mutando
   arquivos DIFERENTES da mesma entity nao se bloqueiam; a ordem fixa
   `.dash` → `.index` → `.yaml` evita ciclo. `src/adapters/io-append.js`.

   *Medido:* 8 processos × 40 secoes, 5 rodadas — **0 overlaps em 1600 secoes**.
   O primeiro desenho (ceder so a um PID menor) dava 9 overlaps em 240: a
   assimetria era o defeito, e o teste de sobreposicao foi o que mostrou.

2. **`src/index-bitmap.js`** — o alocador, sozinho num modulo. Bitmap por nivel
   (`2^L` posicoes), `count`/`closed` por nivel, `allocKey`, `lookup` em dois
   modos, serialize/deserialize. Substitui `shortestPrefix(fullKey, prefixSet)`.

   *Medido:* 3000 alocacoes com payloads repetidos — **0 divergencias** contra o
   `shortestPrefix` legado. E drop-in.

3. **`.index` v2** — header versionado (`_v`, `_format`), `lastOffset`,
   `syncedAt`, e uma linha por nivel. `_format` desconhecido = reconstroi do
   `.dash`, nunca adivinha.

4. **`open()` le o indice** — `loadIndex()` popula os bitmaps do `.index` em vez
   de reconstrui-los do log. Indice ausente/corrompido/de formato velho cai no
   rebuild, que e o que se pagava sempre antes.

5. **`publishDerived` sob o lock do proprio arquivo** — o `read-compare-write`
   nao e atomico, entao o arbitro de offset sozinho nao bastava: dois escritores
   liam o mesmo offset, ambos se aprovavam, e o conteudo mais VELHO podia vencer
   o rename por chegar depois. O lock do arquivo fecha essa janela sem bloquear
   append nenhum. `.index` e `.yaml` publicam pelo mesmo caminho agora.

### Criterio (a) — atingido

3 processos × 25 escritas, **20/20 rodadas limpas**: 77 registros, 77 chaves
distintas, `verify().valid === true`.

### Recuperacao de crash — verificada

- SIGKILL no meio da escrita → `open()` recupera todos os registros, cadeia
  valida, escrita nova por cima funciona.
- `.index` rebobinado para um estado ANTIGO → recupera igual (o `syncFrom`
  re-afirma os bits que faltavam; `bmAdd` e idempotente).
- Lock de holder morto → varrido no primeiro acquire contendido. Um cadaver nao
  trava escritor nenhum.

### Carga dos testes

Todas as suites de concorrencia caem para **3 processos** (eram 8). Uma corrida
precisa de contencao, nao de multidao: 3 escritores disputam cada append tanto
quanto 8. Suite inteira caiu de 20s para 11s, 64 testes, 258 asserts, verde.
A diferenca de 268→258 asserts e so laco dimensionado por `PROCS`, confirmada
revertendo so o contador — mesmos 64 testes, mesmos 16 arquivos.

## Fica para a proxima rodada (passos 6-11 do desenho)

6. `io.in(payload, { of })` e a formula `sha64(patch) XOR sha64(targetKey)` nas
   duas engines. **Toca a interface publica** — por isso ficou fora deste corte.
7. `appendGuarded` re-`allocKey` incondicional pos-`syncFrom` do delta.
8. Remover o `syncFrom` incondicional do io-engine (era compensacao pelo indice
   morto; o indice e fonte agora).
9. nutshell ganha `.index` → triade nas duas engines.
10. `verify()` no dominio novo (recupera prefixo de `sha64(target)`, nao o id).
11. Testes de triade: `.index` e `.yaml` divergentes em ts → `open()` alinha.

## Criterio de pronto

O declarado na feature. Verify: `utest .`
