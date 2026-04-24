# Cross-Review MCP Workflow Specification v3 (DRAFT)

**Status**: draft elevando v2 (sessao 7d745f38, aprovada bilateral) a normativa
absorvendo as mudancas arquiteturais de `cross-review-mcp` v0.3.0-alpha
(sessao 0e427278, aprovada bilateral em 5 rodadas).

Encoding: ASCII-only com transliteracao de acentos do portugues. Motivo
operacional em secao 6.4.

---

## 0. Delta v2 -> v3 (sumario executivo)

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

Payload JSON nesta versao contem apenas o campo `status`. Campos adicionais
(`uncertainty`, `caller_requests`, `follow_ups`) permanecem como convencoes
textuais (secoes 3.3, 4.3, 6.3); sua incorporacao ao schema JSON e tratada
como FOLLOW-UP separado (secao 6.8 nova).

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

## 5. Ruido (ATUALIZADO em v3)

Caller consome apenas `content`, `peer_status`, `peer_structured`, e
`status_source`. Em v2, o conjunto consumido era `content` + `peer_status`
apenas; `peer_structured` e `status_source` foram introduzidos em
v0.3.0-alpha e agora integram o payload util para decisao do caller (ex:
`status_source === 'structured'` confirma que o peer respeitou o contrato
preferido; `peer_structured` permite acesso direto ao JSON completo).

`stderr_tail` e telemetria de transporte, guardada apenas para diagnostico
do proprio mecanismo. Nenhuma decisao tecnica ou formal e baseada em
stderr_tail.

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

### 6.5 Ledger de continuidade entre sessoes (MANTIDO de v2)

Caller mantem ledger em arquivo persistente (ex:
`C:\Users\leona\.cross-review\ledger.md`) com:
- Sessoes anteriores (id, data, outcome, escopo).
- Achados fechados.
- Achados residuais aceitos + fronteira arquitetural.
- Follow-ups pendentes.

Ledger em ASCII-only. Novo session_init anexa ledger como artifact quando o
alvo relaciona-se a sessoes previas.

### 6.6 Overflow / truncamento (MANTIDO como FOLLOW-UP nao-bloqueante)

```
FOLLOW-UP: politica de overflow e truncamento do transcript/ledger.
- por que: artefatos crescem monotonicamente com o tempo.
- escopo apropriado: sessao dedicada a politicas de compactacao.
- urgencia: desejavel (nao bloqueia uso imediato enquanto artefatos sao
  pequenos).
- primeira aproximacao: ordem de preservacao = diretivas verbatim do user >
  achados residuais > timeline das sessoes > evidencias validas > evidencias
  stale > apendices. Comprimir/remover de baixo pra cima ao encostar em
  orcamento de contexto.
```

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

### 6.8 Schema expandido do bloco estruturado (NOVO FOLLOW-UP em v3)

```
FOLLOW-UP: evoluir o payload JSON do bloco estruturado para incorporar
campos hoje tratados como convencoes textuais.
- campo obrigatorio (permanece): status (string no enum
  {READY, NOT_READY, NEEDS_EVIDENCE}). Todos os novos campos sao OPCIONAIS;
  payload apenas com status continua valido em perpetuidade.
- campos candidatos (opcionais): uncertainty (array), caller_requests
  (array com { command, purpose, acceptance }), follow_ups (array com
  { description, why, scope, urgency }).
- por que: hoje caller extrai essas informacoes por parsing do conteudo
  livre, o que e fragil. Campos estruturados eliminariam.
- escopo apropriado: proxima iteracao major do cross-review-mcp (v0.4.0 ou
  posterior), com migracao controlada (manter campos opcionais).
- urgencia: desejavel (nao bloqueia uso imediato; textual funciona).
- pre-requisito: consenso em esquema JSON estavel (requer sessao cross-review
  dedicada).
```

---

## 7. Resumo das convencoes para uso imediato (ATUALIZADO em v3)

| Convencao | Acao do caller |
|-----------|---------------|
| Abertura de sessao | Transcript ASCII-only + clausula de escopo + artifacts com fingerprint |
| Contrato STATUS | Reiterar template em cada prompt; bloco estruturado preferido, fallback legacy aceito; ambos ancorados em tail/last-non-empty-line |
| Validacao dinamica | Matriz pro-ativa; atender CALLER_REQUEST do peer com NEEDS_EVIDENCE |
| Escopo | FOLLOW-UP para fora-escopo; aborted para nao-convergencia honesta |
| Ruido | Consumir apenas content + peer_status + peer_structured + status_source |
| Encoding | ASCII-only em arquivos em disco; prompts podem ter acentos |
| Continuidade | Manter ledger ASCII-only; anexar em sessoes subsequentes |
| Janela de transicao | Durante upgrade do server, peer emite ambos formatos ate reload confirmado |

---

## 8. Criterios de aceitacao da v3

Esta spec v3 deve ser aprovada bilateralmente (Claude + Codex) em sessao
cross-review dedicada antes de se tornar normativa. Uma vez aceita:
- Substitui `cross-review-workflow-spec.md` v2.
- Referenciada como a spec ativa em novas sessoes.
- Fica congelada ate nova sessao de spec ser aberta (sem amend silencioso).
