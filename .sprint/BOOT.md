# iodb — BOOT (Zero Scan Sprints)

Briefing de arranque para agentes. Este projeto é gerido por **ZSS (Zero Scan Sprints)**: para
se orientar você **usa a ferramenta `sprint`**, nunca escaneia o código para entender estado.
Escanear é só para implementar, depois de saber onde. A ideia central: o sistema **sempre sabe
onde cada feature está e qual o próximo passo** — o board não só mostra estado, ele guia.

## O modelo: Frente → Feature → Sprint

- **Frente `N`** (keyword): uma área do sistema. Diretório `plans/N-keyword/` com um `_front.md`.
- **Feature `N.F`**: um aspecto focado, um arquivo `plans/N-keyword/N.F-*.md`, com frontmatter
  de estado, requisitos e `verify_*`.
- **Sprint**: uma unidade = 1 plano + 1 report, co-locados em `sprints/NNN-slug.plan.md` +
  `sprints/NNN-slug.report.md`, referenciando ≥1 feature, da concepção à confirmação.

## A escada de maturidade (a espinha do zero-scan)

Uma feature sobe oito degraus. Como a ordem é fixa, **o degrau atual implica a próxima ação** —
é isso que dispensa o scan. A fonte da verdade desta tabela é `src/model.js#STATE`; o board
(`sprint fronts`) desenha exatamente estes bullets.

| | Degrau | O que o define | O que avança |
|---|---|---|---|
| ⚫ | 1 planejada | spec escrita, requisitos, NNN reservado — o slot guardado | implementar |
| 🟠 | 2 implementando | código existe, os testes não passam | `sprint test` verde |
| 🟡 | 3 testada | a suite passa (`verify_tests`) | escrever o `N.F.eval.js` |
| 🟢 | 4 avaliada | a **máquina** rodou o eval inteiro e passou | humano percorre o eval |
| 🔵 | 5 confirmada | o **humano** confirmou passo a passo | rodar em outro ambiente |
| 🟣 | 6 consolidada | integrada, rodando em >1 ambiente | operar sem regressão |
| ⚪ | 7 rocha | estável, sem regressão conhecida | — (topo) |

O 🔴 **não é degrau** — é o eixo de **saúde**, desenhado por cima da cor:

| | Sinal | Quem produz | O que avança |
|---|---|---|---|
| 🔴 | regressão | `eval --sweep` · `test --sweep` · `doctor` — vermelho | consertar; o verde apaga |

Um plano por implementar é ausência de trabalho, não defeito. Enquanto os dois eram vermelhos,
a regressão — o único sinal que exige ação HOJE — sumia no meio de vinte planejadas.

Dois eixos: a **cor** diz o degrau (quão longe subiu); a **forma** diz a saúde (● viva ·
■ travada: pausada ou bloqueada). Do degrau 3 pra cima o estado é **derivado de evidência**
(a suite rodou, o eval rodou, o humano confirmou numa data) — nunca rótulo à mão.

O degrau nunca é rótulo à mão. `sprint docs` é o portão que checa isso: `state`,
`verify_confirmed`, `confirmed_at` e estar-ou-não em `plans/_confirmed/` são a mesma evidência
escrita em quatro lugares — divergir entre eles é erro, não estilo.

## O eval: quem produz cada degrau

O verify de uma feature vive em `N.F.eval.js`, irmão do `N.F-*.md`. O caminho é **literal**, sem
glob (`scriptPathFor`, `src/eval-run.js`): só `<dir do .md>/<N.F>.eval.js` é descoberto. Arquivos
granulares (`N.F-1-slug.eval.js`) são **invisíveis ao CLI** — rodam apenas porque o `N.F.eval.js`
os importa como índice ESM.

- `sprint eval <N.F> --yes` — a máquina roda o roteiro inteiro. Verde → **🟢 avaliada**.
- `sprint eval <N.F>` — um passo por chamada; você lê a saída e responde `ok` (ou `n`).
  O `ok` do último passo → **🔵 confirmada**, com a data gravada.

Nenhuma flag alcança 🔵: o agente sozinho chega no máximo a 🟢.

### As duas formas de escrever um passo

**Linear** — chamadas nuas no topo do arquivo. O **comentário `//` logo acima é o preâmbulo** que
explica o passo: o mesmo texto documenta o código e guia o humano, sem duplicação.

```js
// A largura do terminal chega no app — 60 colunas, não o default.
eval('COLUMNS=60 minha-cli render', (out) => check(out.includes('60')))
```

**Níveis** — `export default (t) => { ... }`, com `t.sandbox(...)` (scratch dir, é o que leva a 🔵)
e `t.real(...)` (projeto de verdade; só monitoramento, **não** alcança 🔵 sozinho). `t.sandbox`
aceita a forma açucarada, e é a que os projetos com UI usam:

```js
t.sandbox({ desc, file, template, checklist, async test({ sh, check, exists, read, write, git, cwd }) {} })
```

| campo | contrato |
|---|---|
| `desc` | nome do passo e preâmbulo mostrado ao humano |
| `file` | app que o passo roda **e** o alvo que um shell de eval monta como palco vivo. Sem `file`, o passo roda e não monta nada |
| `template` | opcional; escrito em `file` como `export default ${JSON.stringify(...)}` — **JSON puro, handler nenhum sobrevive**. Passo que precisa de comportamento omite `template` e aponta `file` para uma app commitada no repo |
| `test` | recebe o ctx acima com `this.file` amarrado; `check(actual, expected, msg)` |
| `checklist` | opcional, `[{ id, label, match(kind, ev) }]` — o QUE conta como cumprido é do feature, quem observa o evento é do shell |

### Ausência de prova não é prova

**Um 🟢 só existe se algo rodou.** `sprint eval <N.F> --yes` numa feature sem `.eval.js` (e sem
seção `## Eval` no `.md`) não tem o que executar: ele imprime o caminho do roteiro que falta e
**sai 1, sem tocar no degrau**. Um passo que falha também não promove. Não há caminho em que
"não achei prova" e "a prova passou" produzam o mesmo resultado.

Onde o degrau depende de um roteiro que não existe, o board diz isso em vez de convidar para uma
ação impossível: a próxima ação de uma feature sem `.eval.js` é *escrever o `N.F.eval.js`*, nunca
`sprint eval`. E `sprint eval --sweep` — que só consegue *rodar* quem tem roteiro — fecha com a
lista de quem está em 🟢/🔵 **sem** roteiro, sob o título "degrau não derivado de evidência".

Isso importa em board assimilado ou vindo de versão antiga, onde 🟢 vazios podem já existir. A
assinatura deles é visível em `sprint fronts <N.F>`: uma única validação `auto`, num único dia.

## Revalidar é constante, e fica registrado

Uma demonstração escrita e nunca mais rodada apodrece em silêncio — e o 🔵 que ela sustenta
vira uma afirmação sobre o passado. Por isso:

- `sprint eval --sweep` roda **todas** as demonstrações e **deriva** o degrau de cada uma:
  verde promove até 🟢, vermelho rebaixa até 🟡 (inclusive um 🔵, limpando a confirmação e
  desarquivando a frente). `--dry` roda sem escrever nada. Consertar o eval sobe de volta até
  🟢; o 🔵 exige o humano de novo.
- Toda validação entra no **ledger** (`.sprint/eval-log.jsonl`), venha de onde vier. O degrau
  responde *"quão longe está"*; o ledger responde *"quanto se confia"* — quanto mais uma
  feature é exercitada, mais garantida ela fica. `sprint fronts <N.F>` mostra o acumulado:
  validações ok/total, dias distintos, projetos distintos, e a última.

## Assimilar um projeto que já tem história

Num projeto com passado, `sprint init` entrega um board **vazio** — e o caminho de sair dali é
por verbo, nunca escrevendo `plans/**.md` à mão:

- `sprint feature new <N.F> "título"` — declara que uma feature existe. **Não reserva sprint**:
  registrar a feature que pertence a um sprint já commitado não deve criar um sprint fantasma.
- `sprint adopt <arquivo> --features <N.F>` — traz um plano/report que já existe para
  `sprints/NNN-slug.{plan,report}.md`, com frontmatter completo e a data derivada do git.
- `sprint new` continua sendo a porta do trabalho **novo**. As duas portas são distintas.

Espere o resultado certo: **um projeto recém-assimilado é monocromático e sem garantia, por
design.** Tudo entra ⚫/🟡 com `garantia: nenhuma validação registrada`, mesmo que a suíte tenha
300 testes verdes há meses — a cor vem de *rodar* pelo tool, não de importar. Oito meses de
trabalho sólido e um repo vazio começam iguais aqui, e isso é honestidade, não perda: o board
afirma só o que ele mesmo viu acontecer. A primeira cor aparece no primeiro `sprint eval`.

E assimilar não é só criar `plans/`: é **desativar as fontes de verdade concorrentes**. Um
`MASTER-PLAN.md` que numera sprints por conta própria passa a competir com o board — e quem
perde é quem chega. `sprint docs` avisa quando encontra um desses.

## Início de sessão (o menu)

O arranque em si é **`sprint boot`**: ele imprime o roteiro numerado, derivado do estado, com a
prova que cada passo devolve. O que segue é o menu de navegação — a referência dos verbos, não
a sequência de arranque (essa não mora em prosa nenhuma, justamente para não envelhecer calada).

1. `sprint fronts` — board: frentes → faixa de degraus. O menu de uma olhada.
2. `sprint fronts <keyword|N>` — o detalhe de uma frente (features + degraus + resumo).
3. `sprint fronts <N.F>` — a narrativa de uma feature (objetivo, requisitos, próxima ação).
4. `sprint eval` — a árvore do que falta avaliar; `sprint eval <N.F>` roda o eval da feature.
5. `sprint recent` — as últimas atualizações, do sprint mais novo pro mais antigo.
6. `sprint eval --sweep --dry` — as demonstrações ainda rodam? (leitura, sem escrever nada)

Nunca escaneie para descobrir estado: o board e a narrativa já entregam no nível certo.

## O ciclo

`sprint new <N.F> "slug"` (reserva número + plano/report) → implementa → `sprint test` →
`sprint eval <N.F> --yes` (🟢) → `sprint eval <N.F>` passo a passo com o humano (🔵) →
`sprint close` (regenera board/dashboard, stage + commit do sprint).

O `eval` e o `close` são **dois movimentos em cadeia, e ambos são do usuário**: no último `ok`
o eval pergunta se fecha, pré-preenche a intro do report (editável, num terminal real) e chama
o `close`. Quem acabou de percorrer os passos é justamente quem ainda lembra o que aconteceu.

## As duas regras de ouro

- **🔵 é do humano.** Passar os testes não conclui uma feature, e rodar o eval automático
  também não. O agente sozinho chega no máximo a **🟢 avaliada** (`--yes`); **🔵 confirmada**
  exige o humano percorrendo `sprint eval <N.F>` e digitando `ok`. Não há flag que pule isso.
- **`sprint close` é do usuário.** O `close` commita — mas **somente os arquivos daquele
  sprint** (o par plan+report, o `.md`/`.eval.js` das features dele, o `_front.md` da frente e
  o que elas declaram em `files:`), com a mensagem `NNN [N.F]: Título`. O que estiver sujo ao
  lado não entra. E quem dispara o `close` é o humano, no fim do eval — nunca o agente por
  conta própria.

## Onde cada coisa vive

- `STATUS.md` = board vivo (gerado). `plans/N-keyword/N.F-*.md` = spec da feature.
- `plans/_confirmed/` = frentes com todas as features 🔵 (arquivadas, fora do caminho).
- `sprints/_TOC.md` = dashboard de história (gerado). `sprints/NNN-slug.{plan,report}.md` = cada sprint (passado).
- `README.md` referencia este BOOT como a porta de entrada da metodologia.
