# Dashboard — Frentes, Features e Sprints

Estado do sistema como arvore colapsavel: **Frente → Feature → [sprints]**. Cada sprint
e um link numerico `[NNN]`; passe o mouse para ver titulo + intro do report. Gerado por
`sprint reports:index` a partir dos arquivos de frente/feature e do frontmatter dos
reports — nao editar a mao. Board de estado + proxima acao: `STATUS.md`.

Legenda: ⚫ planejada · 🟠 implementando · 🟡 testada · 🟢 avaliada · 🔵 confirmada · 🟣 consolidada · ⚪ rocha · ⬜ pausada · 🔴 regressao

<details><summary>🟠 <b>[1] core</b> — Frente 1</summary>

<details><summary>🟢 [1.1] DB reativo: db.js, node.js, models, adapters (file/yaml/json/sqlite/dash) — avaliada</summary>

[001](sprints/001-extracao-de-bot.report.md "Report: Extração de bot/lib/adapters para repositório próprio · Sprint que originou este repositório. Corresponde ao sprint 027 (`sprints/027-extrair-io-db-lib-adapters-db-js-node-js-para-submodule-io")

</details>

<details><summary>🟢 [1.2] saveIndex corrompe sob escrita concorrente multi-processo — avaliada</summary>

[002](sprints/002-saveindex-corrompe-sob-escrita-concorrente-multi-processo.report.md "saveIndex corrompe sob escrita concorrente multi-processo · `saveIndex()` deixou de corromper o índice sob N processos concorrentes no mesmo `IO()`: temp por-PID + o `saveIndex()` sem lock do ramo `el")

</details>

<details><summary>🟢 [1.3] Matriz de concorrencia multi-processo: eixos format/reduce/close/seed — avaliada</summary>

[003](sprints/003-matriz-de-concorrencia-multi-processo.report.md "matriz de concorrencia multi-processo · Bateria parametrica (`io-engine.matrix.test.js`) varrendo format × reduce × seed × close sob 8 processos concorrentes: confirma que o fix do sprint 002 fecha to")

</details>

</details>
