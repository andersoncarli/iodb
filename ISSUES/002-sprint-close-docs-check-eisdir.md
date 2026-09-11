# `sprint close` e `sprint docs` crasham `EISDIR` quando ha um diretorio `.md` na raiz

<!-- system file -->

Encontrado em `~/iodb`, thread do sprint 021. `sprint` 0.18.0, Bun 1.3.12. Bloqueia
`sprint close` para QUALQUER sprint (020 e 021 juntos), nao so o que se esta fechando.

---

## Sintoma

```
$ sprint close 021
295 | export function readMd(path) {
296 |   const text = readFileSync(path, "utf8");
                     ^
EISDIR: illegal operation on a directory, read
      at readMd (/home/bittnkr/sprint-cli/src/model.js:296:16)
      at lintMd (/home/bittnkr/sprint-cli/cmds/docs-check.js:146:14)
      at /home/bittnkr/sprint-cli/cmds/docs-check.js:175:3
```

`sprint docs` sozinho crasha igual. `sprint close` chama `docs-check` como portao interno,
entao o crash do segundo trava o primeiro.

Confirmado pre-existente: falha identico com as mudancas da thread em `git stash`.

## Diagnostico

`cmds/docs-check.js` varre `.md` em tres lugares. O `walk()` recursivo (linha ~160)
distingue arquivo de diretorio:

```js
for (const e of readdirSync(dir, { withFileTypes: true })) {
  ...
  if (e.isDirectory()) { walk(p, requireIntro); continue; }
  if (!e.name.endsWith(".md")) continue;
  lintMd(p, ...);
}
```

Mas o loop da RAIZ do repo (linha ~173) nao:

```js
for (const f of readdirSync(ROOT).filter((f) => f.endsWith(".md"))) {
  const p = join(ROOT, f);
  lintMd(p, true, claimedMd.has(p));   // lintMd -> readMd -> readFileSync(p)
}
```

Filtra por `f.endsWith(".md")` e nada mais. Um **diretorio** chamado `algo.md` na raiz
passa o filtro, e `readMd` faz `readFileSync` nele -> `EISDIR`.

Neste repo o gatilho e `/home/bittnkr/iodb/ISSUES.md/` — um diretorio (este aqui), criado
com sufixo `.md`. Enquanto ele existir com esse nome, `sprint docs` e `sprint close` nao
rodam.

## Contorno

Tres opcoes, em ordem de preferencia:

1. **Renomear o diretorio para sem `.md`** (`ISSUES/`). Resolve de vez e nao depende de
   corrigir o `sprint`. Foi decidido MANTER o `.md` nesta thread para o registro ficar
   visivel junto dos outros `*-ISSUE.md` da raiz — entao vale (2).

2. **Fechar o sprint sem o portao.** Estagiar os arquivos do sprint a mao
   (`git add <lista exata>`) e commitar. Pula o `sprint close`, que so encena + roda o
   `docs-check`. Foi o que a thread 021 fez.

3. **Mover o diretorio para fora da raiz** temporariamente (`plans/` tem `walk()` que
   trata diretorio certo; a raiz nao). Feio, mas destrava `sprint close` sem renomear.

## Correcao

No `sprint`, linha ~173 de `cmds/docs-check.js`: adicionar o mesmo guarda que o `walk()`
ja tem —

```js
for (const f of readdirSync(ROOT, { withFileTypes: true })) {
  if (!f.isFile() || !f.name.endsWith(".md")) continue;
  const p = join(ROOT, f.name);
  lintMd(p, true, claimedMd.has(p));
}
```

Uma linha de diferenca. O `walk()` prova que a intencao ja era essa; a raiz so nao
recebeu o mesmo tratamento.
