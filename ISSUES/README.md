# ISSUES/ — writeups de defeitos das ferramentas

<!-- system file -->

O detalhe forense dos defeitos que o `ISSUES.md` da raiz lista em uma linha. Ferramentas de
trabalho do projeto — `sprint` (sprint-cli), `utest`, `quickrs` — defeitos encontrados
durante o desenvolvimento do `iodb` e **reportados, nao consertados** (a regra do projeto:
achado fora do escopo vira registro, quem decide o escopo e o usuario).

`ISSUES.md` (arquivo, na raiz) e o kanban rapido — captura e status. `ISSUES/` (este
diretorio) e onde mora o writeup completo de um item que precisou de mais que uma linha.

Um arquivo por defeito, nome `NNN-slug.md` em sequencia numerica. Formato: um `# H1` com a
frase do defeito, depois `## Sintoma`, `## Diagnostico` (arquivo:linha da causa),
`## Contorno` (o que se faz enquanto dura), e `## Correcao` quando ela e conhecida.

## Indice

- [001-sprint-test-eval-js-em-verify-tests.md](001-sprint-test-eval-js-em-verify-tests.md) —
  `sprint test` executa `bun <arquivo>.eval.js` como script e quebra; derrubou a 6.1 de 🔵.
- [002-sprint-close-docs-check-eisdir.md](002-sprint-close-docs-check-eisdir.md) —
  `sprint close`/`sprint docs` crasham `EISDIR` num diretorio `.md` na raiz.

Writeups anteriores, ainda na raiz do repo (mesmo espirito, pre-datam este diretorio):

- `UTEST-ISSUE.md` — `utest` executa so o primeiro de dois caminhos posicionais, em silencio.
- `PROJ-REPLAY-ISSUE.md` — o guarda de replay do `.proj` usa o literal 4096, nao o `pageSize`.
