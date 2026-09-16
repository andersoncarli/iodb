User: Eu quero fazer uma ferramenta de indexação e busca em arquivos texto, que indexe todo o meu hd, de forma que eu possa encontrar qualquer arquivo pelo conteúdo. Mas quero fazer de forma a poder combinar termos fora de ordem mas que apareçam por proximidade ou presença em um mesmo arquivo. Qual o SOTA para free text search? Uso bun/js.
Kimi: Vou buscar o estado da arte em full-text search para te dar uma resposta atualizada.
 Para o seu caso — **indexar todo o HD local** com busca por **proximidade de termos fora de ordem** — o SOTA (state of the art) em 2026 divide-se em duas abordagens complementares:

---

## 1. Busca Léxica Clássica (inverted index + proximidade)

O padrão de ouro continua sendo o **inverted index posicional** (Lucene/Tantivy), mas com ranking que considera proximidade entre termos, não apenas presença.

### Como funciona a proximidade:

O motor armazena, para cada termo, **não só em quais documentos ele aparece, mas em quais posições**. Na hora da query, ele calcula a distância mínima entre as posições dos termos buscados — quanto mais próximos, maior o score.

Meilisearch, por exemplo, usa isso como regra de ranking nativa:

---

## 2. Busca Semântica/Vetorial (embeddings)

A segunda frente do SOTA é usar **embeddings** — transformar texto e query em vetores numéricos e buscar por similaridade de significado, não por palavras exatas. Isso naturalmente resolve "termos fora de ordem" e até sinônimos. Ferramentas como OpenSearch, Chroma e Qdrant já combinam busca léxica (BM25) + vetorial (hybrid search).

---

## Recomendação prática para Bun/JS

Dado que você usa **Bun/JS** e quer algo local, leve e integrável, aqui vai uma arquitetura que une o melhor dos dois mundos:

### Opção A: Tantivy (via FFI/bindings) + Bun
**Tantivy** é o equivalente em Rust do Apache Lucene — biblioteca de inverted index posicional com BM25, proximidade, faceting, etc. É extremamente rápido e com baixo footprint de memória.

- Você pode criar um **serviço Rust** que expõe uma API HTTP (ou gRPC) e o Bun chama via `fetch`.
- Ou usar `bun:ffi` para bindings diretos (mais trabalho, mas zero overhead de rede).
- Tantivy suporta **proximity queries** nativamente via `PhraseQuery` com slop (distância máxima entre termos).

### Opção B: Meilisearch (standalone) + Bun
Meilisearch é escrito em Rust, roda como binário standalone, e tem **proximidade como regra de ranking built-in**.

- Você sobe o Meilisearch localmente e indexa seus arquivos via API REST.
- Bun consome a API para buscar.
- Suporta typo tolerance, proximidade, e é absurdamente fácil de operar.
- **Contra:** é mais "caixa preta" — menos controle fino do que Tantivy puro.

### Opção C: SQLite FTS5 (mais simples, menos SOTA)
Se quiser algo 100% em Bun sem processos externos, o SQLite tem **FTS5** (full-text search) com suporte a `NEAR` operator para proximidade. Não é tão sofisticado quanto BM25+proximidade de Tantivy/Meilisearch, mas funciona e é zero-dependency.

---

## Arquitetura sugerida para seu projeto

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Bun/JS CLI    │────▶│  Tantivy Service │────▶│  Indexed Docs   │
│  (crawler + UI) │     │  (Rust binary)   │     │  (local disk)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                        │
        │                        ▼
        │               ┌─────────────────┐
        │               │  Inverted Index │
        │               │  (positions +   │
        │               │   BM25 scores)  │
        │               └─────────────────┘
        ▼
┌─────────────────┐
│  Semantic Layer │  ← opcional: embeddings locais (e.g. ollama)
│  (vetor search) │     para busca por significado
└─────────────────┘
```

### Pipeline de indexação:
1. **Crawler em Bun** varre o HD, extrai texto de `.txt`, `.md`, `.pdf`, `.docx`, etc.
2. Envia para o Tantivy/Meilisearch indexar com posições de termos.
3. Na busca, o usuário digita termos → o motor calcula proximidade mínima entre eles e ranqueia.

### Query de proximidade (exemplo conceitual em Tantivy):
```
"termoA termoB"~10   → termos a até 10 palavras de distância, em qualquer ordem
```

---

## Resumo: o que usar?

| Critério | Melhor opção |
|----------|-------------|
| **Performance máxima + controle** | Tantivy (Rust) via API |
| **Facilidade de uso + proximidade nativa** | Meilisearch standalone |
| **Zero dependências externas** | SQLite FTS5 |
| **Busca semântica (significado, não palavras)** | Hybrid: Tantivy/Meilisearch + embeddings locais |

Se você quer o **SOTA real** e está disposto a um pouco de Rust, vá de **Tantivy**. Se quer algo que funcione *agora* com Bun e sem dor de cabeça, **Meilisearch** é o caminho. Quer que eu monte um protótipo da arquitetura com Bun + uma dessas opções?
User: Fale mais sobre SQLite FTS5.
Kimi: O **SQLite FTS5** (Full-Text Search version 5) é a engine de busca textual embutida no SQLite. Como o SQLite é uma biblioteca C single-file, e o Bun tem bindings nativos para SQLite via `bun:sqlite`, você consegue usar FTS5 **100% dentro do Bun**, sem processos externos, sem Docker, sem nada. É a opção mais "self-contained" possível.

---

## Como funciona internamente

FTS5 usa uma **estrutura de índice invertido** (inverted index) armazenada em tabelas virtuais do SQLite. Para cada termo, ele guarda:
- Em quais documentos o termo aparece
- **Em quais posições** dentro de cada documento

Isso permite operações de proximidade. A tabela virtual FTS5 é separada da tabela de dados — você insere o texto nela e ela cuida da tokenização e indexação.

---

## O operador `NEAR` — a chave para sua busca por proximidade

O operador `NEAR` é o que resolve seu requisito de "termos fora de ordem mas próximos":

```sql
-- Termos a até 10 palavras de distância, em qualquer ordem
SELECT * FROM docs WHERE docs MATCH 'NEAR(termoA termoB, 10)';

-- Múltiplos termos
SELECT * FROM docs WHERE docs MATCH 'NEAR(foo bar baz, 15)';
```

Sem o `NEAR`, a busca `termoA termoB` é um OR implícito — retorna documentos que contenham *pelo menos um* dos termos. Com `NEAR`, você exige que ambos estejam presentes e dentro de uma janela de N palavras.

---

## Limitações do FTS5 vs. SOTA (Tantivy/Meilisearch/Lucene)

| Recurso | FTS5 | Tantivy/Meilisearch |
|---------|------|---------------------|
| **BM25 ranking** | ❌ Não nativo | ✅ Sim |
| **Proximidade (`NEAR`)** | ✅ Sim | ✅ Sim |
| **Relevância por proximidade** | ⚠️ Binário (dentro/fora da janela) | ✅ Gradual (quanto mais próximo, maior score) |
| **Tokenização customizada** | ⚠️ Limitada | ✅ Totalmente customizável |
| **Stemming** | ⚠️ Via extensões | ✅ Nativo |
| **Busca fuzzy/typo tolerance** | ❌ Não | ✅ Sim |
| **Highlighting** | ✅ `snippet()` | ✅ Sim |
| **Indexação incremental** | ✅ Sim | ✅ Sim |
| **Performance em milhões de docs** | ⚠️ OK | ✅ Excelente |

O ponto crítico: **FTS5 não ranqueia por relevância BM25**. Ele retorna resultados que satisfazem o `NEAR`, mas a ordem é basicamente por `rowid` (a menos que você adicione `ORDER BY` manual). Isso significa que um documento onde os termos estão a 2 palavras de distância não é ranqueado mais alto que um onde estão a 10 palavras — ambos passam no filtro `NEAR(..., 10)` com o mesmo peso.

---

## Exemplo prático em Bun/JS

```javascript
import { Database } from "bun:sqlite";

const db = new Database("search.db");

// Criar tabela virtual FTS5
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
    path,      -- caminho do arquivo
    content,   -- conteúdo textual
    tokenize='porter unicode61'  -- stemming + unicode
  );
`);

// Inserir documentos (no seu caso, do crawler do HD)
function indexFile(path, content) {
  const stmt = db.prepare("INSERT INTO docs(path, content) VALUES (?, ?)");
  stmt.run(path, content);
}

// Buscar por proximidade
function searchNear(terms, maxDistance = 10) {
  const query = `NEAR(${terms.join(' ')}, ${maxDistance})`;
  const stmt = db.prepare(`
    SELECT
      path,
      snippet(docs, 0, '>>>', '<<<', '...', 32) as snippet,
      rank
    FROM docs
    WHERE docs MATCH ?
    ORDER BY rank
  `);
  return stmt.all(query);
}

// Uso
indexFile("/home/user/notes.txt", "O gato preto pulou no telhado. O cachorro late.");
indexFile("/home/user/report.md", "O preto gato é bonito. O telhado é alto.");

const results = searchNear(["gato", "telhado"], 5);
console.log(results);
// Retorna o primeiro arquivo (gato e telhado a 3 palavras de distância)
// mas NÃO ranqueia o primeiro acima do segundo — FTS5 não faz isso nativamente
```

---

## Como contornar a falta de BM25 no FTS5

Se você precisar de ranqueamento por relevância, pode implementar um **BM25 manual** ou híbrido:

### Opção 1: BM25 manual em JS
Calcular TF-IDF/BM25 por fora, usando estatísticas do FTS5:

```javascript
// FTS5 expõe estatísticas via tabela auxiliar
const stats = db.prepare(`
  SELECT term, cnt, doc_cnt FROM docs_data WHERE term IN ('gato', 'telhado')
`).all();
// Depois calcular BM25 em JS e reordenar resultados
```

### Opção 2: Coluna de score auxiliar
Adicionar uma coluna `score` que você atualiza com heurísticas próprias (ex: frequência do termo, proximidade estimada via posições).

### Opção 3: Usar `rank` do FTS5
O FTS5 tem uma função `rank` built-in, mas ela é simples — baseada apenas na frequência de termos no documento, não na proximidade entre eles.

---

## Tokenização: o ponto fraco

FTS5 tem tokenizadores built-in (`unicode61`, `porter`, `trigram`), mas são limitados. Para português, você provavelmente quer:

```sql
CREATE VIRTUAL TABLE docs USING fts5(
  content,
  tokenize='unicode61 "remove_diacritics=2"'  -- remove acentos
);
```

Ou criar um **tokenizador customizado em C** (complexo) ou pré-processar o texto em Bun antes de indexar (mais fácil).

---

## Quando FTS5 é a escolha certa

✅ **Use FTS5 se:**
- Você quer algo 100% em Bun, zero dependências
- O volume de dados é moderado (até alguns milhões de documentos)
- Você aceita ranqueamento simples ou vai implementar o seu próprio
- A proximidade binária (dentro/fora da janela) é suficiente

❌ **Não use FTS5 se:**
- Você precisa de ranqueamento por relevância sofisticado (BM25+proximidade gradual)
- Quer busca fuzzy (tolerância a erros de digitação)
- O volume é massivo (centenas de milhões de docs)
- Precisa de stemming avançado para português

---

## Arquitetura mínima para seu projeto com FTS5

```
┌─────────────────┐
│   Bun/JS CLI    │
│                 │
│  ├─ Crawler     │ → varre HD, extrai texto de arquivos
│  ├─ Preprocess  │ → normaliza texto (minúsculas, remove acentos)
│  ├─ Indexer     │ → insere no SQLite FTS5
│  └─ Search CLI  │ → recebe query, executa NEAR, mostra snippets
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  SQLite + FTS5  │  ← arquivo único .db, portátil
│  (search.db)    │
└─────────────────┘
```

Quer que eu monte um protótipo funcional dessa arquitetura? Posso fazer um script Bun completo que indexa um diretório e busca com `NEAR`.
