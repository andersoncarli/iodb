// Roteiro de avaliacao — feature 6.5: consolida tree0+typed sobre fswatch.

// tree0 arquivado, fora do caminho ativo.
eval("test -d fswatch/tree0 && echo existe || echo ausente", (out) => {
  check(out.trim() === 'ausente')
})
eval("test -d fswatch/docs/archive/tree0 && echo existe", (out) => {
  check(out.includes('existe'))
})

// tree.js resolve o header via typed.js — nao mais uma string hardcoded. O
// header emitido continua trazendo Schema/ftype/pk resolvidos pelo Type Tree.
eval("grep -c \"import { Typed, builtins } from './typed.js'\" fswatch/typed/tree.js", (out) => {
  check(Number(out.trim()) === 1)
})
eval("node -e \"require('fs').mkdirSync('/tmp/eval-6.5-tree',{recursive:true})\" && bun fswatch/typed/tree.js /tmp/eval-6.5-tree /tmp/eval-6.5-tree.csv >/dev/null && head -8 /tmp/eval-6.5-tree.csv", (out) => {
  check(out.includes('Schema={type:ftype'))
  check(out.includes('ftype={d:dir'))
})

// typed.js resolve corretamente tipos postfix compostos (bug corrigido nesta
// feature: pk = i autoinc, node-id-delta = node-id delta).
eval("bun -e \"import {Typed,builtins} from './fswatch/typed/typed.js'; const t=Typed(); builtins(t); t.define('i','integer'); t.define('pk','i autoinc'); t.define('node-id','pk'); t.define('node-id-delta','node-id delta'); const x=t.resolve('node-id-delta'); console.log(x.kind, x.base.kind, x.base.base.base)\"", (out) => {
  check(out.trim() === 'delta autoinc integer')
})

// fswatch.js aceita bootstrap:'typed' e produz a MESMA identidade (dev:ino) e
// o mesmo shape de entrada que o Scanner padrao — nao so "roda sem erro".
eval("grep -c \"TypedScanner\" fswatch/fswatch.js", (out) => {
  check(Number(out.trim()) >= 1)
})
eval("cd fswatch && utest fswatch.t.js --force 2>&1 | tail -3", (out) => {
  check(out.includes('✔'))
  check(!out.includes('✘'))
})

// A suite inteira do projeto continua verde com as mudancas.
eval("utest . 2>&1 | tail -3", (out) => {
  check(out.includes('coverage'))
  check(!/✘\s*[1-9]/.test(out))
})
