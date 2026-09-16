# Análise de relevância para segmentação de textos

**Created:** 3/17/2026 12:07:04
**Updated:** 3/17/2026 12:35:51
**Exported:** 8/30/2026 17:16:44
**Link:** [https://claude.ai/chat/29d9048a-e7e9-42cb-9dcc-8a9858d14fa8](https://claude.ai/chat/29d9048a-e7e9-42cb-9dcc-8a9858d14fa8)

## User:

> 3/17/2026 12:07:04

Considere que eu tenho um texto longo e estruturado como um livro. Dividido em capítulos, seções e parágrafos.

Além disso eu tenho outro texto menor (normalmente uma pergunta) e eu quero saber quais partes daquele texto são relevantes.

Como análise de sentimento só que de relevância.

Usado para segmentar um texto e compor um contexto antes de enviar para uma LLM.

## Assistant:

> 3/17/2026 12:07:30

Isso é **retrieval / relevance scoring** — um problema clássico de RAG (Retrieval-Augmented Generation). Deixa eu mapear as abordagens do mais simples ao mais sofisticado:

---

## O problema em termos precisos

Dado um corpus `D` (livro estruturado) e uma query `q`, você quer uma função:

```
score(chunk_i, q) → [0, 1]
```

...e retornar os `top-k` chunks para compor o contexto da LLM.

---

## Abordagens, da mais simples à mais poderosa

### 1. TF-IDF / BM25 — lexical
- Sem embeddings, sem GPU, extremamente rápido
- Falha em sinônimos e paráfrases ("carro" vs "automóvel")
- Bom baseline, especialmente para textos técnicos com jargão específico

### 2. Dense embeddings — semântico
Você embeda cada chunk e a query num espaço vetorial, depois mede **cosine similarity**.

```
embed(chunk_i) → vec_i  (feito offline, uma vez)
embed(q)       → vec_q  (feito no momento da query)
score = cosine(vec_i, vec_q)
```

Modelos bons pra isso: `text-embedding-3-small` (OpenAI), `voyage-3` (Anthropic), `nomic-embed` (local/open).

### 3. Cross-encoder / reranker — mais preciso, mais lento
Em vez de embeddings independentes, você passa `[query, chunk]` juntos num modelo que lê os dois ao mesmo tempo. Muito mais preciso, mas caro — usado como **segunda passagem** (retrieve 50, rerank → top 5).

Modelos: `cross-encoder/ms-marco-*` (HuggingFace), `cohere rerank`, `jina-reranker`.

### 4. Hybrid — BM25 + dense + rerank
O padrão de produção atual. Cada etapa filtra agressivamente:

```
BM25 → top-100 → dense rerank → top-20 → cross-encoder → top-5
```

---

## A questão do chunking (crítica)

O tamanho e a estratégia de chunk afeta mais o resultado do que o modelo de embedding.

| Estratégia | Quando usar |
|---|---|
| Fixed-size (512 tokens) | Baseline simples |
| Por parágrafo | Texto narrativo/literário |
| Por seção/capítulo | Documentos estruturados com hierarquia |
| **Hierárquico** | **Seu caso — livro com capítulos > seções > parágrafos** |
| Sliding window com overlap | Evita cortar contexto no meio |

No seu caso específico (texto estruturado como livro), o chunking **hierárquico** faz muito sentido: você indexa em múltiplos níveis e pode retornar um parágrafo mas expandir para a seção inteira se o score for alto.

---

## Para o seu caso concreto

Dado que você quer **compor contexto antes de enviar pra LLM**, a pipeline seria:

```
1. Parse do livro → extrai chunks com metadata (capítulo, seção, parágrafo)
2. Embed todos os chunks → armazena num vector store
3. Query chega → embed query → cosine similarity → top-k chunks
4. (opcional) rerank com cross-encoder
5. Monta contexto: chunks ordenados por posição no livro (não por score)
6. Envia pra LLM com o contexto montado
```

---

Qual dimensão você quer aprofundar? Implementação, escolha de modelo de embedding, estratégia de chunking pro texto estruturado, ou o vector store?

## User:

> 3/17/2026 12:15:03

Acho que em princípio tfidf serve. A ideia é só identificar capítulos e seções relevantes por proximidade semântica. BERT seria uma opção?

## Assistant:

> 3/17/2026 12:15:20

Sim, BERT é uma boa opção — e na prática fica num meio-termo interessante entre TF-IDF e um sistema RAG completo.

---

## TF-IDF vs BERT pra esse caso

**TF-IDF** funciona bem quando a query usa as mesmas palavras do texto. Para um livro técnico com terminologia consistente, costuma surpreender. Limitação: zero semântica — "comprar" e "adquirir" são palavras completamente diferentes.

**BERT como encoder** (especificamente `sentence-transformers`) resolve isso. Você usa o modelo não pra classificação, mas pra gerar embeddings de sentenças/parágrafos — é exatamente o "dense embeddings" que mencionei, só que com BERT como backbone.

---

## O que usar na prática

Não é BERT puro — é **Sentence-BERT** (`sentence-transformers`):

```python
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
# Esse modelo suporta português nativamente
```

Você embeda os chunks e a query, e mede cosine similarity. Simples assim.

Para português especificamente, os melhores modelos leves são:

| Modelo | Tamanho | Qualidade PT |
|---|---|---|
| `paraphrase-multilingual-MiniLM-L12-v2` | 118MB | boa |
| `paraphrase-multilingual-mpnet-base-v2` | 278MB | melhor |
| `neuralmind/bert-base-portuguese-cased` | 420MB | ótima, só PT |

---

## Pipeline completa e simples

```python
from sentence_transformers import SentenceTransformer, util

model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')

# 1. Indexar (feito uma vez)
chunks = [
    {"id": "cap1.sec2", "text": "..."},
    # ...
]
texts = [c["text"] for c in chunks]
embeddings = model.encode(texts, convert_to_tensor=True)

# 2. Query
query = "qual é o argumento principal sobre X?"
query_emb = model.encode(query, convert_to_tensor=True)

scores = util.cos_sim(query_emb, embeddings)[0]
top_k = scores.topk(5)

for score, idx in zip(top_k.values, top_k.indices):
    print(f"{score:.2f} — {chunks[idx]['id']}")
```

---

## Recomendação pra você

Dado que o texto é estruturado hierarquicamente, eu faria assim:

1. **Indexa em dois níveis** — seção inteira e parágrafos individuais
2. **Query contra parágrafos** — mais granular, score mais preciso
3. **Retorna a seção pai** do parágrafo com maior score

Assim você não manda um parágrafo solto pra LLM, manda o contexto completo da seção onde a resposta provavelmente está.

Quer que eu monte um exemplo completo com parsing de estrutura hierárquica?

## User:

> 3/17/2026 12:18:26

Quais as outras alternativas?

## Assistant:

> 3/17/2026 12:18:52

Além de TF-IDF e Sentence-BERT, o espaço de opções é bem amplo. Vou mapear por categoria:

---

## 1. Lexical (sem ML)

**BM25** — evolução do TF-IDF, padrão da indústria pra busca lexical. Penaliza documentos muito longos e tem melhor calibração de frequência. Biblioteca `rank_bm25` em Python. Para texto técnico com terminologia consistente, frequentemente bate embeddings densos.

**TF-IDF com n-gramas** — simples extensão do TF-IDF que captura "machine learning" como unidade, não duas palavras separadas.

---

## 2. Dense Embeddings (semântico)

**Sentence-BERT / sentence-transformers** — já discutido.

**OpenAI `text-embedding-3-small`** — API, sem infra local, muito boa qualidade. Custa dinheiro por token mas é trivial de usar.

**Voyage AI** (`voyage-3`) — embedding da Anthropic, considerado state-of-the-art em benchmarks de retrieval hoje.

**Cohere Embed** — outra API, tem suporte explícito a "search_document" vs "search_query" como tipos distintos de embedding, o que melhora a qualidade.

**Modelos locais open-source** — `nomic-embed-text`, `mxbai-embed-large`, `bge-m3` (suporta PT). Rodam via Ollama sem custo por token.

---

## 3. Sparse Learnt (meio-termo interessante)

**SPLADE** — modelo que aprende uma representação esparsa (como TF-IDF) mas com semântica (como BERT). Combina o melhor dos dois mundos. Menos popular porque é mais difícil de hospedar, mas qualidade excelente.

---

## 4. Cross-encoders / Rerankers

Não servem como primeira busca (são lentos — comparam query+chunk juntos), mas como **segunda passagem** são muito mais precisos que embeddings. Você recupera 50 candidatos com embedding e reordena com cross-encoder.

`cross-encoder/ms-marco-MiniLM-L-6-v2`, `cohere-rerank-3`, `jina-reranker-v2`.

---

## 5. LLM direto como ranker

Você manda a query + lista de chunks pro próprio modelo e pede pra ranquear. Caro e lento, mas surpreendentemente preciso. Faz sentido quando o corpus é pequeno o suficiente pra caber no contexto.

Para um livro inteiro, uma variante viável: manda só os títulos de capítulos/seções e pede pra LLM selecionar quais são relevantes — depois você recupera o conteúdo desses. Barato e funciona bem.

---

## 6. Híbrido

Combina lexical + dense com **Reciprocal Rank Fusion (RRF)** — você pega o ranking do BM25 e o ranking do embedding, funde as posições com uma fórmula simples. Geralmente bate qualquer abordagem isolada sem custo adicional de treinamento.

---

## Mapa de decisão pro seu caso

```
Texto em português?
├── Sim, e quero rodar local → bge-m3 ou multilingual MiniLM
├── Sim, e posso usar API   → Voyage ou OpenAI embeddings
└── Terminologia muito específica/técnica → BM25 primeiro, veja se já resolve

Corpus pequeno (livro único)?
└── LLM como ranker nos títulos é opção viável e simples

Quer máxima qualidade?
└── BM25 → top-50 → dense rerank → top-10 → cross-encoder → top-5
```

Para o seu caso — livro único, estrutura hierárquica clara, quero compor contexto — eu honestamente começaria com **BM25 + títulos de seção como LLM ranker**. É surpreendentemente eficaz e você implementa em 50 linhas.

## User:

> 3/17/2026 12:20:59

Tfidf+wordnet+bayesiana filter?

## Assistant:

> 3/17/2026 12:21:19

Combinação interessante. Vamos destrinchar o que cada peça faz e se a junção faz sentido.

---

## O que cada um contribui

**TF-IDF** — pontuação de relevância lexical. Identifica termos importantes por frequência relativa.

**WordNet** — expansão de query. Você enriquece a query com sinônimos/hipônimos antes de calcular TF-IDF. "Comprar" vira "comprar, adquirir, obter, purchase". Resolve parcialmente o problema de vocabulário sem precisar de embeddings.

**Filtro Bayesiano** — depende do que você quer dizer aqui. Há duas interpretações:

1. **Naive Bayes como classificador** — você treina um modelo que aprende "chunk relevante vs irrelevante" com exemplos. Problema: precisa de dados rotulados.

2. **Bayes como atualização de probabilidade** — você começa com um prior sobre quais seções são relevantes (baseado em posição, tamanho, título) e atualiza com o score TF-IDF como evidência. Isso é interessante e não precisa de treino.

---

## A combinação funciona?

Sim, e tem uma lógica coerente:

```
query
  └→ WordNet expansion → ["comprar", "adquirir", "obter", ...]
       └→ TF-IDF score por chunk
            └→ Bayes update com priors estruturais
                 └→ score final → top-k chunks
```

Os priors estruturais que fazem sentido pro seu caso:

- Capítulo com título semanticamente próximo à query → prior alto
- Seção de introdução/conclusão → prior levemente elevado
- Parágrafos muito curtos → prior baixo (menos informação)

---

## O problema central

**WordNet em português é fraco.** O `nltk.corpus.wordnet` tem cobertura razoável em inglês, mas em PT a base é a `OpenWordNet-PT` — cobertura menor, manutenção irregular. Para domínios técnicos específicos (direito, medicina, engenharia) a cobertura cai mais ainda.

Alternativas mais robustas para expansão semântica em PT:

- **Dicionário de sinônimos simples** — você monta um pequeno glossário do domínio do livro. Frágil mas controlado.
- **Word2Vec/FastText treinado no corpus** — aprende relações semânticas do próprio livro. Mais robusto que WordNet pra domínio específico.
- **Expansão via LLM** — você manda a query pra LLM e pede "liste 10 termos relacionados". Funciona surpreendentemente bem e é barato (uma chamada por query).

---

## Veredicto

A arquitetura é válida conceitualmente mas na prática o elo fraco é o WordNet em PT. Se o livro for em inglês, a combinação é sólida. Se for em PT, eu substituiria o WordNet por expansão via LLM — você mantém a mesma lógica pipeline mas com qualidade muito melhor na expansão.

Qual é o domínio e idioma do livro?

## User:

> 3/17/2026 12:22:36

About Word2vec

## Assistant:

> 3/17/2026 12:23:04

## Word2Vec no seu contexto

---

## O que é

Word2Vec treina embeddings de **palavras individuais** (não sentenças) a partir de coocorrência em janelas de contexto. A ideia central: palavras que aparecem nos mesmos contextos têm significados próximos.

Dois algoritmos de treino:

- **CBOW** — prediz a palavra central dado o contexto ao redor
- **Skip-gram** — prediz o contexto dado a palavra central. Melhor pra palavras raras.

O resultado é um vetor por palavra. "rei" - "homem" + "mulher" ≈ "rainha" — a propriedade algébrica clássica.

---

## Como usaria no seu pipeline

O Word2Vec não pontua chunks diretamente — ele serve pra **expansão de query e de termos do chunk**, substituindo o WordNet:

```
query: "aquisição de empresas"
  └→ Word2Vec most_similar("aquisição") → ["compra", "incorporação", "fusão", ...]
  └→ Word2Vec most_similar("empresas")  → ["companhias", "firmas", "negócios", ...]
       └→ query expandida entra no TF-IDF
```

Ou alternativamente, você agrega os vetores de palavras de um chunk pra ter um "vetor de documento":

```python
def embed_chunk(text, model):
    words = [w for w in text.split() if w in model]
    if not words:
        return np.zeros(model.vector_size)
    return np.mean([model[w] for w in words], axis=0)
```

Depois cosine similarity entre vetor da query e vetor do chunk. É um dense retrieval básico.

---

## Vantagens no seu caso

**Treinar no próprio corpus** é o ponto forte. Se o livro é técnico — direito, medicina, finanças — o Word2Vec aprende as relações semânticas *daquele domínio específico*, o que WordNet e até modelos genéricos não capturam bem.

```python
from gensim.models import Word2Vec

sentences = [chunk.split() for chunk in all_chunks]
model = Word2Vec(sentences, vector_size=100, window=5, min_count=2, sg=1)
# sg=1 → Skip-gram, melhor pra corpus pequeno
```

Um livro inteiro tem provavelmente 50k-200k palavras — é pequeno pra Word2Vec. O modelo vai aprender algo útil mas os vetores serão ruidosos comparados a modelos pré-treinados em bilhões de tokens.

---

## O problema fundamental

Word2Vec é **por palavra**, não por sentença. A agregação por média perde ordem, estrutura sintática e negação. "não recomendo" e "recomendo" ficam vetores parecidos.

Isso importa pra você? Depende da granularidade da query. Se as queries são **keywords e tópicos** ("fusões e aquisições", "capítulo sobre tributação"), a média funciona bem. Se as queries são **perguntas completas** ("quais são os riscos de uma aquisição hostil?"), a agregação por média perde informação importante.

---

## Comparação direta pra decisão

| | TF-IDF | TF-IDF + Word2Vec | Sentence-BERT |
|---|---|---|---|
| Semântica | nenhuma | expansão de termos | completa |
| Treino no corpus | não | sim, útil | não (pré-treinado) |
| Corpus pequeno | ótimo | ruidoso | ótimo |
| Queries como perguntas | fraco | médio | forte |
| Complexidade | mínima | média | média |
| Depende de GPU | não | não | não (MiniLM é leve) |

---

## Minha leitura

Para um livro único como corpus de treino, Word2Vec vai ser ruidoso. O ponto forte dele — aprender semântica do domínio — só se realiza bem com muito mais texto. Faria mais sentido usar um **Word2Vec ou FastText pré-treinado em PT** (ex: os vetores do NILC/USP treinados em corpus brasileiro grande) e aproveitar os vetores sem treinar do zero.

Mas se o objetivo é expansão de query simples, expansão via LLM é mais fácil e provavelmente melhor pro seu caso.

## User:

> 3/17/2026 12:29:00

Ok. Pense que eu estou filtrando turnos de uma conversa LLM e quero detectar aqueles que são relevantes. Quero evitar mandar a conversa inteira a cada chamada. Os turnos podem ser pré titulados e isf classificados pela propria ia a posteriori da geração. Nosso trabalho é só olhar o próximo token e expandir ou contrair turnos.

## Assistant:

> 3/17/2026 12:29:32

Agora ficou muito mais claro. Isso é um problema diferente — não é RAG, é **context window management** com seleção dinâmica de turnos.

---

## O problema reformulado

```
conversa = [t1, t2, t3, ... tN]  ← histórico crescente
próxima query = tN+1

objetivo: selecionar subconjunto de turnos que maximiza
          relevância sem estourar o context window
```

E você tem um sinal extra valioso: **títulos/classificações gerados pela própria IA** no momento da geração do turno.

---

## A arquitetura que emerge

### Estrutura de um turno

```typescript
type Turn = {
  id: number
  role: "user" | "assistant"
  content: string
  title?: string          // gerado pela IA a posteriori
  tags?: string[]         // classificação temática
  token_count: number
  relevance_score?: number // calculado dinamicamente
}
```

### O sinal do "próximo token"

Você está olhando o início de `tN+1` — os primeiros tokens da query chegando — pra decidir o contexto *antes* de completar a chamada. Isso é **prefill-time context selection**.

Os primeiros tokens já revelam:
- É uma continuação direta? ("e isso significa que...") → prioriza turnos recentes
- É uma referência temática? ("voltando ao que falamos sobre X") → busca por tag/título
- É pergunta nova? → pode contrair bastante o histórico

---

## Estratégia de expansão/contração

```
próximos tokens chegando
        ↓
   classificador leve (local, sem API)
        ↓
┌───────────────────────────────────┐
│ continuação → janela deslizante   │  últimos N turnos
│ referência  → busca por título    │  turnos específicos + recentes
│ novo tópico → só sistema + recente│  contrai agressivamente
└───────────────────────────────────┘
        ↓
   monta contexto dentro do budget
        ↓
   chama LLM
```

---

## O classificador leve do prefixo

Não precisa de modelo pesado. Os primeiros 10-20 tokens já são suficientes:

```typescript
function classifyPrefix(tokens: string[]): ContextStrategy {
  const text = tokens.join(" ").toLowerCase()

  if (/^(e |mas |então |isso |ele |ela |eles)/.test(text))
    return "continuation"   // pronome ou conjunção → continuação

  if (/(voltando|lembra|aquilo|mencionou|falamos)/.test(text))
    return "backreference"  // referência explícita ao passado

  if (/^(como |o que |qual |explica|define)/.test(text))
    return "new_topic"      // pergunta nova

  return "continuation"     // default conservador
}
```

Para o backreference, aí entra o TF-IDF/embedding leve contra os títulos dos turnos — corpus pequeno, rápido.

---

## Budget de tokens como variável de controle

```typescript
function selectTurns(
  turns: Turn[],
  strategy: ContextStrategy,
  budget: number
): Turn[] {

  const always_include = turns.filter(t => t.tags?.includes("system"))
  let remaining = budget - sum(always_include.map(t => t.token_count))

  const candidates = rank(turns, strategy)  // ordena por relevância

  const selected = []
  for (const turn of candidates) {
    if (turn.token_count <= remaining) {
      selected.push(turn)
      remaining -= turn.token_count
    }
  }

  // reordena por posição original — LLM precisa ver ordem cronológica
  return [...always_include, ...selected].sort((a, b) => a.id - b.id)
}
```

---

## A titulação a posteriori

Essa é a peça mais elegante do sistema. Depois de cada turno gerado, você faz uma chamada barata:

```
system: "Em 5 palavras, titule o assunto deste turno."
user: {conteúdo do turno}
```

Ou melhor ainda — você pede isso **inline** no próprio turno usando um formato estruturado:

```
<turn_meta>
  title: "Estratégia de chunking hierárquico"
  tags: ["rag", "chunking", "arquitetura"]
  continues_topic: true
</turn_meta>

{resposta normal aqui}
```

Você faz o parse do `<turn_meta>` e descarta antes de exibir. Zero chamadas extras.

---

## Conexão com o que você já construiu

Isso é exatamente o problema do **PROTO-CHAT** — o documento vivo com footer comprimido. A diferença é que agora a unidade de seleção é o turno individual com metadata semântica, não só o delta do documento. Os dois sistemas se complementam: o documento vivo captura o *estado*, a seleção de turnos captura o *raciocínio*.

Quer ir pra implementação de alguma peça específica?

## User:

> 3/17/2026 12:34:21

Sim. Eu estou pensando no proto-chat. A cada turno a IA classifica, resume e titula o turno e pode expandir ou colapsar turnos e seções. em cada prompt eu só quero prever quais turnos são relevantes para prover adiantado. Eu tenho esses 3 elementos título, resumo e tags. Quero uma coisa determinista, compacta eficiente e em javascript.

## Assistant:

> 3/17/2026 12:35:51

Vou direto pra implementação.

> Viewed file
>
> - Check frontend design skill
> - **Done**

O núcleo do sistema é um scorer determinista que combina os três sinais — título, resumo, tags — sem embeddings, sem API, zero dependências.

```jsx
// TurnRelevanceScorer — deterministic, zero-deps
// Scores turns by relevance to a query using title + summary + tags

// ─── Core Scoring Engine ──────────────────────────────────────────────────────

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\sáéíóúâêîôûãõàèìòùç]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
}

function buildIDF(corpus) {
  const df = {}
  const N = corpus.length
  for (const doc of corpus) {
    const seen = new Set(tokenize(doc))
    for (const term of seen) df[term] = (df[term] || 0) + 1
  }
  const idf = {}
  for (const [term, freq] of Object.entries(df)) {
    idf[term] = Math.log((N + 1) / (freq + 1)) + 1
  }
  return idf
}

function tfidfScore(queryTokens, fieldText, idf) {
  if (!fieldText) return 0
  const docTokens = tokenize(fieldText)
  const tf = {}
  for (const t of docTokens) tf[t] = (tf[t] || 0) + 1
  const len = docTokens.length || 1
  let score = 0
  for (const qt of queryTokens) {
    if (tf[qt]) score += (tf[qt] / len) * (idf[qt] || 1)
  }
  return score
}

function tagOverlap(queryTokens, tags) {
  if (!tags?.length) return 0
  const tagTokens = new Set(tags.flatMap(t => tokenize(t)))
  const hits = queryTokens.filter(qt => tagTokens.has(qt)).length
  return hits / (queryTokens.length || 1)
}

// Weights: title > tags > summary (titles are dense signal)
const WEIGHTS = { title: 0.45, tags: 0.35, summary: 0.20 }

function scoreTurn(turn, queryTokens, idf) {
  const titleScore   = tfidfScore(queryTokens, turn.title,   idf)
  const summaryScore = tfidfScore(queryTokens, turn.summary, idf)
  const tagsScore    = tagOverlap(queryTokens, turn.tags)

  return (
    WEIGHTS.title   * titleScore +
    WEIGHTS.tags    * tagsScore  +
    WEIGHTS.summary * summaryScore
  )
}

function selectTurns(turns, query, opts = {}) {
  const {
    tokenBudget    = 4000,
    topK           = 5,
    recentWindow   = 3,    // always include last N turns
    threshold      = 0.01, // min score to be considered
  } = opts

  const queryTokens = tokenize(query)

  // Build IDF corpus from titles + summaries only (compact signal)
  const corpus = turns.map(t => `${t.title || ''} ${t.summary || ''}`)
  const idf = buildIDF(corpus)

  const recent = new Set(turns.slice(-recentWindow).map(t => t.id))

  const scored = turns.map(turn => ({
    turn,
    score: recent.has(turn.id) ? Infinity : scoreTurn(turn, queryTokens, idf),
  }))

  // Sort by score desc, filter threshold
  const candidates = scored
    .filter(s => s.score >= threshold || recent.has(s.turn.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  // Greedily fill token budget
  let remaining = tokenBudget
  const selected = []
  for (const { turn, score } of candidates) {
    const cost = turn.tokenCount || Math.ceil((turn.content?.length || 200) / 4)
    if (cost <= remaining) {
      selected.push({ ...turn, _score: score === Infinity ? 1 : score })
      remaining -= cost
    }
  }

  // Restore chronological order for LLM
  return selected.sort((a, b) => a.id - b.id)
}

// ─── Demo UI ──────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback } from "react"

const SAMPLE_TURNS = [
  { id: 1,  title: "Introdução ao sistema PROTO-CHAT",         summary: "Definição da arquitetura geral, documento vivo e footer comprimido",       tags: ["proto-chat","arquitetura","contexto"],           tokenCount: 320, content: "" },
  { id: 2,  title: "Estratégia de chunking hierárquico",       summary: "Divisão do texto em capítulos seções e parágrafos para retrieval",          tags: ["chunking","rag","retrieval"],                    tokenCount: 280, content: "" },
  { id: 3,  title: "TF-IDF e expansão semântica",              summary: "Comparação entre TF-IDF BM25 e Word2Vec para scoring de relevância",        tags: ["tfidf","bm25","word2vec","nlp"],                 tokenCount: 410, content: "" },
  { id: 4,  title: "Sentence-BERT e embeddings densos",        summary: "Modelos multilinguais para português e pipeline de cosine similarity",       tags: ["bert","embeddings","português","similarity"],    tokenCount: 350, content: "" },
  { id: 5,  title: "Pipeline híbrida BM25 + dense + rerank",   summary: "Fusão de rankings lexical e semântico com Reciprocal Rank Fusion",          tags: ["hybrid","rerank","rrf","pipeline"],              tokenCount: 290, content: "" },
  { id: 6,  title: "Seleção dinâmica de turnos",               summary: "Context window management e classificação do prefixo da query",             tags: ["context","turnos","prefill","classificação"],    tokenCount: 380, content: "" },
  { id: 7,  title: "Titulação e classificação a posteriori",   summary: "IA gera título resumo e tags ao final de cada turno inline no conteúdo",    tags: ["título","resumo","tags","metadata"],             tokenCount: 260, content: "" },
  { id: 8,  title: "Budget de tokens e expansão de contexto",  summary: "Algoritmo guloso para selecionar turnos dentro do limite de tokens",        tags: ["tokens","budget","seleção","guloso"],            tokenCount: 300, content: "" },
  { id: 9,  title: "Word2Vec treinado no corpus próprio",      summary: "Limitações de corpus pequeno e alternativa com vetores pré-treinados NILC",  tags: ["word2vec","corpus","nilc","português"],          tokenCount: 240, content: "" },
  { id: 10, title: "Implementação JavaScript determinista",    summary: "Scorer sem dependências usando TF-IDF sobre título resumo e tags",          tags: ["javascript","implementação","scorer","tfidf"],   tokenCount: 320, content: "" },
]

const TAG_COLORS = [
  ["#e8f4f8","#2980b9"], ["#fef9e7","#d68910"], ["#eafaf1","#1e8449"],
  ["#fdf2f8","#8e44ad"], ["#fef5e4","#ca6f1e"], ["#eaf2ff","#1a5276"],
]
function tagColor(tag) {
  let h = 0; for (const c of tag) h = (h * 31 + c.charCodeAt(0)) % TAG_COLORS.length
  return TAG_COLORS[h]
}

export default function App() {
  const [query, setQuery]           = useState("")
  const [budget, setBudget]         = useState(2000)
  const [topK, setTopK]             = useState(5)
  const [recentWindow, setRecent]   = useState(2)
  const [turns]                     = useState(SAMPLE_TURNS)

  const result = useMemo(() => {
    if (!query.trim()) return { selected: [], scored: [] }
    const queryTokens = tokenize(query)
    const corpus = turns.map(t => `${t.title || ''} ${t.summary || ''}`)
    const idf = buildIDF(corpus)
    const recent = new Set(turns.slice(-recentWindow).map(t => t.id))
    const scored = turns.map(turn => ({
      turn,
      score: recent.has(turn.id) ? null : scoreTurn(turn, queryTokens, idf),
      isRecent: recent.has(turn.id),
    })).sort((a, b) => {
      if (a.isRecent && !b.isRecent) return 1
      if (!a.isRecent && b.isRecent) return -1
      return (b.score||0) - (a.score||0)
    })
    const selected = selectTurns(turns, query, { tokenBudget: budget, topK, recentWindow, threshold: 0.01 })
    return { selected, scored }
  }, [query, budget, topK, recentWindow, turns])

  const selectedIds = useMemo(() => new Set(result.selected.map(t => t.id)), [result.selected])
  const totalTokens = result.selected.reduce((s, t) => s + t.tokenCount, 0)
  const maxScore    = Math.max(...result.scored.map(s => s.score || 0), 0.001)

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", background: "#0d0d0d", minHeight: "100vh", color: "#e0e0e0", padding: "0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        input[type=range] { -webkit-appearance: none; appearance: none; height: 2px; background: #2a2a2a; border-radius: 1px; outline: none; cursor: pointer; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: #4af; border-radius: 50%; }
        .tag { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 10px; font-weight: 500; letter-spacing: 0.04em; margin: 2px 2px 0 0; }
        .turn-row { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: start; padding: 10px 14px; border-bottom: 1px solid #1a1a1a; transition: background 0.15s; cursor: default; }
        .turn-row:hover { background: #141414; }
        .turn-row.selected { background: #0a1a20; border-left: 2px solid #4af; }
        .bar { height: 3px; background: #1e1e1e; border-radius: 2px; margin-top: 5px; overflow: hidden; }
        .bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
        .label { font-size: 10px; color: #555; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
        .val { font-size: 13px; color: #ccc; }
        textarea { background: #111; border: 1px solid #222; color: #e0e0e0; font-family: 'IBM Plex Mono', monospace; font-size: 13px; padding: 10px 12px; border-radius: 4px; width: 100%; resize: none; outline: none; transition: border-color 0.2s; }
        textarea:focus { border-color: #4af; }
        .section-head { padding: 8px 14px; background: #111; font-size: 10px; letter-spacing: 0.12em; color: #555; text-transform: uppercase; border-bottom: 1px solid #1a1a1a; display: flex; justify-content: space-between; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.18em", color: "#4af", textTransform: "uppercase", fontWeight: 600 }}>PROTO-CHAT</span>
        <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.1em" }}>/ turn relevance scorer</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", height: "calc(100vh - 53px)" }}>

        {/* Left — turns list */}
        <div style={{ overflowY: "auto", borderRight: "1px solid #1a1a1a" }}>
          <div className="section-head">
            <span>turns ({turns.length})</span>
            {query && <span style={{ color: "#4af" }}>{selectedIds.size} selected · {totalTokens} tok</span>}
          </div>

          {result.scored.length === 0
            ? turns.map(turn => (
                <div key={turn.id} className="turn-row">
                  <span style={{ fontSize: 10, color: "#444", paddingTop: 2 }}>#{turn.id}</span>
                  <div>
                    <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>{turn.title}</div>
                    <div style={{ fontSize: 11, color: "#555", lineHeight: 1.4 }}>{turn.summary}</div>
                    <div style={{ marginTop: 5 }}>{turn.tags.map(tag => {
                      const [bg, fg] = tagColor(tag)
                      return <span key={tag} className="tag" style={{ background: bg+"22", color: fg+"cc", border: `1px solid ${fg}33` }}>{tag}</span>
                    })}</div>
                  </div>
                  <span style={{ fontSize: 10, color: "#333", whiteSpace: "nowrap" }}>{turn.tokenCount}t</span>
                </div>
              ))
            : result.scored.map(({ turn, score, isRecent }) => {
                const sel = selectedIds.has(turn.id)
                const pct = isRecent ? 100 : (score / maxScore) * 100
                const barColor = isRecent ? "#2a6" : sel ? "#4af" : "#2a3a4a"
                return (
                  <div key={turn.id} className={`turn-row${sel ? " selected" : ""}`}>
                    <span style={{ fontSize: 10, color: sel ? "#4af" : "#444", paddingTop: 2 }}>#{turn.id}</span>
                    <div>
                      <div style={{ fontSize: 12, color: sel ? "#cce8ff" : "#888", marginBottom: 3 }}>{turn.title}</div>
                      <div style={{ fontSize: 11, color: "#555", lineHeight: 1.4 }}>{turn.summary}</div>
                      <div style={{ marginTop: 5 }}>{turn.tags.map(tag => {
                        const [bg, fg] = tagColor(tag)
                        return <span key={tag} className="tag" style={{ background: bg+"22", color: fg+(sel?"dd":"66"), border: `1px solid ${fg}${sel?"44":"22"}` }}>{tag}</span>
                      })}</div>
                      <div className="bar"><div className="bar-fill" style={{ width: `${pct}%`, background: barColor }} /></div>
                    </div>
                    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: 10, color: isRecent ? "#2a6" : sel ? "#4af" : "#333" }}>
                        {isRecent ? "recent" : score.toFixed(3)}
                      </div>
                      <div style={{ fontSize: 10, color: "#333", marginTop: 2 }}>{turn.tokenCount}t</div>
                    </div>
                  </div>
                )
              })}
        </div>

        {/* Right — controls + output */}
        <div style={{ display: "flex", flexDirection: "column", overflowY: "auto" }}>
          {/* Query */}
          <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #1a1a1a" }}>
            <div className="label" style={{ marginBottom: 6 }}>query / próximo turno</div>
            <textarea
              rows={3}
              placeholder="Digite a query ou prefixo do próximo turno..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          {/* Controls */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { label: "token budget", val: budget, set: setBudget, min: 200, max: 8000, step: 100 },
              { label: "top-k candidates", val: topK, set: setTopK, min: 1, max: 10, step: 1 },
              { label: "recent window", val: recentWindow, set: setRecent, min: 0, max: 5, step: 1 },
            ].map(({ label, val, set, min, max, step }) => (
              <div key={label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span className="label" style={{ marginBottom: 0 }}>{label}</span>
                  <span style={{ fontSize: 11, color: "#4af" }}>{val}</span>
                </div>
                <input type="range" min={min} max={max} step={step} value={val} onChange={e => set(Number(e.target.value))} style={{ width: "100%" }} />
              </div>
            ))}
          </div>

          {/* Output */}
          {query && result.selected.length > 0 && (
            <div style={{ padding: "14px 16px", flex: 1 }}>
              <div className="label" style={{ marginBottom: 10 }}>contexto montado ({totalTokens} / {budget} tok)</div>
              <div style={{ background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: 4, padding: "10px 12px" }}>
                {result.selected.map((turn, i) => (
                  <div key={turn.id} style={{ marginBottom: i < result.selected.length - 1 ? 10 : 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 10, color: "#4af" }}>#{turn.id} {turn.title}</span>
                      <span style={{ fontSize: 10, color: "#444" }}>{turn.tokenCount}t</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#555", lineHeight: 1.5 }}>{turn.summary}</div>
                    {i < result.selected.length - 1 && <div style={{ borderBottom: "1px solid #1a1a1a", marginTop: 8 }} />}
                  </div>
                ))}
              </div>

              {/* Token bar */}
              <div style={{ marginTop: 10 }}>
                <div className="bar" style={{ height: 4 }}>
                  <div className="bar-fill" style={{ width: `${Math.min(100, (totalTokens/budget)*100)}%`, background: totalTokens > budget * 0.9 ? "#e74" : "#4af" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: "#444" }}>0</span>
                  <span style={{ fontSize: 10, color: "#444" }}>{budget}</span>
                </div>
              </div>
            </div>
          )}

          {query && result.selected.length === 0 && (
            <div style={{ padding: 20, fontSize: 11, color: "#444", textAlign: "center" }}>
              nenhum turno acima do threshold
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

A lógica central em ~80 linhas, sem dependências:

**`tokenize`** — normaliza pra lowercase, remove pontuação, filtra stop-words curtas.

**`buildIDF`** — constrói o dicionário IDF uma vez contra o corpus de títulos+resumos. Corpus pequeno, instantâneo.

**`scoreTurn`** — combina três sinais com pesos fixos: título (0.45) > tags (0.35) > resumo (0.20). Título é sinal mais denso; resumo é verboso demais pra ter peso alto.

**`selectTurns`** — ordena por score, garante janela recente com `Infinity`, preenche o budget com algoritmo guloso, restaura ordem cronológica no final.

Os pesos `WEIGHTS` são o principal knob — você ajusta conforme a qualidade dos títulos/resumos que a IA gera. Quer exportar só o scorer como módulo `.js` limpo?

Powered by Claude Exporter (https://www.ai-chat-exporter.net)
