# 014 — Plano: reorganizar-frentes-e-consertar-evals

Plano do sprint 014 (feature 5.2).

## Objetivo

Arrumar a arvore de frentes antes do trabalho de paginacao comecar: cada frente diz do
que trata, cada feature mora na frente certa, e os evals voltam a assegurar caminhos que
existem.

Refactoring puro: nenhuma linha de logica muda. O criterio de pronto e **equivalencia** —
a suite antes e depois tem que ser a mesma, check por check.

## Passos

1. **Nomear a frente 1.** `plans/1-core/_front.md` era stub de auto-bootstrap ("Frente 1")
   com cinco features confirmadas. Ganha titulo e intro real; `state` vai para `confirmed`.

2. **Trocar o assunto da frente 4.** Era o stub `4-core`. A keyword vai para
   `concorrencia` editada no frontmatter — o `sprint rename core` nao serve porque com
   duas frentes `core` ele resolve para a frente 1 (verificado em dry-run). Com a keyword
   unica, `sprint rename concorrencia concorrencia --apply` renomeia o diretorio.

3. **Frente 2 vira pagedtext.** `sprint rename pages pagedtext --apply`.

4. **A 4.1 antiga sai para refactorings.** `sprint rename 4.1 5.1 --front refactorings
   --apply` — cria a frente 5 e reescreve 24 refs.

5. **As tres de lock migram.** `sprint rename 2.1 4.1`, `2.2 4.2`, `2.3 4.3`, todas
   `--front concorrencia --apply`. Ordem importa: a 4.1 original tem que sair antes.
   O `2.3.probe.js`, que ficou orfao, vai junto como `4.3.probe.js`.

6. **Consertar os evals.** Caminhos de raiz que a 5.1 moveu (`io-append.js`,
   `io-engine.js`, `io-engine.bench.js`) viram `src/...`. Tres assercoes que assertavam
   coordenada em vez de invariante sao reescritas.

7. **Artefatos de bench seguem a feature.** `baseline-2.1.txt` -> `baseline-4.1.txt`,
   `resultado-2.2.txt` -> `resultado-4.2.txt`, com as refs nos evals.

8. **Escrever os intros** das frentes 2, 4 e 5, criar a feature 2.0, rebaixar a 2.5,
   declarar as features 4.4-4.7, e revisar o `pagedtext/ROADMAP.md`.

## Criterio de pronto

- `bun ../utest/utest.js . --force` verde e identico ao de antes;
- `sprint docs` devolve `ok`;
- `sprint eval 4.2` e `sprint eval 4.3` passam inteiros;
- nenhum conserto de comportamento entrou junto (a regra da frente 5).
