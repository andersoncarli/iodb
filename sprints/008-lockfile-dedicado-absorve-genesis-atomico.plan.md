# 008 — Plano: lockfile-dedicado-absorve-genesis-atomico

Sprint 008, feature 4.3 — Lockfile dedicado: desacoplar mutex de dado.

## Objetivo

Hoje `f.yaml` é simultaneamente a **projeção** (dado) e o **mutex** (controle).
`acquireLock` renomeia `f.yaml -> f.yaml.<PID>`, então enquanto alguém escreve a
projeção **não existe**. Toda a complexidade residual da engine sai dessa janela:

- `publishYaml()` (io-engine.js:243) precisa **readquirir o lock** só para o rename
  final, porque escrever `f.yaml` livremente forjaria um segundo mutex;
- `open()` (io-engine.js:424-455) carrega uma dança de recuperação de ~30 linhas para
  o caso "f.yaml sumiu porque alguém segura o lock";
- o genesis usa `openSync(f.yaml,'wx')` como mutex-de-uma-vez (io-engine.js:411),
  misturando o nascimento do dado com o nascimento do controle;
- `lockTimeout` (io-engine.js:48) cresce com o tamanho de `f.yaml` — compensação para
  um trabalho O(n) que a 4.2 já tirou de dentro da seção crítica.

Este sprint dá ao mutex **arquivo próprio de 0 bytes** (`f.lock`), criado exatamente
uma vez, e rebaixa `f.yaml` a artefato derivado como o `.index`.

## Decisão de escopo registrada

O requisito da 4.3 manda "decidir se absorve a 1.4 (genesis atômico + .tmp por PID)".
**A 1.4 não existe como feature** — `sprint fronts 1` lista só 1.1, 1.2 e 1.3, todas
🔵. A referência é resíduo de um plano antigo. Logo não há absorção a negociar: o
genesis atômico entra aqui como parte natural do desenho, porque é o mesmo arquivo.

## Passos

1. **io-engine.js — `f.lock` na família.** Adicionar `lock:` ao objeto `f`, irmão de
   `dash`/`yaml`/`index`, derivado do mesmo base com sufixo `.lock`.

2. **io-engine.js — adotar io-append.js.** Substituir o `acquireLock`/`lockTimeout`
   locais (io-engine.js:48-77) pelos exportados de `io-append.js`, agora apontando
   para `f.lock`. Some a duplicação de protocolo entre os dois arquivos.

3. **io-engine.js — `open()` cria o lock uma vez.** `ensureLock(f.lock)` no início de
   `open()`, com a semântica `wx` de io-append.js. O vencedor do `wx` **não** é mais
   quem escreve o genesis: o genesis passa a acontecer sob o lock normal, o que
   elimina o caso especial. Remover o ramo de restauração de `f.yaml` inteiro — com
   mutex próprio, `f.yaml` nunca mais some, então não há o que restaurar.

4. **io-engine.js — `publishYaml()` sem lock.** Vira uma chamada a `publishDerived`
   de io-append.js, arbitrada por offset como o `.index` já é. Some a reaquisição.

5. **io-engine.js — `lockTimeout` constante.** Volta a 1000ms fixo, **justificado**
   pelo p99 medido em 4.1/4.2 (seção crítica O(1)), não escolhido a dedo.

6. **io-engine.js — `.tmp` por PID.** Os fixos restantes (`f.yaml + '.tmp'` em
   `writeGenesis` e `flushYaml`) recebem sufixo de PID.

7. **plans/2-pages/4.3.eval.js** — o roteiro de avaliação executável.

## Critério de pronto

O critério declarado na feature: **distribuição de `bad` em N>=20 rodadas da célula
no-seed = 0**. Em `io-engine.matrix.test.js:169` o `check(bad <= TRIALS/4)` vira
`check(bad, 0)`.

Verify: `node --test io-engine.matrix.test.js` e `sprint eval 4.3 --yes`.

## Emenda no meio do sprint — polaridade (pedido do usuario)

Os passos 1-7 acima separam o mutex do dado mas MANTEM a polaridade antiga: o
arquivo EXISTE = livre, renomeado = detido. O usuario perguntou se a ausencia
podia ser o indicador de livre. Pode, e vale mais que a separacao sozinha:

- **acquire** = `writeFileSync('f.lock.<pid>', '', {flag:'wx'})` — um syscall
  atomico, o kernel decide a corrida.
- **release** = `unlinkSync` do proprio arquivo.
- **livre** = nao ha `f.lock.*` nenhum.

O ganho: some o NASCIMENTO do mutex. Com "existe = livre" alguem tem que criar o
arquivo uma vez e exatamente uma vez, e e ali que a exclusao mutua morre em
silencio (a armadilha do 007). Com ausencia = livre, um diretorio novo ja esta
no estado correto — `ensureLock` vira no-op e a classe de bug deixa de ser
escrivel.

O custo, e como fica pago: a recuperacao de crash precisa identificar o holder.
O PID vai no **NOME** do arquivo, nao no conteudo, para que a identificacao
chegue junto com a criacao no mesmo syscall atomico. Com o PID no conteudo
haveria janela entre criar e preencher, na qual a varredura acha arquivo vazio e
nao distingue recem-nascido de corrompido — roubando lock vivo ou travando.
