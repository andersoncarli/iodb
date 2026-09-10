# utest — dois caminhos posicionais: o segundo some em silêncio

Encontrado em `~/iodb`, sprint 016 (feature 2.1). Bun 1.3.x, runner `../utest/utest.js`.

---

## Sintoma

Passar mais de um caminho executa só o **primeiro**. O segundo não roda, não vira filtro,
não gera aviso e não muda o exit code. O relatório sai verde e completo — só que sobre
metade do que foi pedido.

```
cd ~/iodb
bun ../utest/utest.js src pagedtext --force   # 📄16 🧪73 ✔310   (pagedtext.t.js NÃO rodou)
bun ../utest/utest.js pagedtext src --force   # 📄 1 🧪20 ✔ 71   (src NÃO rodou)
bun ../utest/utest.js pagedtext --force       # 📄 1 🧪20 ✔ 71
bun ../utest/utest.js src --force             # 📄16 🧪73 ✔310
```

A soma das duas rodadas isoladas é 17 arquivos; nenhuma das duas combinadas chega lá. A
ordem decide quem sobrevive, o que confirma que não é filtro de interseção — é descarte.

## Diagnóstico

Em `utest.js`, duas linhas que isoladamente fazem sentido e juntas abrem o buraco:

- **`:275`** — `let rawTarget = positional.find(a => fs.existsSync(a))`
  `.find` devolve **o primeiro** caminho existente. Os demais continuam na lista.
- **`:290`** — `let filterTerms = positional.filter(a => a !== phaseArg && !fs.existsSync(a))`
  remove de `filterTerms` **todo** posicional que existe no disco.

O segundo caminho é excluído dos filtros por existir, e não é promovido a target porque o
`.find` já parou no primeiro. Ele não é consumido por ninguém e nunca mais é lido.

## Por que isso importa mais do que parece

O modo de falha não é "roda errado", é **"afirma verde sobre código que nunca executou"**.
Isso é exatamente o que derrota um `eval` que checa ausência de `✘`:

```js
eval("bun ../utest/utest.js src pagedtext --force", (out) => {
  check(!out.includes("✘"))     // passa — e não provou nada sobre pagedtext
})
```

No sprint 016 esse eval teria carimbado 🟢 na feature 2.1 sem nunca ter rodado
`pagedtext.t.js`, que é o arquivo que a feature mais mudou. Só apareceu porque a contagem
de arquivos (`📄16`) não batia com o esperado.

**Contorno em uso hoje:** dois comandos separados, cada um com contagem exata afirmada, de
modo que uma rodada vazia deixe de passar por ausência de falha.

```js
eval("bun ../utest/utest.js src --force",       (o) => check(Number([...o.matchAll(/🧪(\d+)/g)].pop()[1]) >= 73))
eval("bun ../utest/utest.js pagedtext --force", (o) => check(o.includes("pagedtext.t.js")))
```

## Correções possíveis, da mais barata à mais completa

1. **Avisar e sair com erro.** Se `positional.filter(a => fs.existsSync(a)).length > 1`,
   imprimir os caminhos ignorados. Não resolve, mas transforma silêncio em ruído — que é a
   diferença entre um eval mentiroso e um eval quebrado.
2. **Tratar caminhos extras como filtro de path** em vez de descartá-los, mudando `:290`
   para preservar os posicionais existentes que não viraram `rawTarget`.
3. **Aceitar múltiplos targets de verdade**, unindo os escaneamentos. É o comportamento que
   a linha de comando sugere e o que qualquer usuário assume ao digitar dois caminhos.

Um caminho **inexistente** também não produz erro (`bun ../utest/utest.js naoexiste` sai
mudo). Provavelmente a mesma família: nada valida que o posicional foi consumido por
alguém.
