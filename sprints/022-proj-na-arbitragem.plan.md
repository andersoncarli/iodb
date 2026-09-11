# 022 — proj-na-arbitragem

Feature 4.5: o `.proj` deixa de ser arbitrado por TAMANHO DE ARQUIVO e passa a ser
arbitrado por OFFSET do log.

## O defeito, que estava vivo

`src/io-engine.js:273` guardava o replay do log com
`statSync(f.proj).size > 4096` — um literal, e nao o `pageSize` com que o store foi
aberto. Com pagina menor que 4096, uma projecao de VARIAS paginas ainda mede menos que
4096 bytes: o guarda a lia como vazia, o log inteiro era reaplicado por cima do que ja
estava la, e todo registro duplicava.

Medido em 128/256/512/1024/2048; so 4096 escapava, porque ali tudo cabia numa pagina —
e era o unico tamanho que os testes usavam. O defeito morava exatamente na faixa que
nenhum teste visitava: varias paginas, menos de 4096 bytes no total.

## Por que o tamanho nunca foi a pergunta certa

O guarda precisa responder *"quanto deste log ja esta dentro da projecao?"*. Tamanho e
um proxy para "ja tem alguma coisa", e o que importa nao e SE tem, e ATE ONDE.

O `logOffset` ja existia no rodape do pagedtext desde a 2.0, com getter, setter e
persistencia — e nao era lido por ninguem acima dele. Esta feature liga as pontas.

## O escopo

1. O `logOffset` fica legivel e gravavel pela projecao (`__logOffset`/`__setLogOffset`).
2. As linhas lidas do `.dash` passam a carregar o offset ABSOLUTO onde comecam — sem a
   posicao, "ja absorvido" nao e pergunta respondivel sobre um registro individual.
3. UM dono do flush da projecao (`flushProjection`), porque o offset tem que andar
   junto com os bytes em todos os caminhos. Eram quatro call-sites de `__flushPages()`.
4. O `catch {}` mudo do `close()` sai.
5. O gap declarado em prosa e nao fechado — `.proj` ATRASADO — fecha junto: o delta que
   falta e reaplicado em vez de o replay inteiro ser pulado.

## Fora do escopo

A arbitragem MULTI-PROCESSO via `publishDerived` (lock proprio do derivado, temp com
PID, rename). O criterio literal da feature cita o teste de 3 processos da 4.4, que
ainda nao existe. O que esta feature entrega e o offset — que e o que `publishDerived`
pediria como `readOffset`, e sem o qual nao ha o que arbitrar.
