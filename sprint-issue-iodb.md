# Dois defeitos encontrados usando o `sprint` no iodb

Relato de campo, sprint 008 (feature 2.3). Ferramenta `sprint` v0.18.0,
projeto `/home/bittnkr/iodb`, 2026-09-09.

O primeiro é um erro meu que a ferramenta poderia ter impedido. O segundo é um
defeito de configuração do projeto, pré-existente e nunca reportado.

---

## 1. Report sem frontmatter deixa o sprint órfão de feature, em silêncio

### Sintoma

Com o sprint 008 aberto, todo arquivo consultado aparece FORA do escopo —
inclusive `io-engine.js`, que é o arquivo central do próprio sprint:

```
$ sprint files --drift io-engine.js
Sprint(s) aberto(s): 008 [] lockfile-dedicado-absorve-genesis-atomico
  FORA    io-engine.js  (feature 1.2, 2.1, 2.2, 2.3, 2.4, 2.5)

1 arquivo(s) FORA do escopo do sprint aberto — isto e deriva.
```

Repare no `008 []`. O colchete de feature está vazio. A ferramenta sabe que
`io-engine.js` pertence à 2.3 (está no parêntese à direita) e sabe que o sprint
aberto é o 008, mas não liga um ao outro.

A consequência prática: o `--drift` vira ruído. Ele grita deriva sobre o arquivo
que o sprint inteiro existe para modificar, então o sinal que deveria distinguir
escopo de scope creep para de distinguir qualquer coisa.

### Causa

O vínculo sprint → feature vem do **frontmatter YAML do report**, não do plano.

O report do 007, que funciona:

```yaml
---
sprint: 7
date: 2026-09-08
features: [2.2]
thread: null
---
```

O report do 008, escrito por mim, começa direto no markdown:

```markdown
# 008 — Report: lockfile-dedicado-absorve-genesis-atomico

Feature 2.3. O mutex saiu de dentro do dado...
```

A feature está lá, em prosa, na primeira linha do corpo. Só não está no campo
que a ferramenta lê.

Confirmado pelo outro lado: `sprint fronts 2.2` lista o 007 sob 📜 Sprints;
`sprint fronts 2.3` lista `(nenhum ainda)`, com o sprint 008 no disco e concluído.

### Hipótese que testei e descartei

Achei primeiro que a causa fosse o cabeçalho em prosa do plano, porque o 006 e o
007 usam `Plano do sprint NNN (feature N.F).` e o 008 usava
`Sprint 008, feature 2.3 — ...`. Editei para o formato dos anteriores e rodei o
`--drift` de novo: **sem efeito**, `008 []` continuou vazio. Revertí a edição. O
formato do plano não participa do vínculo.

### O que sugiro

O modo de falhar é silencioso, e é isso que o torna caro. Um report sem
frontmatter é indistinguível de um report bem-formado até alguém reparar num
colchete vazio no meio de outra saída.

1. **`sprint close` deve recusar** um report sem `features:` no frontmatter, ou
   ao menos avisar alto. O `close` commita por escopo de feature; sem feature,
   ele não tem escopo, e commitar nada silenciosamente é pior que parar.
2. **`sprint files --drift` deve tratar `NNN []` como erro de estado**, não como
   um resultado normal. Hoje ele reporta deriva com convicção sobre uma
   comparação que não tinha como dar certo.
3. **O `sprint new` poderia semear o report** com o frontmatter já preenchido,
   do mesmo jeito que semeia o plano. O agente escreve o corpo; o campo estrutural
   não deveria depender de o autor ter visto um report anterior.

Se houver documentação do formato do report, ela não apareceu no `sprint boot`
nem no `.sprint/BOOT.md` — o que fiz foi copiar a forma do 007 depois de já ter
errado.

---

## 2. `.sprint/config.json` tem o caminho do test errado

### Sintoma

```
$ sprint test
error: Module not found "utest/utest.js"
```

### Causa

Falta um `../`. O `utest` é peer do projeto, não filho dele:

```
.sprint/config.json:9:  "test": "bun utest/utest.js ."
package.json:8:        "test": "bun ../utest/utest.js ."
```

O `package.json` do próprio projeto está certo. Só o `config.json` do sprint
diverge.

### Impacto

`sprint test` nunca roda neste projeto. Como ele é quem move a feature para
🟡 testada, o degrau depende de um comando quebrado. Durante os sprints 007 e 008
contornei invocando `bun ../utest/utest.js .` na mão, o que funciona mas deixa a
verificação fora do ledger.

### Correção

Uma linha, em `.sprint/config.json`:

```json
"test": "bun ../utest/utest.js ."
```

Não apliquei porque está fora do escopo do sprint 008, e a regra do projeto é
reportar em vez de consertar. É sua decisão.

Vale considerar se o `sprint doctor` deveria checar que o comando de `test`
resolve, já que um `test` que não executa se parece muito com um `test` que
nunca foi rodado.

---

## Estado atual

O documento arquitetural do sprint 008 está em `docs/WRITE-LOCK.md`. A feature
2.3 está 🔵 confirmada. O report do 008 continua sem frontmatter — não o editei,
porque quem decide se isso entra neste sprint ou vira correção à parte é você.
