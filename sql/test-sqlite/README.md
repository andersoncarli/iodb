# sql-test-tool

Ferramenta Bun para **equivalência progressiva** com SQLite via corpus SQLLogicTest.

Objetivo: baixar, classificar por feature/keyword e executar testes de SQL de forma incremental contra `bun:sqlite`, preparando o caminho para plugar outras engines (sua engine, DuckDB, etc.).

---

## Por que esta abordagem?

| Problema | Solução adotada |
|----------|-----------------|
| Corpus oficial do SQLite é enorme (milhões de queries) | Subconjunto curado + samples embutidos + classificação por feature |
| Preciso provar cobertura gradualmente | Taxonomy ordenada: `basic` → `where` → `join` → `cte` → … |
| Quero usar SQLite como oráculo de verdade | Runner executa no `bun:sqlite` e compara resultados com o esperado do `.test` |
| Vou trocar a engine depois | Interface de adapter preparada (hoje só `bun:sqlite`; depois basta implementar o mesmo contrato) |
| Formato padrão da indústria | SQLLogicTest (`.test` / `.slt`) — usado por SQLite, DuckDB, DataFusion, RisingLight, Stoolap… |

### Fontes oficiais e justificativa

1. **SQLLogicTest (SLT)** — https://sqlite.org/sqllogictest  
   Padrão de ouro criado pelo próprio SQLite. Foco em *resultados corretos*, não em performance ou planejamento. Formato texto simples, engine-agnostic.

2. **Mirrors públicos do corpus**  
   - https://github.com/gregrahn/sqllogictest (mirror Git)  
   - https://github.com/jzombie/sqlite-sqllogictest-corpus (export Fossil + Docker)  
   O corpus completo é grande demais para desenvolvimento diário. Por isso a ferramenta começa com um **subconjunto embutido** de arquivos `.test` representativos de cada feature e permite expandir depois.

3. **Organização por feature** inspirada em projetos reais  
   - Stoolap (`tests/slt/basic|aggregate|join|…`)  
   - DataFusion (`sqllogictest/test_files/`)  
   - risinglightdb/sqllogictest-rs  

Isso permite que você diga: “já passo 100% de `basic` + `where` + `join`” e mostre cobertura concreta.

---

## Instalação / uso rápido

```bash
cd sql-test-tool
# Bun já traz bun:sqlite — zero dependências extras

bun run bin/test-sqlite.ts download    # prepara corpus (samples embutidos)
bun run bin/test-sqlite.ts classify    # classifica por feature
bun run bin/test-sqlite.ts run basic   # roda só a feature básica
bun run bin/test-sqlite.ts run basic,where,join
bun run bin/test-sqlite.ts run all
bun run bin/test-sqlite.ts status      # resumo de cobertura
```

Ou via scripts do `package.json`:

```bash
bun run download
bun run classify
bun run run -- basic
bun run status
```

---

## Taxonomy progressiva (ordem de implementação recomendada)

| Ordem | Feature         | O que cobre                                      |
|-------|-----------------|--------------------------------------------------|
| 10    | `basic`         | CREATE TABLE, INSERT, SELECT simples, literais   |
| 20    | `where`         | WHERE, AND/OR/NOT, IS NULL, BETWEEN              |
| 30    | `order_limit`   | ORDER BY, LIMIT, OFFSET, DISTINCT                |
| 40    | `update_delete` | UPDATE, DELETE                                   |
| 50    | `aggregate`     | COUNT/SUM/AVG/MIN/MAX, GROUP BY, HAVING          |
| 60    | `join`          | INNER / LEFT / CROSS JOIN                        |
| 70    | `subquery`      | IN, EXISTS, subqueries correlacionadas           |
| 80    | `set_ops`       | UNION, INTERSECT, EXCEPT                         |
| 90    | `cte`           | WITH (CTEs)                                      |
| 100   | `window`        | OVER, PARTITION BY, ROW_NUMBER…                  |
| 110   | `views`         | CREATE/DROP VIEW                                 |
| 120   | `index`         | CREATE/DROP INDEX                                |
| 130   | `transaction`   | BEGIN / COMMIT / ROLLBACK                        |
| 140   | `functions`     | COALESCE, CASE, CAST, funções de string/math     |
| 150   | `pragma`        | PRAGMA (específico SQLite)                       |
| 999   | `other`         | Não classificado                                 |

Você implementa a feature na sua engine → roda `run <feature>` → quando passar 100%, avança.

---

## Formato SQLLogicTest (resumo)

```text
# comentário
statement ok
CREATE TABLE t(a INT);
INSERT INTO t VALUES(1);

query I
SELECT a FROM t;
----
1

statement error
INSERT INTO t VALUES('bad');
```

- `statement ok` / `statement error` — espera sucesso ou falha
- `query <tipos>` — tipos são `I` (int), `T` (text), `R` (real); opcionalmente `rowsort` / `valuesort`
- `----` separa a query do resultado esperado

O parser desta ferramenta é intencionalmente minimalista (cobre o essencial para o corpus curado). Pode ser estendido depois.

---

## Estrutura do projeto

```
sql-test-tool/
├── README.md                 ← este arquivo
├── package.json
├── bin/
│   └── test-sqlite.ts        ← CLI principal (download / classify / run / status)
├── data/                     ← gerado em runtime
│   ├── corpus/               ← arquivos .test brutos
│   ├── classified/           ← organizados por feature
│   │   ├── basic/
│   │   ├── where/
│   │   ├── … 
│   │   └── manifest.json
│   └── results/
│       └── last-run.json
└── src/                      ← (futuro) adapters de engine
```

---

## Preparando para outras engines

O runner atual instancia `new Database(":memory:")` de `bun:sqlite`.  
Para plugar sua engine:

1. Extraia a interface mínima:

```ts
interface SqlEngine {
  exec(sql: string): void;           // statements
  query(sql: string): any[];         // SELECT → rows
  close(): void;
}
```

2. Implemente um adapter `YourEngineAdapter implements SqlEngine`.
3. Passe o adapter para `runOneFile` (ou crie `run --engine=your`).

Assim a mesma classificação e os mesmos `.test` servem para provar equivalência com SQLite **e** regressão da sua engine.

---

## Limitações atuais (honestas)

- Corpus inicial é um **subconjunto embutido** (não baixa o corpus de milhões de queries). Expanda colocando mais `.test` em `data/corpus/` e rodando `classify` de novo.
- Parser SLT é simplificado (não trata `skipif`/`onlyif`/`halt` completamente, nem hashes MD5 de resultados grandes).
- `bun:sqlite` é o único backend implementado.
- Resultados de ponto flutuante e ordenação de NULL seguem o comportamento do SQLite embutido no Bun.

Essas limitações são intencionais: o objetivo é ter um harness **leve, progressivo e extensível**, não reimplementar o TH3 do SQLite.

---

## Referências

- https://sqlite.org/sqllogictest  
- https://sqlite.org/testing.html  
- https://github.com/gregrahn/sqllogictest  
- https://github.com/jzombie/sqlite-sqllogictest-corpus  
- https://github.com/risinglightdb/sqllogictest-rs  
- Stoolap testing docs (organização por feature)

---

**Fluxo recomendado diário**

```bash
bun run bin/test-sqlite.ts download
bun run bin/test-sqlite.ts classify
bun run bin/test-sqlite.ts run basic          # implemente até passar
bun run bin/test-sqlite.ts run basic,where    # próxima feature
bun run bin/test-sqlite.ts status
```
