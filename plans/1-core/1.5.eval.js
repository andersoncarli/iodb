// Roteiro de avaliacao — feature 1.5: criacao de chave e indice.
// O `.index` era write-only: gravava `prefixes=` e `levels`, e ninguem lia de
// volta. Cada escritor reconstruia o prefixSet relendo o log — para responder
// uma pergunta que o arquivo ao lado ja sabia. A feature faz o `.index` virar a
// fonte de verdade da alocacao de nomes.

// 1. A suite inteira, verde. As 7 falhas de verify().valid herdadas do 008 sao
//    desta feature, nao do lock.
eval("bun ../utest/utest.js .", (out, r) => check(r.exitCode, 0))

// 2. O alocador existe como modulo PROPRIO — nao enterrado no io-engine. Uma
//    responsabilidade so: quais prefixos binarios ja foram usados, por nivel.
//    E o que permite as duas engines compartilharem o mesmo alocador depois.
eval("test -f src/index-bitmap.js && echo OK", (out) => check(out.includes("OK")))
eval("grep -c '^export function\\|^export const' src/index-bitmap.js",
     (out) => check(Number(out.trim()) >= 6))

// 3. `prefixes=` MORREU. Era a linha que listava cada prefixo como texto,
//    crescia linearmente com a colecao, e — o defeito de verdade — ninguem lia.
//    A busca ignora comentario: o que nao pode existir e a linha sendo ESCRITA
//    no arquivo, nao a nota explicando que ela morreu.
eval("grep -c 'out += .prefixes=\\|prefixes=\\${' src/io-engine.js || true",
     (out) => check(out.trim(), "0"))

// 4. O indice e LIDO. loadIndex() e a linha que encerra o write-only; sem ela,
//    todo o resto da feature (bitmaps, header versionado, syncedAt) nao serve
//    para nada.
eval("grep -c 'function loadIndex' src/io-engine.js", (out) => check(out.trim(), "1"))

// 5. Level-up substitui o salt. Dois registros de conteudo IDENTICO produzem a
//    mesma fullKey; o primeiro pega bits[0..L], o segundo acha ocupado e sobe
//    para bits[0..L+1]. Chaves distintas, ambas prefixos validos da mesma
//    fullKey, ambas passam verify(). Sem seq, sem salt.
eval(
  "bun -e \"import('./src/index-bitmap.js').then(B => { const bm=B.makeBitmaps(); const bits='1011001110'; const ks=[B.allocKey(bm,bits),B.allocKey(bm,bits),B.allocKey(bm,bits)].map(x=>x.bits); console.log(JSON.stringify({distinct:new Set(ks).size===3, prefixes:ks.every(k=>bits.startsWith(k)), ks}))})\"",
  (out) => { check(out.includes('\"distinct\":true')); check(out.includes('\"prefixes\":true')) }
)

// 6. O alocador novo concorda com o `shortestPrefix` legado registro a registro.
//    Trocar o mecanismo de alocacao sem esta prova e trocar as chaves em
//    silencio. Medido: 3000 alocacoes com payloads repetidos, 0 divergencias.
eval(
  "bun -e \"Promise.all([import('./src/index-bitmap.js'),import('./src/hash.js')]).then(([B,H]) => { const bm=B.makeBitmaps(), set=new Set(); let prev=null,diffs=0; for(let i=0;i<3000;i++){ const fk=H.makeFullKey({v:i%700},prev); const lg=H.shortestPrefix(fk,set); set.add(lg.bits); const mine=B.allocKey(bm,H.toBits(fk)); if(lg.bits!==mine.bits)diffs++; prev=lg.p } console.log('diffs='+diffs)})\"",
  (out) => check(out.includes("diffs=0"))
)

// 7. O header e VERSIONADO. Um `.index` de formato desconhecido nao e adivinhado
//    — e reconstruido do `.dash`, que sempre esta la e sempre manda.
eval(
  "bun -e \"import('./src/io-engine.js').then(({IO}) => { const fs=require('fs'),os=require('os'),p=require('path'); const d=fs.mkdtempSync(p.join(os.tmpdir(),'e15-')); const io=IO(p.join(d,'s')); io.open(); for(let i=0;i<40;i++)io.in({v:i}); io.flush(); io.close(); const raw=fs.readFileSync(p.join(d,'s.index'),'utf8'); console.log(JSON.stringify({fmt:/_format=lrm-1/.test(raw), v:/_v=/.test(raw), at:/syncedAt=\\\\d+/.test(raw), lvl:/^1\\\\{/m.test(raw)}))})\"",
  (out) => {
    check(out.includes('\"fmt\":true'))
    check(out.includes('\"at\":true'))
    check(out.includes('\"lvl\":true'))
  }
)

// 8. Indice CORROMPIDO: open() detecta e reconstroi, sem perder registro nenhum
//    e sem chave duplicada depois. Custa um rescan — que e o que se pagava
//    sempre, antes desta feature.
eval(
  "bun -e \"import('./src/io-engine.js').then(({IO}) => { const fs=require('fs'),os=require('os'),p=require('path'); const d=fs.mkdtempSync(p.join(os.tmpdir(),'e15c-')); const b=p.join(d,'s'); const a=IO(b); a.open(); for(let i=0;i<30;i++)a.in({v:i}); a.flush(); a.close(); fs.writeFileSync(b+'.index','lixo que nao e um indice\\\\n'); const c=IO(b); c.open(); c.in({v:'novo'}); c.flush(); const rs=c.records(), ks=rs.map(r=>Object.keys(r)[0]); console.log(JSON.stringify({n:rs.length, distinct:new Set(ks).size===rs.length, valid:c.verify().valid}))})\"",
  (out) => { check(out.includes('\"distinct\":true')); check(out.includes('\"valid\":true')) }
)

// 9. O CRITERIO (a) da feature: 3 processos concorrentes, nada perdido, nenhuma
//    chave repetida, cadeia valida. A carga e 3 e nao 8 de proposito — uma
//    corrida precisa de contencao, nao de multidao.
eval(
  "bun -e \"const {execSync}=require('child_process'); const fs=require('fs'),os=require('os'),p=require('path'); const d=fs.mkdtempSync(p.join(os.tmpdir(),'e15m-')); const w=p.join(d,'w.mjs'); fs.writeFileSync(w, \\\"import{IO} from '\\\"+process.cwd()+\\\"/src/io-engine.js';const io=IO(process.argv[2]);io.open();for(let i=0;i<20;i++){io.in({p:process.pid,i});io.flush()}io.close()\\\"); const b=p.join(d,'store'); execSync('for i in 1 2 3; do bun '+w+' '+b+' & done; wait',{shell:'/bin/bash'}); import(process.cwd()+'/src/io-engine.js').then(({IO})=>{const io=IO(b);io.open();const rs=io.records(),ks=rs.map(r=>Object.keys(r)[0]);console.log(JSON.stringify({n:rs.length,distinct:new Set(ks).size===rs.length,valid:io.verify().valid}))})\"",
  (out) => {
    check(out.includes('\"distinct\":true'))
    check(out.includes('\"valid\":true'))
    check(out.includes('\"n\":62'))
  }
)

// 10. Lock POR ARQUIVO. O nome do lock diz qual arquivo esta reservado, entao
//     dois processos mutando arquivos diferentes da mesma entity nao se
//     bloqueiam. A ordem fixa .dash -> .index -> .yaml e o que evita ciclo.
eval("grep -c 'lock.\\${file}\\|lock.<file>' src/adapters/io-append.js",
     (out) => check(Number(out.trim()) >= 1))

// 11. A exclusao vem do SCAN + RECHECK, nao do `wx`. `wx` num caminho por-PID
//     nunca colide — foi exatamente o mutex falso que esta feature ja consertou
//     uma vez. Um holder morto continua sendo varrido por kill(pid,0).
eval("grep -c 'process.kill(pid, 0)' src/adapters/io-append.js",
     (out) => check(out.trim(), "1"))

// 12. Holder MORTO nao trava escritor nenhum: o cadaver e varrido no primeiro
//     acquire contendido. Crash recovery e inegociavel aqui.
eval(
  "bun -e \"import('./src/adapters/io-append.js').then(m => { const fs=require('fs'),os=require('os'),p=require('path'); const d=fs.mkdtempSync(p.join(os.tmpdir(),'e15l-')); const b=p.join(d,'store'); fs.writeFileSync(b+'.999999.lock.dash',''); const h=m.acquireLock(b,'dash'); console.log(JSON.stringify({got:!!h, swept:!fs.existsSync(b+'.999999.lock.dash')})); m.releaseLock(h)})\"",
  (out) => { check(out.includes('\"got\":true')); check(out.includes('\"swept\":true')) }
)

// 13. publishDerived publica sob o lock DO PROPRIO ARQUIVO. O arbitro de offset
//     sozinho nao bastava: read-compare-write nao e atomico, entao dois
//     escritores liam o mesmo offset, ambos se aprovavam, e o conteudo mais
//     VELHO podia vencer o rename por chegar depois.
eval("grep -c 'lockBase' src/adapters/io-append.js src/io-engine.js | grep -c ':[1-9]'",
     (out) => check(out.trim(), "2"))
