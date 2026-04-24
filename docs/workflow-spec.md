# Cross-Review MCP Workflow Specification v4.1

**Status**: v4.1 eh revisao spec-only de v4 via sessao a847f897 (2026-04-24,
aprovada bilateral). v4.1 altera APENAS politica de processo -- NAO toca em
schema, parser, server, session-store, peer-spawn ou qualquer codigo. Logo,
v4.1 NAO requer bump do `cross-review-mcp` (permanece em v0.4.0-alpha).
Precursores: v2 (sessao 7d745f38); v3 (sessao 806a1c4f); v4 normativa
absorvendo v0.4.0-alpha (sessao 08cd61e6).

Encoding: ASCII-only com transliteracao de acentos do portugues. Motivo
operacional em secao 6.4.

---

## 0b. Delta v4 -> v4.1 (sumario executivo)

- **Secao 6.5 SUAVIZADA**: linguagem de ledger passa de obrigatoria ("mantem")
  para opcional ("pode manter"; "Quando adotado...") para coerencia com
  evidencia empirica de nao-adocao (auditoria 2026-04-24: nenhum `ledger.md`
  em `~/.cross-review/`).
- **Secao 6.6 PROMOVIDA DE FOLLOW-UP PARA NORMATIVA**: contrato normativo com
  thresholds concretos e ordem de compressao mandatoria, dividido em 4
  subsecoes: 6.6.1 Transcript, 6.6.2 Ledger, 6.6.3 meta.json, 6.6.4
  Non-destructive compression.
- **Secao 7 AJUSTADA**: linha de ledger suavizada para coerencia com §6.5;
  nova linha "Overflow" com ponteiros para §6.6.
- **Secao 8 AJUSTADA**: criterios de aceitacao registram aprovacao bilateral
  da sessao a847f897.

Toda mudanca em v4.1 eh policy/documentacao. Nenhum contrato programatico
(tools MCP, formato do bloco, schema de payload, session-store on-disk layout)
foi alterado. Qualquer leitor que infira necessidade de bump do server por
conta de v4.1 esta equivocado.

---

## 0a. Delta v3 -> v4 (sumario executivo)

- **Secao 2.3.1 NOVA**: schema JSON expandido do bloco estruturado.
  Campos opcionais `uncertainty`, `caller_requests`, `follow_ups` validados
  per-field; invalidos sao DESCARTADOS com warning sem derrubar o bloco;
  campos fora da whitelist sao descartados com warning. Regra normativa
  `omit-unless-signal`. Limites: <=20 items por array, <=500 chars por item.
- **Secao 5 ATUALIZADA**: conjunto consumido pelo caller expandido com
  `parser_warnings` e `peer_model`.
- **Secao 6.8 REESCRITA**: antes FOLLOW-UP, agora IMPLEMENTADO em
  v0.4.0-alpha (secao 2.3.1).
- **Secao 6.9 NOVA (operacional normativa)**: 6.9.1 Tri-tool obrigatorio
  (cross-review + ultrathink + code-reasoning) e 6.9.2 Modelo top-level
  (peer invocado com IDs especificos em cada release; auditado via
  `peer_model`).

---

## 0. Delta v2 -> v3 (sumario executivo, preservado para rastreabilidade)

- **Secao 2.1 reescrita**: contrato de STATUS ancorado exclusivamente no tail
  da resposta / ultima linha nao-vazia. Removido scan global do regex.
  Adicionado `NEEDS_EVIDENCE` ao enum.
- **Secao 2.2 NOVA**: anchor posicional ("o que estiver no final vence");
  substitui a regra implicita "structured wins over regex" de v2.
- **Secao 2.3 PROMOVIDA de FOLLOW-UP para IMPLEMENTADA**: STATUS em campo
  estruturado `<cross_review_status>{...}</cross_review_status>` como forma
  preferida. Implementada em v0.3.0-alpha.
- **Secao 2.4 NOVA**: contrato de falha do bloco estruturado -- JSON
  malformado ou status fora do enum retorna `null` sem cair no regex fallback.
- **Secao 2.6 NOVA**: interacao com orquestrador em versao mista durante
  janela de upgrade.
- **Secao 3.3 AJUSTADA**: CALLER_REQUEST deve acompanhar status
  `NEEDS_EVIDENCE` (e nao `NOT_READY`).
- **Secao 3.5 NOVA**: reconhecimento operacional de sandbox do peer com
  exec de hash/node bloqueado (validacao por leitura direta).
- **Secao 5 ATUALIZADA**: conjunto consumido pelo caller expandido para
  incluir `peer_structured` e `status_source` alem de `content` e
  `peer_status`.
- **Secao 6.3 reescrita**: `NEEDS_EVIDENCE` promovido de FOLLOW-UP para
  estado peer-only canonico. Caller continua restrito a `READY|NOT_READY`.
- **Secao 6.4 AJUSTADA**: explicitado que a regra ASCII-only se aplica
  tambem a arquivos pre-existentes promovidos a artifact de review.
- **Secao 6.6 (overflow) sem mudanca** (FOLLOW-UP nao-bloqueante).
- **Secao 6.7 ATUALIZADA**: matriz minima de evidencia agora cita
  `vitest/test script` generico (em vez de `vitest` especifico) e adiciona
  entrada para `cross-review-mcp` proprio (= `npm test`).
- **Secao 6.8 NOVA**: FOLLOW-UP para esquema JSON expandido do bloco
  estruturado (v0.4.0+).

---

## 1. Contratos de abertura de sessao

### 1.1 Artifacts obrigatorios no session_init
- Arquivos sob revisao: caminhos absolutos.
- Transcript (quando houver contexto caller-user relevante): arquivo unico em
  path temporario, ASCII-only.

### 1.2 Transcript - formato hibrido acordado
O transcript NAO deve ser verbatim puro nem sintese pura. Formato hibrido:

- Abertura estruturada (curta): objetivo desta sessao, escopo, pergunta desta
  rodada, status atual do caller.
- Diretivas do user que mudam comportamento: verbatim, apenas as normativas
  (feedback de coaching, mudanca de prioridades, restricoes operacionais).
  Transliterar acentos se houver; preservar sentido.
- Timeline resumida por rodada das sessoes anteriores: 1-3 linhas por rodada
  com achado, resposta, motivo do estado.
- Tabela de artefatos: caminho, fingerprint (SHA-256), se mudou desde a
  rodada anterior.
- Bloco de evidencias: comandos rodados pelo caller, outputs relevantes, flag
  de validade (se o artefato mudou desde o comando, output esta stale).
- Bloco "open questions / pedido ao peer" com respostas esperadas.
- Apendice verbatim: apenas para trechos litigiosos ou semanticamente
  sensiveis, sempre ASCII-only.

Tamanho otimo: corpo principal denso em 1-3 mil palavras, apendice verbatim
opcional. Full verbatim so no primeiro handoff de sessao complexa ou quando
houver disputa semantica.

### 1.3 Clausula de escopo obrigatoria
Primeiro prompt deve conter secao "Contrato de escopo" enumerando:
- Alvo da sessao (o que esta sendo revisado/decidido).
- O que esta DENTRO do escopo.
- O que fica FORA do escopo (migra para FOLLOW-UP sem bloquear READY).

---

## 2. Protocolo STATUS

### 2.1 Contrato de formato do peer (REESCRITO em v3)

O parser inspeciona APENAS o tail da resposta. Mencoes de `STATUS: X` ou de
`</cross_review_status>` dentro da prosa anterior NAO disparam deteccao.

Em ordem de tentativa:

1. **Bloco estruturado (preferido)**: se o tail (ignorando whitespace
   trailing) termina com a sequencia literal `</cross_review_status>`, o
   parser localiza o `<cross_review_status>` imediatamente a esquerda,
   extrai o conteudo intermediario, aplica `trim()` e `JSON.parse()`. O
   payload DEVE ser um objeto JSON com campo `status` cujo valor esta em
   `{READY, NOT_READY, NEEDS_EVIDENCE}`. O payload aceita multi-linha e
   pretty-printing desde que o closing tag seja a ultima sequencia
   nao-branca do texto.

2. **Fallback legacy (backwards-compat)**: apenas quando o caminho (1) nao
   dispara, o parser isola a ULTIMA LINHA NAO-VAZIA do texto, aplica
   `trim()`, e exige regex EXATA case-sensitive
   `^STATUS: (READY|NOT_READY|NEEDS_EVIDENCE)$`.

3. **Sem match**: retorna `{status: null, structured: null, source: null}`.
   Caller trata como `protocol_violation` e pode invocar rodada
   "APENAS-FORMATO" pedindo re-emissao.

Output expose ao caller: `status` (string | null), `structured` (objeto JSON
parseado quando caminho 1 venceu, else null), `source` (`'structured'` |
`'regex'` | `null`).

### 2.2 Anchor posicional (NOVO em v3)

A precedencia entre os dois formatos e **por posicao, nao por formato**. Se o
peer emitir um bloco estruturado no meio do corpo mas terminar com linha
legacy `STATUS: X`, o caminho (2) vence porque a linha legacy e a ultima
linha nao-vazia. Inversamente, se o peer emitir `STATUS: X` no meio do corpo
mas terminar com bloco estruturado valido, o caminho (1) vence porque o tail
termina com o closing tag.

Motivacao: elimina a regra anterior "structured wins over regex" que era
ambigua em textos mistos. Ambos os caminhos sao ancorados em posicao; o
contrato e "o que estiver no FINAL vence".

### 2.3 STATUS estruturado -- IMPLEMENTADO em v0.3.0-alpha

Esta secao deixou de ser FOLLOW-UP. O MCP agora aceita o bloco estruturado
como forma preferida, conforme secao 2.1 caminho (1). Referencia de
implementacao: `src/lib/status-parser.js`.

Desde v0.3.0-alpha, o payload JSON aceitava apenas `status`. Em v0.4.0-alpha
(secao 2.3.1), o payload foi expandido com campos opcionais validados.

### 2.3.1 Schema expandido do payload (NOVO em v4, implementado em v0.4.0-alpha)

O payload JSON do bloco estruturado passa a aceitar tres campos OPCIONAIS
alem de `status`:

```
{
  "status": "READY" | "NOT_READY" | "NEEDS_EVIDENCE",          // required
  "uncertainty": "low" | "medium" | "high",                    // optional
  "caller_requests": ["string", ...],                          // optional
  "follow_ups": ["string", ...]                                // optional
}
```

Limites de tamanho (invariantes do parser):
- `caller_requests` e `follow_ups`: ARRAYS de strings, maximo 20 items,
  cada item com no maximo 500 chars.
- `uncertainty`: string no enum `{low, medium, high}`.

Validacao deterministica per-field (ordem de verificacao):
1. shape (array vs nao-array; string vs nao-string).
2. quantidade (items do array).
3. tipo dos itens (string vs nao-string).
4. tamanho dos itens (chars por string).

Se qualquer regra falhar, o campo inteiro eh DESCARTADO do `peer_structured`
e UM warning por campo rejeitado eh adicionado a `parser_warnings` (string
humano-legivel que identifica o campo e a regra violada, com indice/size
quando aplicavel). Campo opcional invalido NAO invalida o bloco inteiro --
`peer_status` preserva o valor do `status` quando este eh valido.

Empty array (`[]`) eh normalizado para AUSENCIA do campo em
`peer_structured`, sem warning. Equivalencia semantica explicita: campo
ausente === array vazio.

Campos fora da whitelist (`status`, `uncertainty`, `caller_requests`,
`follow_ups`) sao DESCARTADOS de `peer_structured` e cada ocorrencia gera um
warning `unknown field 'X' ignored`. Extensao futura do schema requer bump
explicito de release + spec (adicao silenciosa de campo eh violacao do
contrato).

Regra normativa `omit-unless-signal`: peers DEVEM omitir os campos
opcionais por padrao; emissao apenas quando o valor efetivamente altera a
leitura do parecer. Default-padding (ex: `uncertainty: "medium"` sem
significado real) eh violacao do contrato operacional. Valida-se pela
coerencia textual do corpo da resposta, nao automaticamente pelo parser.

Semantica por pairing `status x campo opcional`:
- `caller_requests` com `NEEDS_EVIDENCE`: uso primario esperado. Lista
  estruturada de pedidos ao caller.
- `caller_requests` com `READY` ou `NOT_READY`: permitido mas interpretado
  como nice-to-have nao-bloqueante. Caller pode atender ou ignorar.
- `follow_ups` com `READY`: uso primario esperado. Itens acordados para
  sessao futura; sinal explicito de "fechamos com debito acordado".
- `follow_ups` com `NOT_READY` ou `NEEDS_EVIDENCE`: permitido, nao bloqueia
  fluxo desta sessao.
- `uncertainty` com qualquer status: informativa; NAO afeta convergencia
  nem influencia `peer_status`.

Compatibilidade retroativa: bloco v3 puro `{"status":"X"}` permanece valido
em v4. Passa pelo mesmo codepath com `parser_warnings: []` e
`peer_structured = {status: "X"}`.

### 2.4 Falha silenciosa do bloco estruturado (NOVO em v3)

Se o tail termina com `</cross_review_status>` mas:
- o opening tag `<cross_review_status>` esta ausente, OU
- o payload nao e um JSON valido, OU
- o JSON parseia mas nao e um object, OU
- o campo `status` nao existe / nao e string / esta fora do enum,

entao o parser retorna `{status: null, structured: null, source: null}`.
**NAO ha fallback para regex** nesse caso, porque a ultima linha nao-vazia
e o closing tag, que nao casa com `^STATUS: X$`. Isto e intencional:
bloco estruturado emitido pelo peer e declaracao explicita de uso do
contrato novo; falha-lo silenciosamente cairia em regex e mascararia erro
de protocolo. Fallback nesse caminho reabriria a ambiguidade que motivou a
reescrita da secao 2.1.

### 2.5 Fallback em violacao de formato

Se `status: null` (qualquer um dos caminhos 1 ou 2 falhou):
- Caller envia rodada minimalista "APENAS-FORMATO" pedindo re-emissao do
  status.
- Mantem o conteudo tecnico da rodada anterior valido -- nao repete analise.

### 2.6 Interacao com orquestrador versao mista

Se o orquestrador em execucao nao foi reiniciado apos upgrade do server e
roda versao antiga do parser (v0.2.0-alpha: apenas regex `STATUS: X`), o
peer que emitir APENAS o bloco estruturado tera `peer_status: null` +
`protocol_violation: true` registrado em meta.json, mesmo respondendo
corretamente no conteudo. Mitigacao durante janelas de transicao: peer emite
**ambos** os formatos (bloco estruturado em posicao anterior + linha legacy
`STATUS: X` como TAIL). Isso satisfaz parser antigo (via caminho 2) e
parser novo (via caminho 2 tambem -- porque TAIL e a linha legacy). Apos
reload do orquestrador, peer pode voltar a emitir apenas o bloco
estruturado.

---

## 3. Paridade de tooling -- protocolo hibrido (MANTIDO de v2)

### 3.1 Regra dura
Qualquer assercao factual sobre COMPORTAMENTO DINAMICO (sintaxe parseavel,
testes passando, build compilando, tipo-checando, lint limpo, runtime
produzindo output X) SEM EVIDENCIA ANEXADA deve ser tratada pelo peer como
NAO VERIFICADA.

### 3.2 Comportamento padrao do caller
Antes de cada ask_peer, caller executa a matriz relevante de validacoes e
anexa resultados no prompt.

### 3.3 Valvula operacional CALLER_REQUEST

Se peer identifica que precisa de evidencia dinamica nao anexada, responde
com bloco explicito:

```
CALLER_REQUEST:
- comando: <cmd exato>
- proposito: <por que preciso>
- criterio de aceite: <que output/exit_code/pattern eu espero ver>
```

Caller, na proxima rodada, executa como PRIMEIRA ACAO e anexa output bruto +
veredicto contra criterio de aceite.

**Em v3**, o peer que emite `CALLER_REQUEST` DEVE acompanhar o bloco com
status `NEEDS_EVIDENCE` (nao `NOT_READY`), per secao 6.3. A semantica
sinaliza ao caller que o bloqueio e de evidencia pendente, nao de
discordancia tecnica.

### 3.4 Evidencia vencida

Toda evidencia anexada inclui FINGERPRINT DO ARTEFATO no momento do comando.
Se o artefato mudou desde entao (edit, overwrite), evidencia e marcada como
STALE e nao conta como verificada -- caller deve rerodar.

### 3.5 Limitacao de sandbox de peer (OBSERVACAO OPERACIONAL, NOVO em v3)

Em sessao 0e427278 round 4 o peer Codex reportou:

> "Limitacao operacional: o sandbox bloqueou recomputacao local de SHA-256
>  (Get-FileHash, sha256sum, certutil e Node crypto), entao validei por
>  leitura direta do conteudo e do smoke output salvo."

E normal o peer nao conseguir rodar hashes / node / git no proprio sandbox
(sandbox read-only cobre read mas bloqueia exec de alguns binarios). Nesse
caso, a validacao do peer e por LEITURA DIRETA do conteudo dos artefatos.
Caller deve: (a) anexar evidencia dinamica pre-computada (output + hash);
(b) incluir no prompt paths absolutos fora do cwd do peer se o codigo vive
fora do workspace; (c) aceitar READY baseado em leitura de conteudo quando o
peer explicita a limitacao de hash, em vez de exigir recomputacao
impossivel.

---

## 4. FOLLOW-UP vs. bloqueio (MANTIDO de v2)

### 4.1 Regra geral
Achado fora de escopo vira FOLLOW-UP: na resposta. NAO bloqueia READY.

### 4.2 Excecoes (achado fora de escopo que SIM bloqueia)
- Invalida conclusao central do escopo atual.
- Mostra que a evidencia usada esta obsoleta ou incorreta.
- Toca em hard gate de seguranca/compliance definido pelo user.

### 4.3 Forma do FOLLOW-UP

```
FOLLOW-UP: <descricao curta>
- por que: <motivo>
- escopo apropriado: <proxima sessao / patch isolado / documentacao>
- urgencia: <bloqueante em prazo | desejavel | nice-to-have>
```

### 4.4 Sinalizacao de nao-convergencia honesta

Se peer insiste em NOT_READY sobre residual que caller considera fora de
escopo e incompativel:
- Caller abre rodada de negociacao explicita de escopo.
- Se nao houver acordo, session_finalize(outcome='aborted') -- sinaliza
  nao-convergencia em vez de falso READY.

---

## 5. Ruido (ATUALIZADO em v4)

Caller consome apenas `content`, `peer_status`, `peer_structured`,
`status_source`, `parser_warnings`, e `peer_model`. Em v2, o conjunto era
apenas `content` + `peer_status`; `peer_structured` e `status_source`
entraram em v0.3.0-alpha; `parser_warnings` e `peer_model` entraram em
v0.4.0-alpha.

Semantica de cada campo:
- `status_source === 'structured'` confirma que o peer respeitou o
  contrato preferido (bloco estruturado tail-anchored).
- `peer_structured` eh o payload JSON validado (v4: `status` + campos
  opcionais na whitelist que passaram validacao); acesso direto sem
  parsing prosa.
- `parser_warnings` lista rejeicoes per-field do parser. Caller DEVE
  inspecionar: warnings sinalizam peer drift ou violacao de schema --
  ignorar eh transformar `parser_warnings` em telemetria morta.
- `peer_model` audita qual modelo top-level foi efetivamente invocado no
  round. Revisoes de sessao conferem aderencia a secao 6.9.2.

`stderr_tail` permanece telemetria de transporte, guardada apenas para
diagnostico do proprio mecanismo. Nenhuma decisao tecnica ou formal eh
baseada em stderr_tail.

---

## 6. Pontos fracos identificados

### 6.1 Drift de artefato entre rodadas (MANTIDO de v2)

Problema: se arquivo muda entre rodadas e o peer nao e notificado, responde
sobre versao obsoleta.

Solucao: caller inclui no prompt de cada rodada um bloco ARTIFACTS:

```
ARTIFACTS:
- C:\Scripts\ai-sync.js | sha256:<hash> | changed_since_last_round: <yes|no>
```

Peer deve re-ler artifact se `changed_since_last_round: yes`.

### 6.2 Evidencia vencida (subitem de 3.4) (MANTIDO de v2)

Absorvido no protocolo P1 -- toda evidencia tem fingerprint + flag de stale.

### 6.3 Estado NEEDS_EVIDENCE -- IMPLEMENTADO em v0.3.0-alpha

**Estado peer-only canonico.** Separa "nao concluo sem evidencia" de
"discordo tecnicamente". Caller continua restrito a `READY|NOT_READY` (a
assimetria e intencional: caller sem evidencia emite `NOT_READY` com
`CALLER_REQUEST` para peer -- simetria seria redundante).

Quando peer emite `NEEDS_EVIDENCE`:
- `session_check_convergence.converged` retorna `false`.
- `reason` orienta explicitamente: "attach the requested evidence next round
  instead of re-arguing merits".
- Caller, na proxima rodada, roda os comandos do `CALLER_REQUEST` (secao 3.3)
  e anexa output bruto + fingerprint.

Implementacao: `src/lib/status-parser.js` aceita no enum; `src/lib/session-
store.js` branch dedicada em `checkConvergence`.

Convencao textual `UNCERTAINTY` da v2 6.3 continua valida como informacao
suplementar (nao-normativa):

```
UNCERTAINTY:
- nao posso concluir sem: <X>
- provavel veredicto dado X: <previsao condicional>
```

### 6.4 Fidelidade de encoding do transcript -- REGRA OPERACIONAL CANONICA
(MANTIDO de v2)

Todos os artifacts escritos para consumo do peer devem ser ASCII-only com
transliteracao de acentos do portugues. Tabela de substituicoes padrao
preservada de v2.

Prompts do `ask_peer` podem ter acentos (transmitidos via API JSON-over-stdio,
nao via leitura de arquivo). Somente arquivos em disco precisam de
ASCII-only.

**Novo em v3**: a regra se aplica tambem a arquivos PRE-EXISTENTES no repo
que viram artifacts de sessao de review. Na sessao 0e427278 round 1 o peer
flaggou `README.md` do proprio cross-review-mcp como nao-ASCII; a correcao
foi reescrever o README inteiro com transliteracao antes do READY.

### 6.5 Ledger de continuidade entre sessoes (SUAVIZADO em v4.1)

Caller **pode** manter ledger em arquivo persistente (ex:
`C:\Users\leona\.cross-review\ledger.md`). Quando adotado, o ledger contem:
- Sessoes anteriores (id, data, outcome, escopo).
- Achados fechados.
- Achados residuais aceitos + fronteira arquitetural.
- Follow-ups pendentes.

Ledger em ASCII-only. Quando o ledger for adotado, novo session_init anexa-o
como artifact sempre que o alvo relaciona-se a sessoes previas.

Nota empirica (auditoria 2026-04-24): ate a data de v4.1 nenhum
`~/.cross-review/ledger.md` foi produzido em uso real. §6.5 permanece como
convencao opcional; politica de compactacao do ledger entra em vigor se/quando
ele for adotado (§6.6.2).

### 6.6 Overflow / truncamento (NORMATIVA em v4.1)

Promovido de FOLLOW-UP para contrato normativo via sessao a847f897
(2026-04-24, aprovada bilateral). Politica policy-only -- nenhum code change
em cross-review-mcp foi feito, e nenhum eh justificado pelos dados empiricos
coletados ate aqui.

#### 6.6.1 Transcript (artefato montado pelo caller)

O transcript (artefato temp produzido pelo caller e entregue como artifact em
`session_init`) tem limites de tamanho operacional:

- **Yellow line**: 50000 chars (~12-15k tokens em ASCII). Acima, caller DEVE
  aplicar a ordem de compressao abaixo.
- **Red line**: 100000 chars (~25k tokens). Acima, caller DEVE remontar
  transcript por inteiro ou abortar a sessao. Red line eh hard stop porque o
  transcript comeca a dominar o orcamento de contexto do peer.

Os thresholds sao de **higiene operacional**, nao limites tecnicos do modelo
(janelas modernas sao muito maiores). O objetivo eh preservar atencao do peer
em evidencia viva, nao acomodar o maximo possivel.

Ordem de preservacao (MANDATORIA; comprimir/remover de BAIXO PRA CIMA ao
atingir yellow line):

1. Diretivas verbatim do usuario (normativas, feedback de coaching, mudancas
   de prioridade) -- NUNCA comprimir nem remover.
2. Achados residuais abertos + follow-ups com urgencia bloqueante em prazo --
   preservar integrais.
3. Evidencias validas (fingerprint match, nao stale) -- preservar.
4. Timeline das rodadas desta sessao: ultimas 2 rodadas integrais; rodadas
   anteriores compactadas para sumario de 3-5 linhas por rodada (achado,
   resposta, motivo do estado).
5. Evidencias stale -- remover ao atingir yellow line (stale ja nao conta
   para validacao por §3.4).
6. Apendices verbatim -- remover ao atingir yellow line.
7. Cross-session timeline (sessoes anteriores): apenas 1 linha por sessao
   (id, data, outcome, 1 achado significativo). Detalhamento adicional so
   se explicitamente exigido pelo escopo.

#### 6.6.2 Ledger (condicional ao uso; §6.5)

Ledger como artefato eh opcional (ver §6.5). Politica abaixo aplica-se
quando e se o ledger for adotado:

- Compactacao eh **manual** (trigger explicito pelo caller), nao automatica.
  Nenhum mecanismo de compactacao automatica ao abrir sessao eh permitido --
  automatizar aqui arrisca mudanca silenciosa de contrato entre sessoes.
- Sessoes com outcome=converged e idade superior a 90 dias podem ser
  reduzidas a sumario de 1 linha (id, data, outcome, 1 achado significativo).
- Sessoes com outcome=aborted ou outcome=max-rounds preservam-se integrais
  como debris operacional para aprendizado. Nao compactar.
- Threshold de 90 dias eh recomendacao prudencial; caller pode ajustar na
  ferramenta manual que eventualmente construir.

Ate 2026-04-24 nenhum ledger foi produzido em uso real; esta subsecao eh
contrato condicional, nao tarefa pendente.

#### 6.6.3 meta.json (artefato do MCP server)

Observacao empirica (auditoria 2026-04-24): nas 9 sessoes presentes em
`~/.cross-review/`, tamanhos de `meta.json` variaram de ~1KB a ~3KB; maior
sessao histrorica teve 6 rodadas. Sem pressao de overflow real.

Regra de contrato atual:
- `session_read` retorna `meta.json` integral.
- Nenhuma mudanca de API (ex: parametro `rounds_limit`, endpoint
  `session_digest`) eh justificada pelos dados empiricos disponiveis.
- Se no futuro uma sessao com 20+ rounds + peer_structured carregado produzir
  `meta.json` > 500KB e isso gerar pressao mensuravel em consumidores, spec
  futura (v4.2+) pode adicionar parametro opcional ao `session_read`. Ate la,
  YAGNI -- construir preventivamente leva a pick a shape errada.

Motivacao explicita: respeitar o principio "nao desenhar para requisitos
hipoteticos". Evidencia de pressao real eh condicao necessaria para mudanca
de API.

#### 6.6.4 Non-destructive compression (invariante normativa)

Quando o caller, humano ou ferramenta, montar transcript ou ledger
compactado para envio ao peer, o artefato compactado DEVE declarar
explicitamente quais trechos foram resumidos, removidos ou substituidos por
referencia, incluindo o caminho dos artefatos imutaveis que preservam o
detalhe original.

Exemplo de declaracao aceitavel dentro do transcript compactado:

```
[SUMMARY round 1-3 da sessao X: 1 achado cada; detalhe integral em
 C:/Users/leona/.cross-review/<sid>/round-01-peer-codex.md (e 02, 03)]
[REMOVED apendice verbatim Y: 2300 chars; reconstruivel a partir do commit
 Z do repo W]
```

Historico runtime do MCP eh **imutavel**. Os arquivos
`~/.cross-review/<sid>/meta.json`,
`~/.cross-review/<sid>/round-NN-prompt.md` e
`~/.cross-review/<sid>/round-NN-peer-<agent>.md` NAO podem ser mutados apos
escrita pelo server -- nem pelo caller, nem por ferramenta auxiliar,
nem como efeito colateral de compactacao do transcript. Mutar historico eh
violacao estrutural do contrato (perde auditabilidade, invalida fingerprints,
quebra continuidade entre sessoes).

Exclusao explicita: `~/.cross-review/<sid>/.lock/info.json` eh mecanismo
interno de controle de concorrencia do session-store (ver §6.5 do
peer-spawn/session-store em codigo). Lock diretorio eh criado e removido
pelo server dentro do ciclo de `ask_peer`; seu conteudo nao eh parte do
registro auditavel da sessao e nao esta coberto pela invariante de
imutabilidade acima. Caller/ferramentas externas continuam proibidas de
mutar o lock (invadir controle de concorrencia eh outro tipo de violacao
estrutural), mas a razao eh diferente da invariante de historico.

Compactacao/compressao ocorre EXCLUSIVAMENTE em:
- Transcript montado pelo caller em path temp, proprio da sessao atual.
- Ledger opcional, que pertence ao caller (§6.5).

Ambos artefatos montados pelo caller, ambos fora da arvore
`~/.cross-review/<sid>/` gerenciada pelo server.

### 6.7 Matriz minima de evidencia por classe de artefato (ATUALIZADO como FOLLOW-UP nao-bloqueante)

Continua FOLLOW-UP (nao-normativo), mas a primeira aproximacao foi revisada
em v3 para refletir mudancas operacionais (test script generico em vez de
vitest especifico; cross-review-mcp proprio ganha entrada dedicada).


```
FOLLOW-UP: definir matriz minima de evidencia por classe de artefato.
- por que: evitar negociacao ad-hoc sobre "o que o caller deveria ter rodado".
- escopo apropriado: documento anexo a este spec, iterado conforme novos
  tipos de arquivo aparecem.
- urgencia: desejavel.
- primeira aproximacao:
  - JavaScript/Node source: node --check + linter (biome/eslint) se
    configurado + vitest/test script se ha testes + tsc --noEmit se
    typescript.
  - TypeScript source: tsc --noEmit + linter + vitest/test script.
  - Markdown: sem validacao dinamica (so revisao semantica).
  - JSON: parser (node -e "JSON.parse(require('fs').readFileSync(path,'utf8'))").
  - YAML: parser yaml dedicado.
  - wrangler.json: npx wrangler deploy --dry-run se aplicavel.
  - cross-review-mcp proprio: `npm test` (= functional-smoke, 40 steps).
```

### 6.8 Schema expandido do bloco estruturado -- IMPLEMENTADO em v0.4.0-alpha

Implementacao aprovada bilateral na sessao 08cd61e6 (2026-04-24). Consenso
em esquema JSON estavel alcancado em 2 rodadas. Contrato normativo agora em
secao 2.3.1. Campos canonicos na release v0.4.0: `uncertainty`,
`caller_requests`, `follow_ups`. Strings em arrays (nao objetos). Extensao
para objetos reservada a v5 caso strings se mostrem insuficientes (FOLLOW-UP
registrado na sessao, fora do escopo v0.4.0).

Acessos derivados desta implementacao:
- `parser_warnings` agora compoe o contrato de retorno do parser (secao 5).
- Regra `omit-unless-signal` (secao 2.3.1) eh clausula operacional
  normativa: peers que emitem campos opcionais sem conteudo util cometem
  violacao operacional, ainda que o parser aceite.

### 6.9 Ferramentas complementares obrigatorias (NOVO em v4)

Duas clausulas operacionais normativas cuja violacao constitui falha de
processo (diferente de "bloco malformado", que e falha de protocolo).

#### 6.9.1 Tri-tool

Caller e peer MUST usar os tres MCP servers em conjunto em decisoes
nao-triviais durante qualquer sessao cross-review:

- **cross-review**: orquestrador bilateral (este MCP).
- **ultrathink**: raciocinio estruturado com quality validation.
- **code-reasoning**: analise tecnica iterativa com revisao.

Aplicacoes especificas:
- ANTES de `session_init`: caller DEVE ter trace de thinking visivel em
  ultrathink/code-reasoning justificando escopo, plano, criterios de
  sucesso. Sessoes abertas "frias" (sem pre-trace) sao violacao
  operacional.
- DURANTE `ask_peer`: prompts do caller DEVEM explicitamente pedir ao peer
  o mesmo rigor. Prompts cross-review densos pressupoem raciocinio
  estruturado do peer, nao inspecao superficial.
- ENTRE rodadas: caller DEVE rodar ultrathink/code-reasoning sobre a
  resposta do peer antes de formular proximo prompt. Reacao instantanea
  sem analise eh violacao.
- Indisponibilidade de ferramenta: quando um dos tres MCP nao responde, a
  sessao DEVE ser declarada bloqueada/suspensa explicitamente. NAO prosseguir
  como se nada tivesse mudado.

Motivacao registrada (diretiva do usuario em 2026-04-24): "os tres
trabalhando em conjunto eh a arma mais letal contra os constantes erros
cometidos pelos agentes de AI que gastam um tempo imenso e tem um custo de
tokens gigantescos para efetuar correcoes posteriores." Custo/latencia NAO
sao alvos de otimizacao (ver tambem 6.9.2).

#### 6.9.2 Modelo top-level

Ambos caller e peer MUST operar sob o modelo mais capaz disponivel na
assinatura do usuario. IDs canonicos normativos para v0.4.0:

- **Codex (peer quando caller=claude)**: `gpt-5.5` com
  `model_reasoning_effort=xhigh`. Flag de modelo explicita em
  `src/lib/peer-spawn.js:buildCodexArgs`.
- **Claude (peer quando caller=codex)**: `claude-opus-4-7` (ID completo,
  nao alias). Flag explicita em `src/lib/peer-spawn.js:buildClaudeArgs`.

Clausulas operacionais:
- SEM fallback silencioso: se o modelo top-level falhar (rate limit,
  erro 401/429/5xx, indisponibilidade), a sessao DEVE ser abortada com
  erro explicito. Degradacao para variante menor eh violacao.
- Troca de modelo exige bump de release (v0.4.x -> v0.5.0+) + edicao
  explicita desta secao. Atualizacao silenciosa do ID em `peer-spawn.js`
  sem bump da spec eh violacao.
- Auditabilidade: cada round persistido em `meta.json.rounds[i]` contem
  `peer_model` refletindo o ID efetivamente passado. Revisao periodica
  (em cada release) DEVE confirmar que os IDs continuam top-level -- se
  um ID listado foi superado por um novo top-level, sessao de cross-review
  dedicada decide a promocao.
- Stubs de teste registram `peer_model: 'stub'`, distinguindo execucao
  sintetica de real.

Motivacao registrada (diretiva do usuario em 2026-04-24): "sempre sempre
sempre deve chamar o modelo mais atual, mais capaz, mais poderoso, mais
top level disponivel na assinatura". Usuario eh assinante do tier mais
caro de OpenAI e Anthropic; nao ha gating de plano para modelos top.

---

## 7. Resumo das convencoes para uso imediato (ATUALIZADO ate v4.1)

| Convencao | Acao do caller |
|-----------|---------------|
| Abertura de sessao | Transcript ASCII-only + clausula de escopo + artifacts com fingerprint; trace ultrathink/code-reasoning pre-session_init obrigatorio (secao 6.9.1) |
| Contrato STATUS | Reiterar template em cada prompt; bloco estruturado preferido com schema expandido v4 opcional (2.3.1), fallback legacy aceito; ambos ancorados em tail |
| Campos opcionais | Omit-unless-signal: `uncertainty`/`caller_requests`/`follow_ups` apenas quando valor altera leitura do parecer |
| Validacao dinamica | Matriz pro-ativa; atender CALLER_REQUEST do peer com NEEDS_EVIDENCE |
| Escopo | FOLLOW-UP para fora-escopo; aborted para nao-convergencia honesta |
| Ruido | Consumir content + peer_status + peer_structured + status_source + parser_warnings + peer_model |
| Warnings | `parser_warnings` nao eh telemetria morta: inspecionar e agir (peer drift ou schema violation) |
| Modelo | Peer sempre invocado com top-level (codex=gpt-5.5 xhigh, claude=claude-opus-4-7); sem fallback silencioso |
| Encoding | ASCII-only em arquivos em disco; prompts podem ter acentos |
| Continuidade | Ledger opcional (§6.5); quando adotado, manter ASCII-only e anexar em sessoes subsequentes |
| Overflow | Yellow 50k / Red 100k chars no transcript (§6.6.1); compressao non-destructive (§6.6.4) com referencia aos imutaveis; meta.json sem mudanca de API (§6.6.3 YAGNI) |
| Janela de transicao | Durante upgrade do server, peer emite ambos formatos ate reload confirmado |

---

## 8. Criterios de aceitacao (atualizados em v4.1)

- Spec v4 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review 08cd61e6 (2026-04-24, 2 rodadas).
- Spec v4.1 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review a847f897 (2026-04-24). v4.1 eh revisao spec-only de v4 --
  nao toca em codigo.

Uma vez aceita e publicada:
- Substitui revisao anterior in-place.
- Referenciada como a spec ativa em novas sessoes.
- Fica congelada ate nova sessao de spec ser aberta (sem amend silencioso).

Follow-ups pos-v4.1 (registrados mas fora do escopo desta release):
- Secao 6.7 (matriz minima de evidencia por classe de artefato) -- proxima
  sessao dedicada.
- Secao 6.9.2: auto-discovery controlado de modelo top-level com
  auditabilidade (registrado como follow_up do Codex na sessao 08cd61e6).
- Secao 2.3.1: reconsideracao de `caller_requests`/`follow_ups` como arrays
  de objetos (em vez de strings) caso strings se mostrem insuficientes em
  uso real (registrado como follow_up do Codex na sessao 08cd61e6).
- Drift de versao entre `package.json` (0.3.0-alpha), `package-lock.json`
  (0.2.0-alpha) e `src/server.js` (0.4.0-alpha) -- saneamento de higiene de
  versionamento em sessao separada (registrado como follow_up do Codex na
  sessao a847f897).
- Gatilho opcional para `rounds_limit`/`session_digest` em `session_read` --
  somente se/quando meta.json real atingir pressao de overflow mensuravel
  (§6.6.3).
