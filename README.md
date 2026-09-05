# iodb

Reactive DB/IO engine: polymorphic factory, universal node resolver, and file/yaml/json/sqlite/dash adapters.

Estritamente sobre o sistema de arquivos duplo (log append-only + projeção) e a
interface geral de bancos de dados sobre Nodes armazenados — nada além disso.

## Dependências (peers de workspace, não submodules)

Este repositório espera `../utils` e `../utest` como diretórios irmãos no
filesystem — não os traz como git submodule, e não os vendoriza:

```
qualquer/pasta/
  utils/   ← git clone git@github.com:andersoncarli/utils.git
  utest/   ← git clone git@github.com:andersoncarli/utest.git
  iodb/    ← este repositório
```

`iodb/*.js` importa de `../utils/src/...` (bus, Emitter) e os scripts de teste
rodam via `bun ../utest/utest.js .`. Clonar `iodb` sozinho sem `utils`/`utest`
ao lado não é suficiente — clone os três lado a lado no mesmo workspace.

Quando consumido como git submodule de outro projeto (ex.: `bot/`), esse
projeto host deve ter `utils` e `utest` como submodules irmãos de `iodb` no
mesmo nível — é exatamente o arranjo que `bot/` já usa.

## Onde está o quê

Este projeto é gerido pela ferramenta `sprint`. Briefing do método:
[.sprint/BOOT.md](.sprint/BOOT.md). Estado corrente: [STATUS.md](STATUS.md) — ou `sprint fronts`.
História: [sprints/_TOC.md](sprints/_TOC.md).

<!-- zss:begin -->
## Gestão do trabalho

Este projeto é gerido por **ZSS (Zero Scan Sprints)**: o estado do trabalho vive na ferramenta `sprint`, não em docs escritos à mão. Comece por `sprint boot`; o método está em [AGENTS.md](AGENTS.md) e em `.sprint/BOOT.md`.
<!-- zss:end -->
