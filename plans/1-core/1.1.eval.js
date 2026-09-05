// suite propria roda via utest peer (../utest), so os 12 arquivos de iodb —
// utils/utest nao sao mais submodule aninhado, entao nao aparecem na varredura
eval("bun ../utest/utest.js .", (out, r) => check(r.exitCode, 0))

// DB() resolve namespace e persiste um registro via kv()
eval(
  "bun -e \"import('./db.js').then(async ({DB}) => { const os=await import('os'); const fs=await import('fs'); const path=await import('path'); const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iodb-eval-')); const db=DB('io',{path:dir}); const kv=db.kv(); kv.in({hello:'world'}); console.log(kv.get('hello'))})\"",
  (out) => check(out.includes('world'))
)
