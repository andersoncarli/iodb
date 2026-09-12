// Roteiro de avaliacao — feature 1.6: flush-o-dirty-nao-o-store.
// flushPages() (keyed) lia o store inteiro a cada flush so para achar onde
// UMA chave dirty entra numa lista ordenada. Como a projecao e ordenada,
// chaves antes da menor chave suja nao mudam de valor nem de posicao — nao
// precisam ser relidas nem re-escritas.

// 1. A suite inteira, verde — inclui o caso de tombstone (delete) que expos o
//    defeito do corte por CHAVE em vez de por PAGINA durante a implementacao.
eval("bun ../utest/utest.js .", (out, r) => check(r.exitCode, 0))

// 2. keyIndex existe e e usado no branch keyed do flush.
eval("grep -c 'let keyIndex' src/paged-projection.js", (out) => check(out.trim(), "1"))
eval("grep -c 'ensureKeyIndex' src/paged-projection.js", (out) => check(Number(out.trim()) >= 2))

// 3. O prefixo antes do corte e copiado CRU — sem decodeKeyed/encodeKeyed —
//    e so o sufixo a partir da pagina do corte e recodificado.
eval("grep -c 'prefixLines.push' src/paged-projection.js", (out) => check(out.trim(), "1"))

// 4. Add-no-fim fica ~flat conforme N cresce (nao mais O(store)): a razao
//    entre o tempo de inserir no fim com N=3200 e com N=400 fica bem abaixo
//    de 8x (que seria proporcional ao tamanho do store, o sintoma antigo).
eval(
  "bun -e \"import('./src/paged-projection.js').then(async ({PagedProjection}) => { const fs=require('fs'),os=require('os'),p=require('path'); function bench(n){ const d=fs.mkdtempSync(p.join(os.tmpdir(),'e16-')); const proj=PagedProjection(p.join(d,'s'),{layout:'keyed'}); for(let i=0;i<n;i++) proj['k'+String(i).padStart(7,'0')]={i}; proj.__flushPages(); const t0=performance.now(); proj['k'+String(n).padStart(7,'0')+'z']={added:true}; proj.__flushPages(); const dt=performance.now()-t0; fs.rmSync(d,{recursive:true,force:true}); return dt } const small=bench(400), big=bench(3200); console.log(JSON.stringify({small,big,ratio:big/small}))})\"",
  (out) => {
    const m = out.match(/\"ratio\":([\d.]+)/)
    check(!!m)
    check(Number(m[1]) < 4)
  }
)

// 5. Delete de uma chave numa pagina compartilhada com chaves intactas nao
//    "ressuscita" a chave deletada — o defeito medido durante a implementacao
//    (corte por chave em vez de por pagina copiava a pagina inteira crua).
eval(
  "bun -e \"import('./src/paged-projection.js').then(async ({PagedProjection}) => { const fs=require('fs'),os=require('os'),p=require('path'); const d=fs.mkdtempSync(p.join(os.tmpdir(),'e16d-')); const proj=PagedProjection(p.join(d,'s'),{layout:'keyed',pageSize:4096}); proj.a=1; proj.b=2; proj.c=3; proj.__flushPages(); delete proj.b; proj.__flushPages(); const q=PagedProjection(p.join(d,'s'),{layout:'keyed',pageSize:4096}); console.log(JSON.stringify({hasB:('b' in q), a:q.a, c:q.c})); fs.rmSync(d,{recursive:true,force:true})})\"",
  (out) => {
    check(out.includes('\"hasB\":false'))
    check(out.includes('\"a\":1'))
    check(out.includes('\"c\":3'))
  }
)
