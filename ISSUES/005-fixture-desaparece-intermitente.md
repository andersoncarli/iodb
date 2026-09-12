# `src/fixtures/tabular-pre-8.2.csv` sumiu do disco duas vezes durante a sessao, sem
comando explicito que o apagasse

<!-- system file -->

Encontrado em `~/iodb`, thread da frente 8. Causa raiz NAO ISOLADA — registrado como
item aberto para investigacao futura.

## Sintoma

Duas ocorrencias na mesma sessao:

1. **Antes do commit do sprint 026**: `git diff --cached --stat` mostrou "2633
   insertions" para o fixture logo antes do `git commit`, mas o commit resultante
   (`c21101f`) nao continha o arquivo (`git show HEAD:src/fixtures/...` ->
   "fatal: path exists on disk, but not in HEAD" -- o arquivo existia no disco mas
   nunca chegou ao commit). Corrigido com um commit avulso, `d0d3f9c`.
2. **Durante uma rodada de `utest . --force`**: um teste (`schema.t.js`,
   que le o fixture) falhou com `ENOENT: no such file or directory,
   open '.../tabular-pre-8.2.csv'`. Rodando a MESMA suite de novo, sem tocar em nada,
   o arquivo estava de volta e o teste passou.

## Diagnostico

Nao isolado. Hipoteses nao confirmadas:

- Algum teste concorrente com `withTempDir({dir: ...})` ou `rm -rf` cujo path colide
  por acidente com `src/fixtures/` (nenhuma ocorrencia de `rm`/`rmSync` recursivo
  encontrada em `grep` do `src/` que aponte pra isso diretamente).
- Uma race entre o `git add`/stage e algum processo de teste rodando em paralelo que
  ainda segurava um handle de escrita sobre o path (o `PagedText`/`TabularProjection`
  abre com `openSync`/`fd`, mas so quando LIDO, nao deveria escrever no fixture).
- Comportamento do proprio `sprint` (nao investigado): `sprint test`/`sprint eval` fazem
  alguma limpeza de untracked/staged como efeito colateral? Nao encontrado em
  `strings` do binario compilado, mas o binario e grande e a busca foi superficial.

Uma tentativa de reproduzir com um watcher (`while [ -f fixture ]; do sleep 0.1; done`)
rodando em paralelo com a suite completa NAO capturou o desaparecimento -- e
intermitente, nao determinístico a cada rodada.

## Contorno

`md5sum` o fixture antes de confiar nele em qualquer roteiro de eval que dependa dele
(os `.eval.js` da frente 8 ja fazem isso). Se ele sumir, regenerar SO se o conteudo
puder ser reconstruido byte-a-byte do codigo em HEAD anterior a mudanca que ele
documenta -- nunca regenerar as cegas achando que "e so recriar".

## Correcao

Desconhecida -- precisa de mais uma ocorrencia capturada com instrumentacao mais
pesada (ex: `strace`/`fs.watch` continuo durante uma sessao inteira) para isolar o
processo culpado.
