# cross-review-mcp

MCP server orquestrando revisao cruzada entre Claude Code e ChatGPT Codex.

Nota editorial: este arquivo e consumido pelo peer em sessoes de cross-review.
Por forca da regra canonica 6.4 da workflow-spec ("artifacts escritos para
consumo do peer devem ser ASCII-only com transliteracao de acentos do
portugues"), todo o conteudo abaixo e ASCII 7-bit puro.

## Contrato de resposta do peer (desde 0.3.0-alpha)

O peer DEVE finalizar sua resposta com status parseavel. Formatos aceitos,
em ordem de preferencia:

1. **Bloco estruturado (preferido)**, com o closing tag como TAIL da resposta
   (qualquer whitespace trailing e ignorado):
   ```
   <cross_review_status>{"status":"READY"}</cross_review_status>
   ```
   Valores validos de `status`: `READY` | `NOT_READY` | `NEEDS_EVIDENCE`.
   Payload JSON parsed com `JSON.parse`; aceita multi-linha entre as tags,
   desde que o closing tag seja a ultima sequencia nao-branca do texto.

2. **Fallback legacy (backwards-compat)**: ULTIMA linha nao-vazia no formato
   EXATO (case-sensitive):
   ```
   STATUS: READY
   ```
   (ou `NOT_READY` / `NEEDS_EVIDENCE`). Regex canonica:
   `^STATUS: (READY|NOT_READY|NEEDS_EVIDENCE)$` aplicada sobre a ultima linha
   apos trim.

O parser inspeciona APENAS o tail da resposta. Mencoes de `STATUS: X` ou de
`</cross_review_status>` dentro da prosa anterior NAO disparam falso positivo.

Se o tail da resposta terminar com `</cross_review_status>` mas o JSON
interno for invalido, ou o status estiver fora do enum
`{READY, NOT_READY, NEEDS_EVIDENCE}`, o parser retorna status=null (nao cai
no fallback regex, porque a ultima linha nao-vazia ja e o closing tag).

Quando o parser identifica status, expoe ao caller o campo `status_source`
(`structured` | `regex` | `null`) para auditoria. `peer_structured` carrega o
objeto JSON parseado apenas quando o bloco estruturado venceu; nos demais
casos, `null`.

### Semantica dos estados

- **READY**: peer nao tem achado material; concorda com o parecer do caller
  (ou declaracao explicita de convergencia).
- **NOT_READY**: peer tem achado tecnico, objecao, ou aplicou mudancas que
  precisam de nova rodada. E tambem o estado correto para caller sem
  evidencia dinamica (emitir NOT_READY + bloco CALLER_REQUEST conforme
  workflow-spec 3.3).
- **NEEDS_EVIDENCE**: peer nao consegue concluir sem evidencia dinamica que
  nao foi anexada. Caller deve, na rodada seguinte, rodar os comandos
  solicitados via `CALLER_REQUEST` (ver workflow-spec 3.3) e anexar output
  bruto. Tratar como bloqueante, mas semanticamente distinto de `NOT_READY`:
  nao e objecao tecnica, e pedido de prova.

Convergencia bilateral exige `caller_status === 'READY' && peer_status ===
'READY'` na mesma rodada. `NEEDS_EVIDENCE` nunca converge. `caller_status`
e restrito a `READY|NOT_READY` (a assimetria e intencional per
workflow-spec 3.3: caller sem evidencia usa NOT_READY + CALLER_REQUEST).

## Status -- Commit 1 (hard gate de isolation)

**Veredito arquitetural:** design do spawn do reviewer **aprovado** pela
evidencia cruzada. Nao aprovado pelo probe local por falha de metodologia
(ver abaixo).

### O que o design aprovado diz

Spawn do Codex reviewer:

```
codex -a never -s read-only exec
  --skip-git-repo-check
  -c mcp_servers.<mcp-externo-x>.enabled=false   (para cada excluido)
  -c apps.<app-id>.enabled=false                  (para cada conector OpenAI-curated)
  -c mcp_servers.<server>.tools.<tool>.approval_mode=approve   (para cada tool read-only essencial)
  -
```

**Evidencia que sustenta:**

- `apps.<id>.enabled=false` e `mcp_servers.<x>.enabled=false` sao namespaces
  separados. Um nao interfere no outro. (Codex validou live em 0.124.0.)
- `approval_mode=approve` com chave
  `mcp_servers.<server>.tools.<tool>.approval_mode` libera a tool sob
  `-a never -s read-only`. Codex validou em 0.124.0:
  `mcp: memory/search_nodes (completed)`.
- Tool name em underscore (`search_nodes`) esta correto;
  `sequential-thinking-ultra` existe com dash no `config.toml` do usuario
  porque e o nome canonico que aquele server especifico declara.
- Values documentados de `approval_mode`: `auto | prompt | approve`.
- `-a on-failure` esta deprecated; evitar.

### O que o probe local mede errado

O probe atual em `scripts/probe-reviewer-isolation.js` pede ao agente que
"invoque a tool memory.search_nodes". Em 0.124.0 o agente, quando nao ve a
tool diretamente no catalogo narrado, tenta invocar via shell subprocess
(`codex mcp call memory search_nodes`), o que e bloqueado pelo sandbox
`-s read-only`. Resultado: `AGENT_DID_NOT_ATTEMPT_CALL` no verdict, apesar
da tool estar dispatchable.

Isto e **falha da metodologia do probe**, nao falha do design. Narracao do
agente != capacidade real do dispatcher.

### Proximo passo do probe (tarefa residual, nao-bloqueante)

Refatorar o probe para um formato que prove capacidade independente da
narracao:

- Opcao A: script Node que abre conexao MCP stdio direta com o server
  `memory` (via `@modelcontextprotocol/sdk`) e invoca `search_nodes` sem
  passar pelo agente. Observacao: o subcomando `codex mcp call` **nao
  existe** no `codex-cli 0.124.0` (apenas `list/get/add/remove/login/
  logout/help`), entao esse caminho precisa ser implementado em Node, nao
  via wrapper CLI.
- Opcao B: criar um MCP tool no proprio server cross-review-mcp que chama
  `memory.search_nodes` internamente e reporta sucesso -- testa o
  dispatcher a partir de outro MCP.
- Opcao C: aceitar o parecer cruzado como evidencia suficiente (Codex ja
  validou live) e seguir para Commit 2.

### Commit 2 -- implementacao do server MCP propriamente dito

**Desbloqueado.** O design do spawn tem evidencia suficiente para comecar.
O probe refinado pode rodar em paralelo.

## Estrutura do projeto

```
cross-review-mcp/
|-- package.json
|-- reviewer-configs/
|   |-- peer-exclusions.json         # disables e approve_tools do Codex reviewer
|   |-- reviewer-minimal.mcp.json    # MCP config para --strict-mcp-config do Claude reviewer
|-- scripts/
|   |-- probe-reviewer-isolation.js  # hard gate de isolamento (Commit 1)
|   |-- functional-smoke.js          # smoke JSON-RPC stdio (Commit 3)
|-- src/
|   |-- server.js                    # entry MCP, 5 tools
|   |-- lib/
|       |-- session-store.js         # state em ~/.cross-review/; atomic I/O + lock
|       |-- peer-spawn.js            # spawn contido do peer (Codex / Claude)
|       |-- status-parser.js         # parser STATUS: READY / NOT_READY / NEEDS_EVIDENCE + bloco estruturado
|-- probe-results.json                # ultima execucao do probe de isolamento
|-- README.md                         # este arquivo
```

## Config canonico derivado do spike

### Para o usuario (config persistente do Codex)

`~/.codex/config.toml`:

```toml
[mcp_servers.cross-review]
command = "node"
args = ["C:/Users/leona/lcv-workspace/cross-review-mcp/src/server.js"]
env = { CROSS_REVIEW_CALLER = "codex" }
tool_timeout_sec = 1800
```

Approval mode por-tool (se o usuario quiser que Claude chame esses tools ao
rodar em modo `-a never` via pipeline do server):

```toml
[mcp_servers.cross-review.tools.ask_peer]
approval_mode = "approve"
```

### No spawn do peer (dentro do ask_peer)

Baseline definitivo para o reviewer Codex:

```
codex -a never -s read-only exec --skip-git-repo-check
  # MCPs externos destrutivos
  -c mcp_servers.github.enabled=false
  -c mcp_servers.fetch.enabled=false
  -c mcp_servers.puppeteer.enabled=false
  -c mcp_servers.cloudflare-api.enabled=false
  -c mcp_servers.cloudflare-bindings.enabled=false
  -c mcp_servers.cloudflare-builds.enabled=false
  -c mcp_servers.sumup.enabled=false
  -c mcp_servers.google-developer-knowledge.enabled=false
  -c mcp_servers.jina-mcp-server.enabled=false
  -c mcp_servers.mcp-image.enabled=false
  # `-c mcp_servers.cross-review.enabled=false` -- adicionar SE E SOMENTE SE o server
  # ja existir em ~/.codex/config.toml. Override sobre server inexistente produz
  # "invalid transport" porque Codex tenta construir uma entrada incompleta.
  # No spawn real do peer, essa linha deve ser gerada condicionalmente (ver
  # intersecao com CONFIGURED_CODEX_SERVERS em scripts/probe-reviewer-isolation.js).
  # Apps/conectores OpenAI-curated
  -c apps.canva.enabled=false
  -c apps.github.enabled=false
  -c apps.gmail.enabled=false
  -c apps.google_calendar.enabled=false
  -c apps.google_contacts.enabled=false
  -c apps.google_drive.enabled=false
  -c apps.linear_codex_agent.enabled=false
  # Approvals para tools read-only essenciais do reviewer
  -c mcp_servers.memory.tools.search_nodes.approval_mode=approve
  -c mcp_servers.memory.tools.read_graph.approval_mode=approve
  -c mcp_servers.memory.tools.open_nodes.approval_mode=approve
  -
```

### Para Claude reviewer

```
claude -p --output-format text
  --permission-mode default
  --strict-mcp-config --mcp-config C:/Users/leona/lcv-workspace/cross-review-mcp/reviewer-configs/reviewer-minimal.mcp.json
  --disallowed-tools "Write,Edit,NotebookEdit"
```

## Historico das iteracoes do hard gate

| Iteracao | Mudanca | Verdict observado | Parecer do Codex |
|---|---|---|---|
| 1 | Baseline: `-a never -s read-only` so com `mcp_servers.*.enabled=false` | CONTAINED_MODE_FAILED (memory auto-denied) + CODEX_APPS_LEAK (~130 tools via plugins) | F1 + F2 concretos |
| 2 | + `apps.*.enabled=false` + `approval_mode=approve` + aggregator fix | INCONCLUSIVE (agente reportou "None directly visible") | F2 fechado; F1 agora ambiguo |
| 3 | Probe reformulado pedindo invocacao explicita | AGENT_DID_NOT_ATTEMPT_CALL (agente caiu no shell fallback) | design confirmado; probe mede errado |

Design aceito cruzadamente; Commit 2 pode iniciar.

---

## Install + Uso

### Pre-requisitos
- Node.js 18+
- `claude` (Claude Code CLI) e `codex` (Codex CLI) instalados, autenticados, no PATH
- `cd C:/Users/leona/lcv-workspace/cross-review-mcp && npm install` (instala `@modelcontextprotocol/sdk`)

### Registrar no Claude Code

```powershell
claude mcp add -e CROSS_REVIEW_CALLER=claude -s user cross-review -- node C:/Users/leona/lcv-workspace/cross-review-mcp/src/server.js
```

Verificar: `claude mcp get cross-review` deve mostrar `Status: Connected`.

### Registrar no ChatGPT Codex

Adicionar ao final de `~/.codex/config.toml`:

```toml
[mcp_servers.cross-review]
command = "node"
args = ["C:/Users/leona/lcv-workspace/cross-review-mcp/src/server.js"]
env = { CROSS_REVIEW_CALLER = "codex" }
tool_timeout_sec = 1800
```

Verificar: `codex mcp get cross-review` deve mostrar
`enabled: true, transport: stdio`.

### Recarregar as extensoes VS Code
VS Code -> Command Palette -> "Developer: Reload Window", para cada janela
com Claude Code ou Codex ativos.

### Prompt template para sessao

Colar no chat de QUALQUER uma das duas extensoes (o server detecta
identidade pelo env var):

```
Use o cross-review MCP para revisar <ARTEFATO>.

Protocolo:
1. Chame session_init com task=<descricao> e artifacts=[<paths absolutos>]
   -> salve session_id.
2. Leia os artefatos indicados. Produza seu parecer tecnico rigoroso com
   severidades (critico/alto/medio/baixo) e verdict.
3. Chame ask_peer passando:
   - session_id
   - prompt: seu parecer completo + esta instrucao ao peer: "Audite meu
     parecer contra os arquivos em disco. Classifique achados por
     severidade. Termine sua resposta com o bloco estruturado canonico como
     tail (ultima sequencia nao-branca):
     <cross_review_status>{\"status\":\"READY\"}</cross_review_status>
     (se nenhum achado material),
     <cross_review_status>{\"status\":\"NOT_READY\"}</cross_review_status>
     (se ha achado material), ou
     <cross_review_status>{\"status\":\"NEEDS_EVIDENCE\"}</cross_review_status>
     (se voce nao consegue concluir sem evidencia dinamica -- comandos a
     rodar, outputs a observar). Fallback legacy aceito: uma unica linha
     final 'STATUS: READY', 'STATUS: NOT_READY', ou 'STATUS: NEEDS_EVIDENCE'
     case-sensitive."
   - caller_status: 'NOT_READY' na primeira rodada sempre
4. Examine o peer_status retornado e o conteudo da resposta do peer:
   - Se peer disse NOT_READY: incorpore achados validos, refute invalidos
     com evidencia, volte ao passo 3 com caller_status='NOT_READY'.
   - Se peer disse NEEDS_EVIDENCE: leia o bloco CALLER_REQUEST, rode os
     comandos solicitados, anexe output bruto + fingerprint do artefato,
     volte ao passo 3 com caller_status='NOT_READY'.
   - Se peer disse READY e voce tambem concorda que nada mais falta:
     proxima chamada de ask_peer com caller_status='READY' para travar a
     convergencia.
5. Chame session_check_convergence apos cada rodada.
   - Se converged=true: chame session_finalize(outcome='converged') e
     apresente o parecer consolidado.
   - Se converged=false: continue iterando.
6. Safety cap: maximo 10 rodadas. Ao atingir,
   session_finalize(outcome='max-rounds').
```

### Observar a sessao em disco

Estado em tempo real: `~/.cross-review/<session-id>/`
- `meta.json` -- indice completo dos turns, caller_status, peer_status,
  peer_structured, status_source, duration_ms
- `round-NN-prompt.md` -- prompt enviado ao peer
- `round-NN-peer-<agent>.md` -- resposta crua do peer

Util para debug quando a sessao desvia do esperado.

### Desinstalar

```powershell
claude mcp remove cross-review -s user
codex mcp remove cross-review
```

(ou remover o bloco `[mcp_servers.cross-review]` manualmente de
`~/.codex/config.toml`)
