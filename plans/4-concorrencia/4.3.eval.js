// Roteiro de avaliacao — feature 4.3: o mutex ganhou arquivo proprio, e a
// polaridade certa.
//
// A tese em duas partes. Primeira: enquanto f.yaml era simultaneamente a
// PROJECAO (dado) e o MUTEX (controle), segurar o lock significava fazer a
// projecao DESAPARECER, e toda a complexidade residual da engine vinha de
// contornar essa janela. Segunda: separar os dois nao basta se o estado livre
// continuar sendo um ARQUIVO — foi isso que obrigou o mutex a ter nascimento,
// e o nascimento e onde a exclusao mutua morria em silencio. Aqui o livre e a
// AUSENCIA, entao nao ha o que nascer.

// 1. O mutex existe como membro proprio da familia, irmao de dash/yaml/index.
//    Se o lock nao tem arquivo proprio, nada abaixo disto significa coisa alguma.
eval("grep -n 'lock:' src/io-engine.js", (out) => check(out.includes("lock:")))

// 2. A engine adotou o protocolo de src/adapters/io-append.js em vez de manter uma copia.
//    Duas implementacoes do mesmo lock divergem — foi por isso que a 4.2 o
//    extraiu. Aqui provamos que a copia local sumiu de fato.
eval("grep -c \"from './adapters/io-append.js'\" src/io-engine.js", (out) => check(out.trim(), "1"))
eval("grep -c '^function acquireLock' src/io-engine.js", (out) => check(out.trim(), "0"))

// 3. AUSENCIA = LIVRE. O estado livre e "nao ha f.lock.* nenhum", que todo
//    diretorio novo ja satisfaz — entao o mutex nao tem nascimento: nao ha
//    ensureLock a chamar, nao ha cerimonia de criacao unica a proteger, e a
//    armadilha que o 007 mediu (create-if-missing durante a posse forja um
//    SEGUNDO mutex e dois escritores entram juntos) nao pode sequer ser
//    escrita. Some uma classe inteira de bug, nao uma instancia dela.
eval("grep -c 'ensureLock' src/io-engine.js", (out) => check(out.trim(), "0"))
eval("sed -n '/export function acquireLock/,/^}/p' src/adapters/io-append.js", (out) => {
  check(out.includes("'wx'"))       // create exclusivo: o kernel decide a corrida
  check(out.includes("EEXIST"))     // EEXIST = alguem detem
})

// 4. O PID vive no NOME, nunca no conteudo. Um unico syscall atomico cria o
//    arquivo JA identificado. Se o PID fosse escrito DEPOIS do create, haveria
//    janela entre os dois: a varredura acharia arquivo vazio e nao saberia
//    distinguir recem-nascido de corrompido — roubando um lock vivo ou
//    travando para sempre. O nome fecha essa janela por construcao.
eval("grep -c 'process.pid' src/adapters/io-append.js", (out) => check(Number(out.trim()) >= 1))
eval("grep -c 'process.kill(pid, 0)' src/adapters/io-append.js", (out) => check(out.trim(), "1"))

// 5. A eleicao de genesis por 'wx' em f.yaml SUMIU. O nascimento do dado e o
//    nascimento do controle eram o mesmo evento, e por isso tinham que ser
//    disputados juntos; agora sao arquivos separados e o genesis e apenas a
//    primeira escrita, sob o lock comum.
eval("grep -c \"openSync(f.yaml, 'wx')\" src/io-engine.js", (out) => check(out.trim(), "0"))

// 6. A publicacao da projecao NAO readquire o lock. Sob a 4.2 ela precisava,
//    so para o rename final, porque escrever f.yaml com o lock alheio forjaria
//    um segundo mutex. Esse era o custo que a 4.3 existe para eliminar.
eval("sed -n '/function publishYaml/,/^  }/p' src/io-engine.js", (out) => {
  check(!out.includes("acquireLock"))
  check(out.includes("publishDerived"))
})

// 7. O timeout voltou a ser CONSTANTE, e a constante e justificada pela medicao
//    de 4.1/4.2 (secao critica O(1)), nao escolhida a dedo. Um timeout que
//    cresce com o dado transforma deadlock real em travamento longo.
// (o timeout e constante por decisao; o valor foi de 1000 para 3000 depois da confirmacao)
eval("grep -n 'export const LOCK_TIMEOUT' src/adapters/io-append.js", (out) => check(out.includes("3000")))

// 8. Nenhum .tmp de nome fixo sobrou. Um .tmp compartilhado por todo processo
//    que escreve a mesma base e o bug da 1.2 voltando por outra porta.
eval("grep -n \"yaml + '.tmp'\" src/io-engine.js", (out) => check(out.trim(), ""))

// 9. A MEDICAO — 8 processos, 30 escritas cada, ao vivo.
//
//    Numeros de referencia, mesma sonda, mesmo cenario:
//      f.yaml era o mutex:      crashed=2  timeouts=2  records=204/240  yamlMissing=1184/1660
//      f.lock, ausencia=livre:  crashed=0  timeouts=0  records=240/240  yamlMissing=0/~260
//
//    `yamlMissing` e a linha que define a feature: quantas amostras, tiradas
//    de FORA enquanto os oito escreviam, pegaram a projecao ausente. Antes, na
//    maioria delas. Agora, em nenhuma — e isso e a invariante nova, nao um
//    ganho de desempenho. (O ganho aparece de lado: ~260 ticks do amostrador
//    contra ~1660, ou seja os mesmos 240 registros num sexto do tempo de
//    parede. create+unlink bate rename+rename-de-volta sob contencao.)
//
//    `lockResidue` so e mensuravel sob a polaridade nova: com ausencia = livre,
//    qualquer arquivo remanescente no fim e um release que nao aconteceu. Sob
//    a polaridade antiga isso era invisivel, porque o estado livre TAMBEM era
//    um arquivo.
eval("node plans/4-concorrencia/4.3.probe.js 8 30", (out) => {
  const n = (k) => { const m = out.match(new RegExp(k + "=([0-9]+)")); return m ? Number(m[1]) : NaN }
  check(n("crashed"), 0)
  check(n("timeouts"), 0)
  check(n("enoent"), 0)
  check(out.includes("records=240/240"))
  check(n("yamlMissing"), 0)      // a invariante: a projecao nunca some
  check(n("lockResidue"), 0)      // ausencia = livre: nada sobra no fim
})

// 10. FORA DE ESCOPO, reportado e nao cobrado — a alocacao de prefixo curto.
//    `distinctKeys` sai abaixo de `records` porque cada processo escolhe a
//    chave curta consultando o SEU prefixSet em memoria, que disco nenhum
//    coordena: dois processos escolhem o mesmo prefixo para payloads
//    diferentes, ambos encadeiam certo, ambos apendam sob o lock, e verify()
//    quebra no resultado. E independente do mutex — o lock cumpriu a parte
//    dele, e a sonda mostra 240/240 registros intactos. Vive em hash.js
//    (shortestPrefix), fora do escopo deste sprint.
