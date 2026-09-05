# iodb — instruções para agentes

<!-- zss:begin -->
## Zero Scan Sprint Management

Este projeto é gerido por **ZSS (Zero Scan Sprints)** via a ferramenta `sprint`. **Para se
orientar, use `sprint` — nunca escaneie o código para entender estado.** Escanear é só para
implementar, depois de saber onde.

### Arranque — faça isto antes de qualquer outra coisa

Um comando:

```
sprint boot
```

Ele imprime o **roteiro numerado** de arranque — a sequência de comandos que substitui a
varredura, com a prova que cada passo tem que devolver. O roteiro não está escrito aqui de
propósito: um roteiro em prosa envelhece calado, mandando rodar verbo que mudou de nome. O do
`sprint boot` é derivado do estado, então o do dia 300 é o mesmo comando do dia 1 — e continua
certo. Ele é repetível e idempotente: não move degrau nenhum.

**Embodiment — prove que bootou.** Cada passo do roteiro traz uma linha `prova:`. Antes de propor
ou tocar em qualquer coisa, devolva essas provas ao usuário. Se você não consegue, você não
bootou — repita o `sprint boot` em vez de improvisar. Para checar o comportamento de um comando
de que você não tem certeza, use `sprint eval <comando>`: ele roda ao vivo, mostra a saída e
para, sem alterar degrau.

O que isso te dá que uma varredura não dá: o `sprint fronts` responde *"o que falta?"* em **uma**
chamada, com a próxima ação por feature. Descobrir o mesmo por `git log`, `ls`, `grep` e leitura
de `.md` custa dezenas de chamadas, envelhece no mesmo dia e ainda erra — porque o degrau é
derivado de evidência que só a ferramenta cruza.

### A regra do bash

**Nenhum comando de shell sem uma tarefa específica que o exija.** Não vasculhe o projeto por
reflexo, por curiosidade ou "para ter contexto" — e **nunca antes de o usuário ter dado uma
instrução concreta**. Escanear sem instrução é ruído: você gasta chamadas, enche o contexto de
detalhe irrelevante e ainda arrisca agir fora do escopo.

- Estado do workflow (o que falta, onde estou, o que mudou) → **sempre `sprint`**, nunca
  `git log`/`git status`/`ls`/`grep`/leitura de `STATUS.md` ou de arquivos em `plans/`.
- Código de implementação → leia **quando a tarefa em mãos for mexer nele**, e só os arquivos
  que ela toca. `sprint files <N.F>` diz quais são.
- Achou um problema fora do escopo do que foi pedido? **Reporte, não conserte.** Desvio no meio
  da tarefa vira sprint próprio — quem decide o escopo é o usuário.

**Deriva de escopo — o sinal, não o achismo.** Chegou um pedido novo com um sprint já aberto?
Antes de codar, rode `sprint files --drift <os arquivos que o pedido toca>`. Ele compara contra o
escopo declarado do sprint aberto (o mesmo conjunto que o `close` encena) e responde *dentro* ou
*FORA*, um por linha. **FORA = sprint novo**, não scope creep no atual: pause, cite o que o
comando imprimiu e proponha `sprint new <N.F> "slug"`. Sem argumento, `sprint files --drift` lista
o sprint aberto e o escopo inteiro. Não é portão — nada bloqueia; quem decide é você e o usuário,
o tool só compara.

Mapa pergunta → comando:

- **board de tudo** (frentes → features → degrau + o que está na mesa) → `sprint fronts`;
- **retomar uma frente/feature** (objetivo, requisitos, próxima ação) → `sprint fronts <keyword|N|N.F>`;
- **o que falta avaliar** → `sprint eval`; **o que mudou por último** → `sprint recent`;
- **as demonstrações ainda rodam?** → `sprint eval --sweep` (`--dry` só reporta);
- **história de um sprint** → `sprints/NNN-slug.{plan,report}.md`; **dashboard** → `sprints/_TOC.md`.

Pontos de entrada — cada um responde uma pergunta, nenhum reexplica o que o outro já diz:

- `README.md` → o que é o projeto (porta de entrada, escrito à mão).
- `STATUS.md` → o estado agora (board gerado — nunca edite à mão).
- `sprints/_TOC.md` → o que já aconteceu (dashboard de história, gerado).
- `.sprint/BOOT.md` → como o método funciona (este briefing de arranque).

Cada feature sobe uma escada de sete degraus — ⚫ planejada · 🟠 implementando · 🟡 testada ·
🟢 avaliada · 🔵 confirmada · 🟣 consolidada · ⚪ rocha. A ordem é fixa, então o degrau atual
já diz a próxima ação; a tabela completa está no `.sprint/BOOT.md`.

**🔴 não é degrau, é regressão**: o eixo de saúde por cima da cor, aceso só por `eval --sweep`,
`test --sweep` ou `doctor` que rodou e voltou vermelho. O verde apaga.

O degrau é **derivado de evidência**, e a evidência é reavaliada a qualquer momento: `sprint
eval --sweep` roda todas as demonstrações e move o degrau nos dois sentidos — verde promove
até 🟢, vermelho rebaixa até 🟡 (inclusive um 🔵, se a demonstração que o sustentava parou de
rodar). Descer também acontece por `sprint reopen`, explicitamente. **Validar não é carimbo, é
acumulado**: toda validação entra no ledger e `sprint fronts <N.F>` mostra a *garantia* —
quantas vezes, em quantos dias, em quantos projetos.

Ciclo: `sprint new <N.F> "slug"` → implementa → `sprint test` → `sprint eval <N.F> --yes` (🟢)
→ `sprint eval <N.F>` passo a passo com o humano (🔵) → `sprint close` (stage + commit).

O `eval` e o `close` são dois movimentos em cadeia, e ambos são do usuário: no último `ok` o
eval pergunta se fecha, pré-preenche a intro do report e chama o `close`.

Duas regras de ouro: **🔵 é do humano** — o agente sozinho chega no máximo a 🟢 avaliada, e não
há flag que pule o `ok` humano; **`sprint close` é do usuário** — o `close` commita, mas
**somente os arquivos daquele sprint** (`NNN [N.F]: Título`), e quem o dispara é o humano no
fim do eval, nunca o agente por conta própria.
<!-- zss:end -->
