# Índices e Técnicas de Valores

## Prompt Original

Quais são as técnicas mais comuns e mais eficientes de contrução e manutenção de arquivos de índices de valores? Suponha que eu tenho um storage kv retornando objetos pelos seus hashes. Agora eu quero indexar campos dentro do arquivo.

## Resposta

Sim. Se o seu storage já resolve:

```text
hash → objeto
```

então o índice secundário pode ser pensado simplesmente como:

```text
valor → [hash, hash, hash...]
```

Mas há algumas técnicas importantes para tornar isso realmente eficiente.

### 1. Índice invertido — o modelo mais simples

Para um campo `age`:

```text
30 → [#a1, #b7, #f2]
31 → [#c4, #d8]
32 → [#e1]
```

No disco, você pode ter algo como:

```text
[value] [posting-list]
```

onde `posting-list` é a lista dos hashes/IDs dos objetos que possuem aquele valor.

Para campos discretos — `status`, `country`, `type`, `category` etc. — isso é extremamente eficiente.

A consulta:

```js
users.where({ status: 'active' })
```

vira essencialmente:

```text
index.status["active"] → IDs → KV.get(ID)
```

---

### 2. Não indexar o hash diretamente

Eu faria uma pequena distinção.

Se seu KV já possui um identificador físico compacto:

```text
object-id → object
```

o índice deveria armazenar **IDs**, não os hashes completos.

Por exemplo:

```text
id = 123456
```

em vez de:

```text
id = "a91f7c...128 caracteres..."
```

O índice passa a ser muito menor e pode usar arrays compactos:

```text
30 → [12, 18, 21, 47, 91]
```

e então:

```text
12 → hash → objeto
```

Se o próprio hash já é o ID físico, tudo bem, mas vale considerar uma tabela de IDs.

---

### 3. Valores ordenados: B+Tree / sorted index

O modelo anterior não resolve bem:

```js
age > 30
age >= 30 && age < 40
name >= 'Anderson' && name < 'Andrew'
```

Para isso, a estrutura clássica é:

```text
B+Tree

         [30 | 50 | 80]
        /    |    |    \
    ...    ...   ...   ...
```

Cada folha contém:

```text
value → posting list
```

Por exemplo:

```text
30 → [12, 18]
31 → [7]
32 → [4, 9, 21]
33 → [17]
```

A grande vantagem é que as folhas são ordenadas e normalmente encadeadas:

```text
[20] → [21] → [22] → [23] → [24] ...
```

Então um range scan é muito barato.

---

### 4. Hash index

Se você só precisa de:

```js
where({ email: 'x@y.com' })
```

e não precisa de:

```js
email > ...
email BETWEEN ...
ORDER BY email
```

um hash index pode ser ainda mais simples:

```text
hash(value) → posting list
```

Mas existe uma sutileza: **hash collision**.

Então normalmente:

```text
hash(value) → candidate IDs
```

e você confirma o valor real no registro.

Para strings longas isso pode ser interessante.

---

### 5. Bitmap index

Para campos com **baixa cardinalidade**, bitmap é excelente.

Imagine:

```text
status:
active
inactive
blocked
```

Em vez de:

```text
active → [1,2,4,8,9,13,...]
```

você pode ter:

```text
active   → 101101001...
inactive → 010010100...
blocked  → 000000010...
```

Então:

```sql
status = active AND country = BR
```

vira simplesmente:

```text
bitmap(active) AND bitmap(BR)
```

Isso é absurdamente rápido.

É uma técnica muito usada em engines analíticas/OLAP.

---

## 6. O ponto mais interessante para o seu caso: posting lists

Pelo que você estava descrevendo na conversa anterior, eu acho que seu modelo pode ser ainda mais simples.

Imagine:

```text
index.age

30 → [100, 102, 108, 119]
31 → [101, 107]
32 → [103, 104, 110]
```

Isso é essencialmente um **inverted index**.

E você pode armazenar a posting list de maneira compacta:

```text
[100,102,108,119]
```

como deltas:

```text
[100,2,6,11]
```

e usar varints:

```text
64-bit ID
    ↓
delta encoding
    ↓
varint
```

Isso reduz drasticamente o tamanho quando os IDs são ordenados.

---

# Manutenção: aqui está o problema real

Construir o índice é fácil.

O difícil é:

```text
insert
update
delete
```

Suponha:

```json
{ "id": 10, "age": 30 }
```

e depois:

```json
{ "id": 10, "age": 31 }
```

Você precisa fazer:

```text
age[30] -= 10
age[31] += 10
```

Se o índice estiver em arrays imutáveis, modificar isso frequentemente pode ser caro.

Por isso existem três estratégias muito comuns.

### A. Atualização in-place

Manter:

```text
30 → [1,2,3,4,5]
```

e remover `3`.

Problema:

```text
[1,2,4,5]
```

pode exigir movimentação de dados.

Bom para índices pequenos.

---

### B. Append + tombstone

Em vez de remover imediatamente:

```text
30 → [1,2,3,4,5]
```

você registra:

```text
remove(age=30,id=3)
add(age=31,id=3)
```

Depois:

```text
30 → [1,2,4,5]
31 → [...,3]
```

Uma operação de **compaction** periodicamente reconstrói as posting lists.

Isso é muito interessante para um KV append-only.

---

### C. LSM-style index

Essa é provavelmente a técnica mais interessante para o storage que você está imaginando.

Você mantém pequenos índices imutáveis:

```text
index-001
index-002
index-003
...
```

Novas operações vão para o índice mais recente:

```text
index-004:
age=30 → add 17
age=30 → delete 21
age=31 → add 21
```

Periodicamente:

```text
index-001
index-002
index-003
index-004
       ↓
    merge
       ↓
index-005
```

É essencialmente a ideia de **LSM Tree**, aplicada ao índice secundário.

---

# Uma arquitetura que combina muito com seu KV

Eu separaria fisicamente:

```text
objects/
    hash → object

indexes/
    age/
    name/
    country/
    status/
```

E cada índice teria:

```text
key → posting-list
```

Por exemplo:

```text
indexes/age

30 → [12,18,21,47]
31 → [7,9]
32 → [4,11,13]
```

Para igualdade:

```text
O(log N)    // encontrar value
O(K)        // percorrer K resultados
```

Para range, se ordenado:

```text
O(log N + K)
```

onde `K` é a quantidade de objetos retornados.

Isso é praticamente o melhor que você pode esperar: o custo inevitável passa a ser proporcional ao resultado.

---

## E há uma otimização importante

Você não precisa necessariamente fazer:

```text
value → array de IDs
```

Você pode fazer:

```text
value → [offset, length]
```

e ter um grande **posting file**:

```text
posting.dat

[12,18,21,47,7,9,4,11,13,...]
```

O índice:

```text
30 → { offset: 0, length: 4 }
31 → { offset: 4, length: 2 }
32 → { offset: 6, length: 3 }
```

Isso transforma o índice em algo muito parecido com:

```text
B+Tree
    ↓
value → slice
        ↓
   posting file
        ↓
   object IDs
        ↓
      KV
```

É compacto, cache-friendly e excelente para leitura.

**Para o seu IODB, eu investigaria justamente essa arquitetura:** KV append-only + índices secundários invertidos + posting files compactos + compaction. Ela preserva a simplicidade do seu modelo de objetos enquanto permite evoluir depois para B+Tree/range indexes sem mudar a semântica do storage.
