# 032 — Plano: frente-sql

Abrir a frente 9 `sql` — a algebra relacional funcional sobre a qual um parser se mapeia sem
pensar — e escrever as dez features que a compoem. Sprint de **planejamento**: nenhum arquivo
de `src/`, `pagedtext/` ou `table/` e tocado.

## Objetivo

A frente 8 fechou inteira, sete features 🔵, e entregou o substrato de leitura: o contrato
`{schema, scan}` como codigo, a suite de conformidade, o cursor como protocolo, quatro
backings em quatro niveis de capacidade, e o catalogo preguicoso. O plano da 8 registrou a
fronteira com todas as letras: *"a algebra e a frente 9 e consome esta"*.

O pedido do usuario fecha a outra ponta. Ele quer a cadeia:

```js
from('users').gte('age',18).sort('name').limit(20).pick('name','age')
```

e declarou o objetivo final numa frase: *"nos nao vamos construir um sql parser aqui. nosso
objetivo e um sql funcional, sobre o qual o parser possa ser mapeado em seguida de forma
brainless."*

## O inventario que motivou a frente

Levantado com citacao `file:line`:

- **Fora de `src/table/` o terreno e virgem.** Um grep por `sort|orderBy|groupBy|join|
  distinct|pick|select|project` em `src/`, fora de testes, devolve **apenas**
  `Array.prototype.join` para montar string, `path.join`, e `Array.sort` incidental. Nao
  existe um unico operador relacional no repositorio.
- `src/db.js` tem **143 bytes** — e um re-export, nao uma camada de query.
- O unico `GROUP BY` esta em `src/table/sqlite-table.js:168`, dentro do backing, na forma
  exata `SELECT k as _group, count(*) as _count`. Nao ha group local com que compara-lo.
- A gramatica de expressao `{op, field, value}` com `and`/`or` **ja existe e e invisivel**:
  vive em `translateFilter` (`sqlite-table.js:60-83`) e nenhum outro arquivo sabe que essa
  forma existe. Pior: `conform` **nunca exercita `filter` nem `group`**
  (`conformance.js:14-17` chama quatro leis, nenhuma toca essas capacidades) — a capacidade
  L5 inteira passou pela frente 8 sem oraculo.

Ha um contrato de leitura excelente e **nenhuma maneira de perguntar**.

## Seis decisoes tomadas com o usuario

1. **Verbo mais campo como argumento**, nao acessor por campo. `db.users.age.gte(18)`
   exigiria Proxy de dois niveis e faria um campo chamado `sort` colidir com o verbo.
2. **Terminais nomeados E `()`.** `.rows()`, `.cursor()`, `.first()`, `.count()`, `for...of`,
   mais `()` como atalho de `.rows()` — a secao 19 da spec termina a cadeia assim.
3. **Otimizador por capacidade, sem modelo de custo.** As regras leem `capabilities(t)` e o
   schema. A unica leitura de tamanho permitida e `count()` quando a tabela o oferece de
   graca: numero exato e O(1), nao estimativa.
4. **Escopo completo de operadores, cada um em sua feature**, juncao inclusive — pedido
   explicito: *"a frente deve prever a implementacao inteira cada uma em sua feature"*.
5. **O sqlite e refatorado para importar a gramatica**, em vez de a frente conviver com duas
   copias. E a unica entrada da frente 9 em `src/table/`, e a 9.1 carrega a obrigacao de
   provar que `sprint eval 8.6 --yes` continua verde.
6. **A ponte para o parser e uma tabela de sentencas mapeadas a mao**, como teste. Nenhum
   codigo de parsing.

## Passos

1. `sprint new 9.1 --front sql "gramatica-expr-e-no"` — cria a frente (auto-bootstrap) e a
   primeira feature. **Feito.**
2. Escrever `plans/9-sql/_front.md`: o inventario com `file:line`, a tese semantica-versus-
   capacidade, as tres decisoes, a fronteira com `src/table/` e a excecao, e o que fica
   declarado fora de escopo. **Feito.**
3. Escrever as dez features em ordem de dependencia, cada uma com paragrafo introdutorio no
   modelo da frente 8, requisitos citando evidencia, e um `criterio:` mecanicamente
   verificavel. **Feito.**
4. `sprint rename 032 frente-sql --apply` — o sprint reservado passa a refletir o que ele e:
   a abertura da frente, como o 023 foi para a frente 8. **Feito.**
5. Verificar pelo proprio tool: `sprint fronts`, `sprint fronts sql`, `sprint fronts 9.1..9.10`,
   `sprint docs`.

## Ordem das features

```
9.1 → 9.2 → 9.3 → 9.4 → { 9.5 → 9.6  ∥  9.7 → 9.8 → 9.9 }  →  9.10
```

A **9.3 e o primeiro valor de ponta a ponta**: depois dela a expressao do pedido roda sobre
os quatro backings, por varredura, e esta certa. Tudo que vem depois e custo, nao correcao —
a tese da frente 8 aplicada a frente 9.

A **9.4 e a mais importante**, pelo mesmo motivo que a 8.1 foi da frente 8: escrever o
oraculo antes dos operadores caros faz cada um deles nascer com a prova pronta, em vez de
alguem tentar generalizar um teste depois de o codigo estar escrito. A matriz de queries
nasce inteira, com as linhas dos operadores inexistentes puladas, e cada feature seguinte
**destrava a sua** em vez de reescrever o oraculo.

## Criterio de pronto

- `sprint fronts` mostra `9. sql [⚫⚫⚫⚫⚫⚫⚫⚫⚫⚫]` e a frente 9 contribui dez ⚫
  para a contagem global de planejadas.
- `sprint fronts sql` imprime a narrativa e as dez features na ordem.
- `sprint fronts <N.F>` imprime objetivo, requisitos e proxima acao para cada uma das dez.
- `sprint docs` nao acusa problema novo.
- Nenhum arquivo de `src/`, `pagedtext/` ou `table/` modificado; nenhum degrau movido.
