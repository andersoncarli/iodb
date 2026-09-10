---
sprint: 16
date: 2026-09-10
features: [2.1]
thread: null
---
# 016 — Plano: interferencia-minima

Sprint da feature **2.1 — Interferencia minima: o arquivo de dados continua sendo do
formato dele**.

## Objetivo

Um `.csv` paginado tem que abrir num parser de CSV comum, `file(1)` tem que dizer que e
texto e `grep` sem `-a` tem que achar o que esta la. Hoje nao: metade do arquivo e byte
NUL, a primeira linha e o JSON da genese e o rodape volta como um registro de lixo.

## Passos

1. **Zerar os NUL.** Os dois `Buffer.alloc` que zeravam (pagina de header e rodape) passam
   a ser preenchidos com o enchimento do kind. As paginas de dados ja estavam certas.
2. **Tirar a genese da pagina 0.** Ela migra para o rodape, que ja existe e ja e lido na
   abertura. `loadHeader()` passa a ler pelo FIM do arquivo. `serializeHeader` morre,
   `headerPages` vira 0, e a pagina 0 vira pagina de dados como qualquer outra.
3. **Enchimento por formato, e sintatico.** Tabela de kinds com `csv`, `jsonl` e `yaml`
   alem de `clike` e `text`. Em csv/jsonl o enchimento e ` ,` — um campo extra
   delimitado, que um leitor comum le como coluna a mais e ignora, e que um editor que
   apara fim de linha nao tem o que aparar porque a linha termina em virgula. Nos formatos
   com comentario e ` //---` / ` #---`.
4. **O rodape veste a roupa do formato** (`hide` por kind), senao o JSON das stats volta
   como o ultimo registro do arquivo.
5. **Declarar onde o enchimento NAO e neutro.** `kindRestrictions('yaml')` devolve a
   restricao do bloco escalar, em runtime.
6. **`validate(file)`** — deteccao, ja que prevencao e impossivel.

## Criterio de pronto

Zero NUL; `file` diz texto; `grep` sem `-a` encontra; um leitor de CSV do Python devolve os
200 registros limpos; round-trip preservado; suite verde; bench sem regressao.
