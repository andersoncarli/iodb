// suite completa roda standalone, sem nenhum projeto hospedeiro no path
// (TEST.yaml exclui utils/AI/llm.call.t.js — chamada LLM real, fora do
// escopo do io-db, falharia aqui por falta de rede/API key)
eval("bun utest/utest.js .", (out, r) => check(r.exitCode, 0))

// DB() resolve namespace e persiste um registro via kv()
eval(
  "bun -e \"import('./db.js').then(async ({DB}) => { const os=await import('os'); const fs=await import('fs'); const path=await import('path'); const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iodb-eval-')); const db=DB('io',{path:dir}); const kv=db.kv(); kv.in({hello:'world'}); console.log(kv.get('hello'))})\"",
  (out) => check(out.includes('world'))
)
