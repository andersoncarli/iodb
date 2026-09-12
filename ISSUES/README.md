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

Itens 001-003 (todos sobre `sprint`/`utest`, nao sobre `iodb`) migraram para os repositorios
donos — `~/sprint-cli/ISSUES/001,002` e `~/utest/ISSUES/007` — pela mesma regra que justifica
este diretorio: reportar onde vive o codigo, nao onde o defeito foi visto.

## Indice

- [004-fixture-tabular-pre-8-2-tamanho.md](004-fixture-tabular-pre-8-2-tamanho.md) —
  fixture da 8.2 gerado sem `pageSize` pequeno virou 2633 linhas de enchimento.
- [005-fixture-desaparece-intermitente.md](005-fixture-desaparece-intermitente.md) —
  o mesmo fixture sumiu do disco duas vezes sem causa isolada.
- [006-pagedtext-fill-unidade-repetida.md](006-pagedtext-fill-unidade-repetida.md) —
  proposta: enchimento de pagina como um unico campo largo, nao unidade repetida.

Writeups anteriores, ainda na raiz do repo (mesmo espirito, pre-datam este diretorio):

- `UTEST-ISSUE.md` — `utest` executa so o primeiro de dois caminhos posicionais, em silencio.
- `PROJ-REPLAY-ISSUE.md` — o guarda de replay do `.proj` usa o literal 4096, nao o `pageSize`.
