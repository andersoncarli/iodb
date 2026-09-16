// Roteiro de avaliacao — feature 5.5: quebra deterministica de conversas de
// fswatch/chats/ em fragmentos por assunto, via TF-IDF + headings markdown.

// 1. Os dois arquivos que a feature promete.
eval("test -f tools/splitchat.js && test -f tools/splitchat.t.js && echo OK", (out) =>
  check(out.includes("OK"))
)

// 2. A suite do projeto inteira passa.
eval("utest .", (out, r) => {
  check(r.exitCode, 0)
  check(!out.includes('✘'))
})

// 3. Determinismo: rodar o CLI duas vezes sobre o mesmo arquivo real produz
//    fragmentos byte-idênticos.
eval(
  "rm -rf /tmp/splitchat-eval-a /tmp/splitchat-eval-b && " +
  "node tools/splitchat.js fswatch/chats/260910-fswatch-iodb.md >/dev/null && " +
  "cp -r fswatch/chats/260910-fswatch-iodb /tmp/splitchat-eval-a && " +
  "rm -rf fswatch/chats/260910-fswatch-iodb && " +
  "node tools/splitchat.js fswatch/chats/260910-fswatch-iodb.md >/dev/null && " +
  "cp -r fswatch/chats/260910-fswatch-iodb /tmp/splitchat-eval-b && " +
  "diff -rq /tmp/splitchat-eval-a /tmp/splitchat-eval-b && echo IDENTICO",
  (out) => check(out.includes("IDENTICO"))
)

// 4. Os 3 arquivos originais de chat permanecem intactos (nenhuma modificacao
//    registrada pelo git — a feature so ADICIONA subpastas).
eval("git status --porcelain fswatch/chats/*.md", (out) =>
  check(out.trim(), "")
)

// 5. As 3 conversas reais foram fragmentadas (subpastas existem e tem pelo
//    menos 2 fragmentos cada — prova de que o corte por assunto rodou nos
//    dados reais, nao so no fixture sintetico do teste unitario).
eval(
  "for d in fswatch/chats/260910-fswatch-iodb fswatch/chats/260913-armazeanar-arvore-eficient fswatch/chats/260914-analizar-script-topologico; do " +
  "ls \"$d\"/*.md 2>/dev/null | wc -l; done",
  (out) => {
    const counts = out.trim().split('\n').map(Number)
    check(counts.length, 3)
    check(counts.every(n => n >= 2), true)
  }
)

// 6. ESCOPO PRESERVADO: os arquivos desta feature (tools/ + subpastas novas
//    em fswatch/chats/) estao DENTRO do escopo declarado do sprint aberto —
//    o mesmo comparador que o `close` usa antes de encenar.
eval(
  "sprint files --drift tools/splitchat.js tools/splitchat.t.js fswatch/chats/260910-fswatch-iodb fswatch/chats/260913-armazeanar-arvore-eficient fswatch/chats/260914-analizar-script-topologico 2>&1",
  (out) => check(!out.includes('FORA'))
)
