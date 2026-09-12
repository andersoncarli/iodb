// Roteiro de avaliacao — feature 1.4: equivalencia entre engines e formatos.
//
// O que esta feature afirma, e o que ela NAO afirma.
//
// A matriz de 1.3 varria format/reduce/seed/close medindo TAXA DE FALHA sob carga
// multi-processo. Isso respondia "a engine sobrevive a contencao?" — a pergunta de
// 1.3, e de 011. 1.4 pergunta outra coisa, e confundir as duas era o que tornava a
// matriz ilegivel: o MESMO objeto, guardado por mecanismos DIFERENTES, chega ao
// mesmo veredito? Isso e propriedade do formato e da formula da chave, entao se
// verifica com UM processo — sem spawn, sem orcamento de tempo, deterministico.
//
// A definicao que a feature usa: tudo e convertido para uma representacao minima
// POJO `{k, v}`, e a equivalencia e afirmada ALI. Nao entre arquivos, nao entre os
// objetos que cada engine devolve. O que um formato fez para carregar o registro
// e apagado por construcao antes de qualquer comparacao.
//
// EQUIVALENCIA DE USO e o requisito. Igualdade de CHAVE e um bonus que veio de
// graca depois de 1.5, porque as duas engines passaram a usar a mesma formula.
//
// ONDE ESTA O FOCO. O sujeito da feature e a EQUIVALENCIA ENTRE FORMATOS — dash
// x jsonl, um reducer x outro: as codificacoes que um caller e convidado a
// escolher, e que por isso nao podem mudar os objetos.
//
// A concordancia entre ENGINES e VERIFICACAO COLATERAL, nao o objetivo. Ela vale
// porque uma segunda implementacao, escrita de forma independente, e a checagem
// mais forte disponivel de que a afirmacao sobre formato e mesmo sobre os DADOS
// e nao sobre os habitos de uma engine: se dash e jsonl so concordam dentro do
// io-engine, a concordancia pode ser convencao dele. O nutshell, que compartilha
// a formula da chave e mais nada, elimina essa hipotese. As celulas de engine sao
// evidencia A FAVOR da afirmacao de formato — nao um contrato de paridade entre
// dois produtos.

// 1. A suite inteira, verde. O pre-requisito duro desta feature era o prefixo
//    curto (1.5 / sprint 010), que fechou 🔵 — as 7 falhas de verify().valid
//    herdadas do 008 nao existem mais.
eval("utest .", (out, r) => check(r.exitCode, 0))

// 2. As celulas de paridade sao SINGLE-PROCESS. Se elas spawnassem carga,
//    estariam medindo concorrencia de novo — o eixo de 1.3 e de 011, nao deste.
//    A prova e estrutural: nenhuma das celulas de 1.4 chama Bun.spawn.
eval(
  "awk '/PARITY: the same object/,0' src/io-engine.matrix.test.js | grep -c 'Bun.spawn' || true",
  (out) => check(out.trim(), "0")
)

// 3. As 6 celulas de 1.4 existem e rodam verdes.
eval("utest src/io-engine.matrix.test.js --force",
     (out, r) => check(r.exitCode, 0))
eval("grep -c '^test(\"1.4 parity' src/io-engine.matrix.test.js",
     (out) => check(Number(out.trim()) >= 5))

// 4. A normalizacao POJO nao e vacua. As duas engines devolvem FORMAS diferentes
//    em memoria — io-engine `{\"<key>\": payload}`, nutshell `{key, payload}` — e
//    a prova de que a reducao faz trabalho real e que os registros crus NAO sao
//    iguais enquanto os POJOs sao. A propria celula afirma as duas coisas.
eval("grep -c 'const pojo = \\|pojosOf' src/io-engine.matrix.test.js",
     (out) => check(Number(out.trim()) >= 3))

// 5. O LOG INTEIRO e igual como POJO, genesis incluido — desde que as duas
//    engines recebam o mesmo nome de store. Record 1 e `{_projection: <nome>}`,
//    entao o nome e ENTRADA, nao divergencia: com o mesmo nome em diretorios
//    diferentes, ate essa linha converge.
eval(
  "bun -e \"Promise.all([import('./src/io-engine.js'),import('./nutshell/io-nutshell.js')]).then(([E,N])=>{const fs=require('fs'),os=require('os'),p=require('path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'e14p-'));const A=p.join(d,'a'),B=p.join(d,'b');fs.mkdirSync(A);fs.mkdirSync(B);const P=[{v:0},{v:1,n:{a:[1,2]}},{v:2,zero:0,nil:null}];const pj=r=>r&&typeof r.key==='string'?{k:r.key,v:r.payload}:{k:Object.keys(r)[0],v:Object.values(r)[0]};const e=E.default(p.join(A,'S'),{reduce:E.append,initial:[],format:'jsonl'});e.open({_entity:'x'});for(const x of P)e.in(x);e.close();const n=N.default('S',{path:B,reduce:(a,r)=>a.concat([r]),initial:[]});n.open({_entity:'x'});for(const x of P)n.in(x);n.close();const a=e.records().map(pj),b=n.records().map(pj);console.log(JSON.stringify({pojoEqual:JSON.stringify(a)===JSON.stringify(b),rawEqual:JSON.stringify(e.records())===JSON.stringify(n.records()),n:a.length}))})\"",
  (out) => {
    check(out.includes('\"pojoEqual\":true'))  // equivalencia: afirmada
    check(out.includes('\"rawEqual\":false'))  // a normalizacao fez trabalho
    check(out.includes('\"n\":5'))
  }
)

// 6. Igualdade de CHAVE sobre CONTEUDO, independente do nome do store. Este e o
//    bonus de 1.5: nomes de store DIFERENTES (ENG/NUT) e as chaves de conteudo
//    continuam identicas, porque a chave e sha64(payload) XOR sha64(prevKey)
//    truncada no menor prefixo livre — formula que nenhuma engine pode variar.
eval(
  "bun -e \"Promise.all([import('./src/io-engine.js'),import('./nutshell/io-nutshell.js')]).then(([E,N])=>{const fs=require('fs'),os=require('os'),p=require('path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'e14k-'));const P=[{v:0},{v:1},{v:2}];const e=E.default(p.join(d,'ENG'),{reduce:E.append,initial:[],format:'jsonl'});e.open({_entity:'x'});for(const x of P)e.in(x);e.close();const n=N.default('NUT',{path:d,reduce:(a,r)=>a.concat([r]),initial:[]});n.open({_entity:'x'});for(const x of P)n.in(x);n.close();const ek=e.records().map(r=>Object.keys(r)[0]),nk=n.records().map(r=>r.key);console.log(JSON.stringify({content:JSON.stringify(ek.slice(2))===JSON.stringify(nk.slice(2)),genesisDiffers:e.records()[1]['1']._projection!==n.records()[1].payload._projection,keys:ek.slice(2)}))})\"",
  (out) => {
    check(out.includes('\"content\":true'))
    check(out.includes('\"genesisDiffers\":true'))
  }
)

// 7. O FORMATO e uma codificacao: dash e jsonl devolvem os mesmos objetos. Se o
//    formato mudasse a chave ou o payload, ele nao seria codificacao — seria
//    semantica, e nenhum caller poderia trocar de formato sem reler o proprio
//    codigo.
eval(
  "bun -e \"import('./src/io-engine.js').then(E=>{const fs=require('fs'),os=require('os'),p=require('path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'e14f-'));const P=[{v:0},{v:1,u:'acentuacao'},{v:2,nil:null}];const run=f=>{const io=E.default(p.join(d,'F'+f),{reduce:E.append,initial:[],format:f});io.open({_entity:'x'});for(const x of P)io.in(x);io.close();const r=io.records();return{k:r.map(x=>Object.keys(x)[0]),v:r.map(x=>Object.values(x)[0]),ok:io.verify().valid}};const a=run('dash'),b=run('jsonl');console.log(JSON.stringify({keys:JSON.stringify(a.k)===JSON.stringify(b.k),content:JSON.stringify(a.v.slice(2))===JSON.stringify(b.v.slice(2)),both:a.ok&&b.ok}))})\"",
  (out) => {
    check(out.includes('\"keys\":true'))
    check(out.includes('\"content\":true'))
    check(out.includes('\"both\":true'))
  }
)

// 8. O criterio por TAXA morreu. `check(bad <= Math.ceil(ran/2))` era limiar de
//    tolerancia a bug, herdado de quando a perda de registros era real. Com 008 e
//    1.5 entregues, tolerar perda deixou de fazer sentido: o criterio e binario.
eval("grep -c 'Math.ceil(ran' src/io-engine.matrix.test.js || true",
     (out) => check(out.trim(), "0"))

// 9. DIVERGENCIAS ENCONTRADAS — reportadas, nao consertadas (regra do CLAUDE.md:
//    achou problema fora do escopo, reporte). As duas estao fixadas por assercao,
//    para que unificar qualquer uma seja uma mudanca DELIBERADA que quebra teste,
//    nunca silenciosa:
//
//    (a) state() — io-engine devolve a PROJECAO reduzida (get() intercepta '#1'
//        antes de olhar registro, io-engine.js:488); nutshell devolve o PAYLOAD do
//        record 1. Quatro callers dependem do sentido do io-engine
//        (src/io-engine.test.js, src/node.t.js, src/db-factory.js:543, a celula
//        merge da propria matriz) e nutshell/io-nutshell.t.js:141 afirma o oposto.
//
//    (b) find() — io-engine mapeia TODO registro (io-engine.js:581), entao entrega
//        as linhas de genesis ao predicado do caller; o nutshell as descarta
//        antes. Com 4 payloads: 6 linhas contra 4. O comentario no bloco de
//        leitores do nutshell afirma que header/state/find "mean the same thing on
//        both engines" — para find(), nao significam.
eval("grep -c 'KNOWN divergence' src/io-engine.matrix.test.js",
     (out) => check(Number(out.trim()) >= 1))
eval(
  "bun -e \"Promise.all([import('./src/io-engine.js'),import('./nutshell/io-nutshell.js')]).then(([E,N])=>{const fs=require('fs'),os=require('os'),p=require('path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'e14d-'));const P=[{v:0},{v:1},{v:2},{v:3}];const e=E.default(p.join(d,'ENG'),{reduce:E.append,initial:[],format:'jsonl'});e.open({_entity:'x'});for(const x of P)e.in(x);e.close();const n=N.default('NUT',{path:d,reduce:(a,r)=>a.concat([r]),initial:[]});n.open({_entity:'x'});for(const x of P)n.in(x);n.close();console.log(JSON.stringify({headerAgrees:JSON.stringify(e.header())===JSON.stringify(n.header()),stateDiverges:JSON.stringify(e.state())!==JSON.stringify(n.state()),findEng:e.find(()=>true).length,findNut:n.find(()=>true).length}))})\"",
  (out) => {
    check(out.includes('\"headerAgrees\":true'))   // parity real
    check(out.includes('\"stateDiverges\":true'))  // divergencia (a)
    check(out.includes('\"findEng\":6'))           // divergencia (b)
    check(out.includes('\"findNut\":4'))
  }
)

// 10. A carga multi-processo NAO saiu da suite — ela continua nas celulas de 1.3
//     acima, que e onde pertence. 1.4 nao removeu cobertura, so parou de usar
//     concorrencia para afirmar formato.
eval("grep -c 'Bun.spawn' src/io-engine.matrix.test.js",
     (out) => check(Number(out.trim()) >= 1))

// 11. COMO 1.4 CONFIRMA 1.5 (sprint 010) — a relacao entre os dois sprints.
//
//     As duas engines compartilham UMA formula de chave: nutshell/io-hash.js
//     reexporta de src/hash.js (linha 34), e src/io-engine.js:10 importa do mesmo
//     modulo. O sprint 010 alterou exatamente esse arquivo compartilhado. Entao a
//     paridade nao e coincidencia de duas implementacoes — e consequencia de 010
//     ter consertado o mecanismo unico que as duas usam.
eval("grep -c \"from '../src/hash.js'\" nutshell/io-hash.js",
     (out) => check(out.trim(), "1"))

//     O defeito que 010 consertou, reproduzido: `parseInt(p, 2)` sem sentinela de
//     comprimento perde o zero a esquerda, entao '01' colide com '1', '011' com
//     '11', '010' com '10'. A colisao era de NOME, nao de cadeia. Oito bit-strings
//     distintas colapsam em cinco nomes; com a sentinela, oito em oito.
eval(
  "bun -e \"import('./src/hash.js').then(H=>{const B=['0','1','01','11','011','10','010','101'];const old=new Set(),neu=new Set();for(const p of B){old.add(H.toB64(parseInt(p,2)));neu.add(H.toB64(parseInt('1'+p,2)))}console.log(JSON.stringify({pre:old.size,pos:neu.size}))})\"",
  (out) => {
    check(out.includes('\"pre\":5'))   // pre-010: 3 colisoes de nome
    check(out.includes('\"pos\":8'))   // pos-010: nenhuma
  }
)

//     E a prova de NECESSIDADE, que e o que distingue este eval de uma leitura de
//     codigo: desfazendo SO a sentinela de comprimento de 010, a matriz quebra —
//     incluindo a igualdade de POJO do log inteiro e a equivalencia de uso. Um
//     eval que le o codigo confirma que a linha existe; este confirma que ela e
//     NECESSARIA. O arquivo e restaurado ao fim, sempre.
eval(
  "cp src/hash.js /tmp/h.keep && sed -i \"s/parseInt('1' + p, 2)/parseInt(p, 2)/\" src/hash.js && (utest src/io-engine.matrix.test.js --force > /tmp/h.out 2>&1; echo \"exit=$?\"); cp /tmp/h.keep src/hash.js; echo \"falhas=$(grep -c 'check(' /tmp/h.out)\"; grep -c 'JSON.stringify(A), JSON.stringify(B)' /tmp/h.out | sed 's/^/pojoQuebrou=/'",
  (out) => {
    check(out.includes('exit=1'))        // a matriz DEVE quebrar sem a correcao de 010
    // Dezenas de asserts, nao um. O contador do runner vem com cor ANSI entre o
    // glifo e o numero, entao contamos as LINHAS de falha, que sao texto puro.
    // O runner TRUNCA a lista de falhas, entao este numero e um piso, nao o
    // total: medido direto, a reversao quebra 16 asserts e o runner imprime 7.
    // O que importa e que sejam varias celulas independentes, nao uma.
    const m = /falhas=(\d+)/.exec(out)
    check(m != null && Number(m[1]) >= 5)
    // E entre elas, nominalmente, a igualdade de POJO do log inteiro — a assercao
    // central de 1.4. E ela que amarra esta feature ao conserto de 010.
    check(out.includes('pojoQuebrou=1'))
  }
)

//     Restaurado, verde de novo — a reversao acima nao deixou residuo.
eval("utest src/io-engine.matrix.test.js --force",
     (out, r) => check(r.exitCode, 0))

// 12. O que 1.4 NAO confirma de 1.5, dito explicitamente. Lock por arquivo,
//     `.index` v2, `loadIndex()` e `publishDerived` sob lock sao invisiveis daqui
//     POR CONSTRUCAO: 1.4 e single-process, e essas pecas so se manifestam sob
//     contencao. Quem as cobre e o eval de 1.5 (0 overlaps em 1600 secoes, 3000
//     alocacoes sem divergencia) e as celulas de 1.3. 1.4 confirma a FORMULA DA
//     CHAVE de 010, e so ela.
eval("test -f plans/1-core/1.5.eval.js && echo OK", (out) => check(out.includes("OK")))
