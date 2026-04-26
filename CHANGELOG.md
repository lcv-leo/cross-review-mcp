# CHANGELOG — cross-review-mcp

Histórico de mudanças do servidor MCP de cross-review (bilateral claude↔codex e, desde v0.5.0-alpha, triangular claude↔codex↔gemini).

**Convenção de versão:** SemVer para código (`package.json` `version` + `src/server.js` MCP identity). O versionamento da spec (`docs/workflow-spec.md`) tem seu próprio ciclo (v2/v3/v4/v4.1/.../v4.8) documentado internamente; releases spec-only NÃO bumpam o código.

**Convenção de seções:** Adicionado / Alterado / Corrigido / Removido por release, em ordem cronológica reversa (mais recente primeiro).

---

## [Unreleased]

### Adicionado
- (em aberto — F2/F3/F5/F6 from `docs/external-audit-2026-04-26-gemini.md` deferred for v1.3+: success-path output redaction, full Zod runtime validation, per-stream byte cap, lock token verification.)

---

## [1.2.1] — 2026-04-26

**External-audit hardening from Gemini audit 2026-04-26.** Three concrete findings shipped (F1, F7, F8 from `docs/external-audit-2026-04-26-gemini.md`); four defense-in-depth follow-ups deferred to v1.3+ with rationale documented.

### Corrigido — F1 path-traversal defense in `sessionDir`
- **`src/lib/session-store.js`**: `sessionDir(sessionId)` now calls `assertValidSessionId` (UUID 8-4-4-4-12 hex regex) before any filesystem op + applies `path.resolve` containment check (resolved path must start with resolved STATE_DIR + sep). Defense in depth — threat model is "trusted MCP host" but a malicious or buggy caller passing `session_id: '../../foo'` would have escaped via `path.join`.
- New `UUID_RE` constant + `assertValidSessionId` exported helper.
- **5 new smoke invariants** in `driveV414PathTraversalGuardUnit`:
  - traversal payloads (`../foo`, `../../etc/passwd`, `..\\..\\Windows\\System32`, `a/b`, `a\\b`) all throw.
  - non-UUID strings (empty, partial-length groups) throw.
  - non-string types (null, number) throw.
  - valid UUID (`12345678-1234-1234-1234-123456789012`) is accepted.

### Corrigido — F7 log prefix semantic clarity
- **`src/server.js`**: `log()` prefix changed from `caller=${CALLER}` to `env_caller=${CALLER}` to make explicit that the prefix names the SERVER INSTANCE'S env-var-configured caller, not the round's session-resolved caller. Per-round logs already pass session-specific context via the `meta` arg of `log()`. Closes the gap left over from v1.2.0 §6.20 where `meta.caller` became dynamic but the log prefix still showed env-var.

### Corrigido — F8 stale model ID in tool description
- **`src/server.js` line 482** (`ask_peer` description): `gemini=gemini-2.5-pro` → `gemini=gemini-3.1-pro-preview` to match `peer-spawn.js` `GEMINI_MODEL` constant.
- **New smoke step** (`driveV414ToolDescriptionDriftUnit`):
  - asserts no stale gemini model IDs (`gemini-2.5-pro`, `gemini-2.0-pro`, `gemini-1.5-pro`) appear in any tool description block.
  - asserts each pinned model ID (`CODEX_MODEL`, `CLAUDE_MODEL`, `GEMINI_MODEL`) appears in `server.js` at least once.

### Adicionado — audit response document
- **`docs/external-audit-2026-04-26-gemini.md`** (NEW): full validation matrix for the Gemini audit — every finding mapped to "verified against v1.2.0 source", "shipped in v1.2.1", or "deferred / why". Includes operator action item (Gemini CLI trust-directory configuration) noted in the audit's environment.

### Deferred to v1.3+ (P2/P3 from external audit)
- **F3** success-path output redaction (medium effort, P2)
- **F4** full Zod runtime validation (medium effort, P2 — F1 closes the highest-value subcase)
- **F5** per-stream byte cap (medium effort, P2 — `session_sweep` already addresses disk side)
- **F6** lock token verification (small effort, P3 — bounded race, no field evidence)
- **F2** `shell:false` + arg arrays (medium effort, P3 — no real attack surface; track if dynamic-arg use case emerges)

### Validação
- `npm test` 151 GREEN (was 147 in v1.2.0; +3 hardening invariants for F1 + F8).
- `npm run check-models` GREEN.

---

## [1.2.0] — 2026-04-26

**Spec v4.14 + dynamic caller resolution + anti-drift smoke.** Operator observed a real bug post-v1.1.0 ship: a Gemini-initiated session against a cross-review-mcp instance configured with `CROSS_REVIEW_CALLER=claude` recorded `meta.caller: 'claude'`, mis-attributing identity. The audit's caller distribution skew (claude 78% / codex 20% / gemini 2%) was therefore partially artificial — an unknown fraction of "claude" sessions were actually gemini-initiated. Fix: dynamic per-session caller resolution + anti-drift discipline so README/docs stay in sync with shipped versions.

### Adicionado — runtime
- **§6.20 dynamic caller resolution.** New `resolveCallerForSession(argsCaller, clientInfo)` in `src/server.js` with precedence: (1) `args.caller` explicit override > (2) MCP `clientInfo.name` substring-mapped to agent > (3) `CROSS_REVIEW_CALLER` env var. Throws if all three fail.
- **`session_init` accepts optional `caller` arg** (validated against `VALID_AGENTS`). Captures `clientInfo` via `server.getClientVersion()` at call time. Resolves caller, computes `peersForCaller(caller)` dynamically, runs the probe against the resolved peer set (not env-derived global PEERS).
- **`meta.caller_resolution = { source, client_info_name }`** new audit field. Records HOW the caller was resolved (`'arg' | 'client_info' | 'env_var'`) so audit consumers distinguish explicit overrides from inferred defaults.
- **`ask_peer` reads from meta.** The bilateral gate now checks `legacyPeerForCaller(meta.caller)` instead of the global `LEGACY_PEER`. A gemini-resolved session calling `ask_peer` is correctly rejected. All references to `LEGACY_PEER` and `caller: CALLER` inside the handler swapped to `sessionLegacyPeer` and `sessionCaller`.
- **`ask_peers` reads from meta.** Spawns to `meta.peers` (or `peersForCaller(meta.caller)` as fallback for legacy meta). All references to global `PEERS`/`CALLER` inside the handler swapped to `metaPeers`/`sessionCaller`.
- **`runSessionInitProbe(peersList)` accepts dynamic peer list.** Defaults to global `PEERS` for backwards compat, but `session_init` passes the resolved peer set.

### Adicionado — spec v4.14
- **§0n (NEW)**: executive summary of v4.13 → v4.14 delta.
- **§6.20 (NEW)**: dynamic caller resolution contract. Strict precedence (arg > client_info > env_var). Throws when all three fail. `meta.caller_resolution` audit field. Per-session peers via `peersForCaller`. `ask_peer` + `ask_peers` read from meta. Backwards-compat: pre-v4.14 sessions tolerated.
- **Spec banner** bumped from v4.13 to v4.14.

### Adicionado — anti-drift smoke (operator-noticed regression)
- **Smoke step**: asserts `README.md` "Current release: **vX.Y.Z**" line matches `server.VERSION`. Prevents recurrence of v1.0.4/v1.0.5-style doc lag where releases shipped but READMEs stayed at v1.0.3 (operator-noticed 2026-04-26).
- **Smoke step**: asserts `README.md` mentions current spec version (e.g., `spec v4.14`) at least once.

### Adicionado — caller-resolution smoke (4 new steps)
- `clientInfo→agent mapping (claude/gemini/codex/unknown/null)` — substring match correctness.
- `resolveCallerForSession precedence (arg > client_info > env_var)` — full chain.
- `invalid caller throws + audit fields preserved` — error path + client_info_name preserved when arg wins.
- `peer-set derivation invariant under env-var caller` — global PEERS still correct under env-var caller.

### Atualizado — operator docs (catching up)
- **`README.md`**: spec badge v4.11 → v4.14; "Current release" v1.0.3 → v1.2.0; smoke count 125 → 143; release history table extended with v1.0.4/v1.0.5/v1.1.0/v1.2.0 entries.
- **`AGENTS.md`**: runtime line refreshed to v1.2.0 / spec v4.14; smoke count line refreshed to 143; spec range bumped.
- README/AGENTS drift was a real regression (operator-noticed 2026-04-26). Anti-drift smoke step prevents recurrence.

### Validação
- `npm test` 147 GREEN (was 141 in v1.1.0; +4 caller-resolution + +2 README anti-drift; the 141 pre-existing steps also exercise the dynamic caller wiring end-to-end).
- `npm run check-models` GREEN.

### Recovery (operator-noticed missing publish)
- The v1.0.4 and v1.0.5 GitHub Releases were missing because their commits were pushed to main without tags so the publish workflow never fired. Tags created retroactively on 2026-04-26; publish workflow ran successfully for both; npm packages + GitHub Packages now live; releases created via gh CLI manually (one-time recovery). v1.1.0's commit added a `create-github-release` job to `publish.yml` so future tag pushes auto-create releases — exercised successfully on v1.1.0's own tag push (release author: `github-actions[bot]`).

---

## [1.1.0] — 2026-04-26

**Spec v4.13 + audit closure release.** All four follow-ups (FU-1..FU-4) from the v1.0.5 60-session audit (`docs/session-audit-2026-04-26.md`) shipped in one release alongside spec v4.13. Implementation contracts validated by trilateral cross-review session `483b2d1c-6e82-42a3-bbcc-1e9ea61289f7` (caller=claude, peers=codex+gemini, READY in round 2). Also recovers v1.0.4 + v1.0.5 GitHub Releases (commits had been pushed to main without tags so the publish workflow never fired) and adds a `gh release create` step to `publish.yml` to prevent recurrence.

### Adicionado — runtime
- **FU-1 / spec §6.17 — `meta.spec_version` persistence.** New `SESSION_SPEC_VERSION = 'v4.13'` constant in `src/lib/session-store.js`; `initSession` writes `meta.spec_version` and `meta.outcome_reason: null` at session creation. Audit consumers can now reconstruct which spec rules were active when a given session ran.
- **FU-3 / spec §6.18 — long-idle session reconciliation.** New `session_sweep` tool with `{ stale_days = 7, dry_run = true, reason = 'stale' }` schema. Returns `{ candidates, finalized }`. Honors:
  - **24h hard floor** (non-overridable; sessions younger than 24h from last activity NEVER appear, even with `stale_days=0`).
  - **Last-activity staleness** (`max(started_at, rounds[].started_at, rounds[].completed_at)`); pure age is incorrect.
  - **Already-finalized exclusion.**
  - **Lock collision visibility** (`locked: true, would_finalize: false, skip_reason: 'locked'`).
  - **Read-only dry-run** (default `true`; no meta.json or mtime mutation).
  - **Re-read-before-write semantics** via new `finalizeIfUnset(sessionId, outcome, reason)` helper — prevents clobbering sessions that got finalized concurrently between enumeration and write.
  - **Malformed timestamps** reported with `skip_reason: 'malformed_timestamp'`, never auto-finalized.
  - **Outcome value:** always `'aborted'` (the v4 enum); structured "why" lives in `outcome_reason`.
- **FU-3 / spec §6.18 — `outcome_reason` field on `session_finalize`.** Optional `reason` argument; persisted as `meta.outcome_reason`. Conventions documented in spec: `'stale'`, `'peer_scope_creep'`, `'moderation_flag_unresolved'`, `'operator_abort'` (free-form string, open list).
- **FU-4 / spec §6.19 — convergence-health hint per round.** New `computeConvergenceHealth(roundCount)` in `src/server.js`; emitted as `convergence_health: 'normal' | 'extended' | 'concerning'` on every `ask_peer`/`ask_peers` response and persisted into `round.convergence_health` for audit aggregation. Thresholds (in code, not spec, tunable without spec bump): `extended` at rounds≥6, `concerning` at rounds≥8. **Purely advisory** — no automatic status/outcome change.

### Adicionado — spec v4.13
- **§0m (NEW)**: executive summary of v4.12 → v4.13 delta.
- **§6.17 (NEW)**: spec-version persistence in meta.json normative contract.
- **§6.18 (NEW)**: long-idle session reconciliation contract (8 normative requirements: last-activity, 24h floor, finalized exclusion, lock visibility, dry-run read-only, re-read-before-write, malformed timestamps, outcome value) + `outcome_reason` conventions.
- **§6.19 (NEW)**: convergence-health hint contract (spec defines the contract, implementation chooses thresholds; advisory caller obligation).
- **Spec banner** bumped from v4.12 to v4.13.

### Adicionado — operator docs
- **`AGENTS.md`** three new mandatory directives (§6.17/§6.18/§6.19) added to the directives section. Spec range bumped to v4.13.
- **`docs/session-audit-2026-04-26.md`** §5 roadmap updated: all four follow-ups marked **done in v1.1.0**. Closure note added documenting the v1.0.4/v1.0.5 release recovery + cross-review session id.

### Adicionado — CI
- **`.github/workflows/publish.yml`** new `create-github-release` job, runs after both publish jobs succeed, extracts release notes from CHANGELOG.md section matching the tag, idempotent (skips if release already exists for the tag). Lands BEFORE the v1.1.0 tag per sequencing discipline so v1.1.0's publish run exercises the new logic.

### Adicionado — tests (14 new smoke steps)
- **FU-1 / §6.17:** 2 steps — `spec_version + outcome_reason persisted on session_init`, `finalize round-trips outcome_reason`.
- **FU-2 / §2.5 closure:** 1 step — `chatgpt-pro-backend bypass invariant across mismatch shapes` (4 reported-model cases assert `protocol_violation === false`).
- **FU-3 / §6.18:** 6 steps covering all 7 ratified invariants — `dry-run is read-only`, `24h hard floor non-overridable`, `lock collision report`, `already-finalized excluded`, `malformed timestamp never auto-finalized`, `wet path: happy finalized + locked untouched`, `finalizeIfUnset re-read-before-write`.
- **FU-4 / §6.19:** 5 steps covering all 7 ratified invariants — `rounds 1-5 → normal`, `rounds 6-7 → extended`, `rounds 8+ → concerning`, `invalid input falls through to normal`, `thresholds exported`.

### Recuperação operacional
- **v1.0.4 retroactive tag.** Commit `8d1ffb6` was pushed to main on 2026-04-26 without a tag, so the publish workflow never fired. Tag created retroactively today; `Publish` workflow ran successfully (`24960616477` — 39s, success); npm package + GitHub Packages now live; release created via `gh release create` (one-time recovery — future tags use the new auto-create step).
- **v1.0.5 retroactive tag.** Same situation as v1.0.4. Tag created today; `Publish` ran successfully (`24960616469` — 41s, success); npm + Packages live; release created manually.

### Validação
- `npm test` 141 GREEN (was 127 in v1.0.5; +14 for FU-1+FU-3+FU-4 invariants).
- `npm run check-models` GREEN.
- Cross-review session `483b2d1c-6e82-42a3-bbcc-1e9ea61289f7` finalized `outcome: converged` after R2 (caller READY + codex READY + gemini READY).

---

## [1.0.5] — 2026-04-26

**§6.16 prompt-flag recovery contract + 60-session audit.** Field evidence from three sessions in 2026-04-24 (`6cf09af3`, `70d1d349`, `fca13b80`) showed OpenAI Codex on reasoning models (gpt-5 family) rejecting prompts with `your prompt was flagged as potentially violating our usage policy`. Runtime classified these as generic `spawn_rejected`, the session went to `outcome: aborted`, and the codex contribution was lost. Spec v4.12 §6.16 + runtime now classifies + provides reformulation guidance + binds the caller to retry instead of aborting.

### Adicionado — runtime
- **`src/lib/peer-spawn.js`**: `PROMPT_FLAG_LEXEMES` constant (3 canonical OpenAI-stderr substrings), `matchPromptFlagLexeme(text)`, `detectPromptModerationFlag(stderr)`. Returns `{ detection_source: 'spawn', lexeme_matched, docs_url }` or `null`. Disjoint from `detectSpawnRateLimit` — same stderr never matches both.
- **`src/lib/peer-spawn.js`** `spawnPeer.on('close')`: when exit≠0, attaches `err.prompt_flagged` (parallel to `err.spawn_rate_limit`) so the rejection error carries structured info.
- **`src/server.js`** `ask_peers` and `ask_peer` handlers: classify spawn rejections with `failure_class: 'prompt_flagged_by_moderation'` (precedence over `rate_limit_induced_response`) + `recovery_hint: 'reformulate_and_retry'` + embedded `reformulation_advice` text + `docs_url`. Persisted into `meta.failed_attempts[]`. Bilateral surface (`ask_peer`) gained an inline try/catch matching N-ary semantics — previously the rejection fell to the global error catch and lost structured info.
- **Tool descriptions** for `ask_peer` and `ask_peers` extended with the FAILURE-CLASS RECOVERY CONTRACT block: caller MUST honor `recovery_hint`; reformulate up to 5 attempts before escalating; do NOT abort the session on a moderation flag.

### Adicionado — spec
- **`docs/workflow-spec.md`** §6.16 (NEW in v4.12): trigger description, distinction from rate-limit (§6.13), normative contract for detect/classify/surface/persist + caller obligation, canonical reformulation guidance (charged-word replacements), anti-pattern (aborting = non-conforming), out-of-scope notes (auto-reformulation inside MCP deferred), observability hooks.
- **§0l (NEW)**: executive summary of v4.11 → v4.12 delta.
- **Spec banner** bumped from v4.11 to v4.12.

### Adicionado — operator docs
- **`AGENTS.md`** new mandatory directive: "Prompt-flag recovery (§6.16 v4.12)" — caller MUST reformulate and retry, do NOT abort. Spec range bumped to v4.12.

### Adicionado — audit
- **`docs/session-audit-2026-04-26.md`** (NEW): structural audit of all 60 sessions in `~/.cross-review/`. Headlines: 60 sessions, 177 rounds, 80% converged, 8.3% aborted (1 of 5 was moderation flag — fixed by §6.16). Findings catalog with priorities + target releases for §2.4 (spec_version in meta), §2.5 (chatgpt-pro-backend bypass smoke), §2.2 (orphan session sweep), §2.3 (convergence-health hint).

### Adicionado — tests
- **`scripts/functional-smoke.js`** new step 126: `detectPromptModerationFlag` shape + lexeme match + null paths + disjointness from `detectSpawnRateLimit` + `PROMPT_FLAG_LEXEMES` export.

### Validação
- `npm test` 126 GREEN (was 125, +1 for new detector test).
- `npm run check-models` GREEN (no drift, fallback chain invariant holds).

---

## [1.0.4] — 2026-04-26

**Workspace parity sweep + Pages enablement.** Documentação/CI puramente aditivo, sem mudança runtime, fechando paridade com os outros 8 repos públicos do workspace (admin-app, mainsite-app, calculadora-app, astrologo-app, oraculo-financeiro, adminapps, apphub, mtasts-motor).

### Adicionado
- **`THIRDPARTY.md`** — inventário completo de dependências npm + licenças (MIT-compatible).
- **`.github/CODEOWNERS`** — `* @lcv-leo` como owner default (paridade com os outros repos do workspace).

### Alterado
- **`.github/workflows/pages.yml`** — `actions/configure-pages@v6.0.0` passou a declarar `with: enablement: true` para idempotência em forks/clones que ainda não tenham GitHub Pages habilitado (corrige `Get Pages site failed... HTTP 404` em primeiro run).

### Validação
- Trilateral cross-review session `08bc6b9a-f3f5-434d-8276-2b21f562a843` (caller + Codex + Gemini) **READY** após 6 rodadas: paridade confirmada nos 9 repos públicos em security baseline, repo features, workflow perms, branch rulesets, Pages deployment, CodeQL Default Setup, 0 alertas abertos.

---

## [1.0.3] — 2026-04-25

**Security patch: ReDoS hardening em parser helpers.** GitHub CodeQL (`js/polynomial-redos`, severity `high`) flagou dois sites usando `/\s+$/` para right-trim em texto de input não-controlado vindo de peers. Em inputs com cluster de whitespace seguido de não-whitespace (`"   X"`-style) o regex tem complexidade O(N²) por backtracking polinomial; `String.prototype.trimEnd()` resolve em O(N) com semântica idêntica. Frozen surfaces v1.x preservados (zero observable change para inputs válidos).

### Corrigido
- **`src/lib/model-parser.js:47`** (`rightTrim`): `s.replace(/\s+$/, '')` → `s.trimEnd()`. CodeQL alert #1 resolvido.
- **`src/lib/status-parser.js:255`** (`parsePeerResponse`): `text.replace(/\s+$/, '')` → `text.trimEnd()`. CodeQL alert #2 resolvido.

### Alterado — Version
- `src/server.js` VERSION bumpado `1.0.2` → `1.0.3`.
- `package.json` + `package-lock.json` bumpados via `npm version 1.0.3 --no-git-tag-version`.

### Validação
- Smoke gate: 125 steps GREEN — `trimEnd()` é runtime-equivalente para inputs válidos; nenhum teste afetado.
- check-models: no drift.
- Comportamento observável idêntico para todos os inputs reais; diferença mensurável apenas em inputs adversariais com whitespace bomb.

### Não validado por trilateral
v1.0.3 é security patch sob v1.x semver patch policy (preserva frozen surfaces; zero behavioral change). Não exige sessão trilateral. CodeQL re-scan automático após push deve auto-resolver os alertas.

---

## [1.0.2] — 2026-04-25

**First npm publish.** Package renomeado para scope `@lcv-leo/cross-review-mcp` e publicado em ambos os registries (npmjs.com primário + GitHub Packages mirror) com provenance attestation. Zero behavioral change; runtime e schemas idênticos a v1.0.1. v1.x semver patch policy preservado (frozen surfaces inalterados).

### Adicionado
- **`.github/workflows/publish.yml`**: pipeline de publish disparado por `push` em tags `v*` + `workflow_dispatch`. Pre-publish gate executa `smoke + check-models` antes de cada publish. Dois jobs paralelos publicam para `https://registry.npmjs.org` (auth via `NPM_TOKEN` secret) e `https://npm.pkg.github.com` (auth via `GITHUB_TOKEN`); ambos com `--access public --provenance` (`id-token: write` permission para SLSA build attestation).
- **`package.json` metadata**: `repository`, `homepage`, `bugs`, `license: "Apache-2.0"`, `author: "lcv-leo"`, `keywords[]`, `engines.node: ">=20"`.
- **`package.json` `"files"` whitelist**: `["src/", "LICENSE", "NOTICE", "README.md", "README.pt-BR.md", "CHANGELOG.md", "SECURITY.md", "CODE_OF_CONDUCT.md"]`. Removeu do tarball: `docs/` (workflow-spec interno + reports), `scripts/` (dev-only: smoke harness, drift audit, isolation probe), `reviewer-configs/` (test fixtures), `AGENTS.md`, `CONTRIBUTING.md` (developer-facing GitHub-side). Tarball reduzido de 574 KB / 27 files (v1.0.1) → 239 KB / 13 files (v1.0.2).
- **README.md**: badge npm version dinâmico (shields.io/npm/v) substituiu badge estático; instruções de instalação para ambos os registries; rows v1.0.1 + v1.0.2 na version-history table.

### Alterado — Package
- `package.json` `name`: `cross-review-mcp` → `@lcv-leo/cross-review-mcp`. Scope `@lcv-leo` alinhado ao GitHub owner (requisito de GitHub Packages); npmjs scope precisa ser claimed pelo owner se ainda não foi.
- `package.json` `private`: removido (era `true`, bloqueava `npm publish`).
- `package.json` `publishConfig`: adicionado `{ "access": "public" }` para publish público de scoped package no npmjs (default seria `restricted`).
- `package-lock.json`: regenerado via `npm install --package-lock-only` para refletir o novo package name; `lockfileVersion` preservado.

### Alterado — Version
- `src/server.js` VERSION bumpado `1.0.1` → `1.0.2`.
- `package.json` version bumpado `1.0.1` → `1.0.2` (regenerado junto com lockfile).

### Notas operacionais
- **bin nome preservado**: `"bin": { "cross-review-mcp": "src/server.js" }` mantém o comando CLI invocável como `cross-review-mcp` mesmo com package scoped — convenção npm padrão. Install global: `npm install -g @lcv-leo/cross-review-mcp`.
- **Provenance**: ambos os publishes geram SLSA build provenance attestation visível na página do package no npmjs.com (badge "Provenance"). Requer `id-token: write` permission no workflow (configurado).
- **First-publish manual fallback**: se `NPM_TOKEN` ainda não está configurado como repo secret, o job `publish-npmjs` falha com `ENEEDAUTH`; primeira publicação pode ser feita localmente via `npm login` + `npm publish --access public --provenance` (provenance via local exige `NPM_CONFIG_PROVENANCE=true` + repo público).

### Validação
- Smoke gate: 125 steps GREEN.
- check-models: no drift, fallback_chain invariant holds, no staleness.
- `npm pack --dry-run`: 13 files / 70.1 KB compressed / 239 KB unpacked — confere com whitelist.
- Zero behavioral change; frozen surfaces v1.x intactos.

### Não validado por trilateral
v1.0.2 é release-engineering / publishing infrastructure patch sob v1.x semver patch policy (frozen surfaces preservados). Sem nova superfície de protocolo, sem novo schema field, sem behavioral change. Não exige sessão trilateral.

---

## [1.0.1] — 2026-04-25

**Patch release: doc-only refresh of user-visible MCP tool descriptions.** v1.0.0 cut left stale alpha labels and stale spec references in the `description` strings emitted via `ListToolsRequestSchema`. MCP clients reading those descriptions saw "v0.5.0-alpha" / "spec v4.7" / "spec v4.8" / "v0.7.0-alpha / spec v4.10" even though the running server was tagged v1.0.0 and the head spec is v4.11. Operator caught the contradiction post-cut. Zero behavioral change; frozen surfaces (tool names + input schemas) unchanged per v1.x semver patch policy.

### Alterado
- `session_init` description: removed "In v0.5.0-alpha" preamble; "spec v4.8 section 6.9.3" → "spec v4.11 section 6.9.3".
- `session_read` description: "spec v4.8 section 6.9.3.6" → "spec v4.11 section 6.9.3.6".
- `session_check_convergence` description: removed "(ask_peers round, v0.5.0-alpha)" alpha label; "spec v4.7 section 2.8" → "spec v4.11 section 2.8".
- `ask_peer` description: simplified "Peer response contract (v0.5.0-alpha; v0.4.0 schema preserved + peer-model block added)" → "Peer response contract"; removed "(NEW in v0.5.0)" annotation; "(spec v4.8 + F2 R15)" → explicit reference to spec v4.11 §6.11 transport-class bypass discipline (skip for cli-subscription / oauth-personal; strict for api-key).
- `ask_peer.prompt` field description: "v0.5.0-alpha tail directive" → "tail directive".
- `ask_peers` description: "(v0.5.0-alpha, spec v4.7)" → "(spec v4.11)"; "R14 redaction" → "redaction" (the F2 R14 internal-design-session anchor was opaque to MCP clients).
- `escalate_to_operator` description: "v0.7.0-alpha / spec v4.10 Item D" → "(spec v4.11 §6.14 Item D)" with reordered first sentence for clarity.

### Preservado intencionalmente (escopo deliberado fora deste patch)
- **Code comments** in `src/lib/peer-spawn.js`, `src/lib/model-parser.js`, `src/lib/session-store.js`, `scripts/audit-model-drift.js` documenting WHEN behavior was introduced (e.g. "Introduced in v0.5.0-alpha") — these are historical anchors for source archaeology, not user-visible strings.
- **`CHANGELOG.md`** historical entries — by definition versioned per release.
- **`README.md`** version-history table — historical record.
- **`AGENTS.md`** narrative referring to "v0.5.0-alpha → v0.9.0-alpha.1" — describes release lineage.
- **`docs/workflow-spec.md`** v4.7→v4.8→v4.9→v4.10→v4.11 delta sections — the spec is incremental by design; head version is v4.11 and prior delta sections remain for context.

### Alterado — Version
- `src/server.js` VERSION bumpado `1.0.0` → `1.0.1`.
- `package.json` version bumpado `1.0.0` → `1.0.1` (via `npm version 1.0.1 --no-git-tag-version` to keep package-lock.json synced atomically).
- `package-lock.json` root + `packages[""]` versions bumpados `1.0.0` → `1.0.1`.

### Validação
- Smoke gate: 125 steps GREEN (zero behavioral change; smoke does not depend on tool-description strings).

### Não validado por trilateral
v1.0.1 é doc-only patch sob v1.x semver patch policy (preserves frozen surfaces); não exige nova sessão de cross-review trilateral. Zero behavioral change, zero schema change, zero new field.

---

## [1.0.0] — 2026-04-25

**Stable release.** Cut ratified by 10-session field-use validation gate + trilateral final approval session `fca13b80-14c7-456d-bedf-4ede16646e24` (2026-04-25, 2 rounds, 3/3 READY: caller=claude + peers=codex+gemini). Implementation-ratified per `docs/workflow-spec.md` §8 v4.5 preamble — design scope was approved trilaterally in sessions `c9508617` (v0.6.0-alpha / spec v4.9) and `6cf09af3` (v1.0 frozen surface declaration + v1.x semver policy); v1.0.0 ships those decisions without introducing new normative scope.

### Frozen public surface (v1.x major-bump-required to change)

- **Seven MCP tools** by name + input/output schema: `session_init`, `session_read`, `session_check_convergence`, `session_finalize`, `ask_peer`, `ask_peers`, `escalate_to_operator`.
- **Structured peer-block contracts**: `<cross_review_peer_model>` + `<cross_review_status>` (status enum READY/NOT_READY/NEEDS_EVIDENCE; optional fields `confidence`, `evidence_sources`, `caller_requests`, `follow_ups`, `uncertainty`).
- **`meta.json` semantics** surfaced via `session_read`: rounds[], peers[], capability_snapshot, failed_attempts[], escalations[], convergence_snapshot.
- **Convergence predicate** (strict-only per spec §6.12): `caller_status === 'READY' AND every responded peer.peer_status === 'READY' AND round.peers.length >= 1 (legacy bilateral) or >= 2 (N-ary)`. `status_missing` counts AGAINST.
- **Transport descriptor** `{ agent, auth, endpoint_class }` (spec §6.11). Auth ∈ `{cli-subscription, oauth-personal, api-key}`; endpoint_class per agent.
- **Audit-trail fields**: `model_check_skipped`, `protocol_violation`, `cli_banner_attested`, `cli_attested_model`, `rate_limit`, `rate_limited_peers`, `convergence_snapshot`, `model_failure_class` enum.

### v1.x semver policy

- **Patch (1.0.x)**: bug fixes preserving frozen surfaces.
- **Minor (1.x.0)**: additive only — new optional structured fields (backward-compat must hold), new tools, new informational spec sections.
- **Major (2.0.0)**: any change to a frozen surface; REQUIRES new trilateral cross-review session.
- **Deprecation**: 1-minor warning before removal in next major.
- **Security exception**: vulnerability fixes may patch a frozen surface with same-release spec amendment + post-hoc trilateral review.
- **Spec versioning** increments independently (v1.0 ships with spec v4.11 frozen).

### Field-use validation summary

10 trilateral sessions across 6 distinct domains (cross-review-mcp meta-development, public docs, workspace tooling audits, product feature review, security audit→remediation arc, external orchestrator script analysis). 29 total rounds, all converged, zero stranded. 4 mid-session patches shipped under field evidence. 3 platform-layer failure classes recovered via round-level resilience (OpenAI moderation rejection, Gemini libuv crash, claude-spawn-miss). 7 claude-caller + 3 codex-caller sessions = caller-rotation symmetry validated. Sessions: `b5a328b8`, `c9508617`, `c2c6060d`, `6cf09af3`, `5db2617c`, `19a3c66f`, `41121627`, `74c77006`, `566f2709`, `aa49c29a`. Final approval: `fca13b80`.

### Alterado — Version

- `src/server.js` VERSION bumpado `0.9.0-alpha.1` → `1.0.0`.
- `package.json` version bumpado `0.9.0-alpha.1` → `1.0.0` (via `npm version 1.0.0 --no-git-tag-version` per Codex caller_request in fca13b80 R2: avoid auto-tag before all release files coherent).
- `package-lock.json` version reconciled to `1.0.0` simultaneously (was drifting at `0.5.0-alpha.1` since v0.5.0-alpha; Codex flagged in fca13b80 R2; fixed atomically with package.json bump).
- `README.md` status line updated to "Stable. Current release: v1.0.0" + version-history table extended with v1.0.0 row citing the cut ratification.

### Spec absorbed

- Spec v4.11 (commit `21a416b`) — unchanged in v1.0.0 release. v1.0.0 is implementation-ratified, not a spec revision.

### Confirmed in-place at v1.0.0

- License: Apache-2.0 (`LICENSE`) + `NOTICE` attribution.
- Public-facing docs: `README.md` (en-US), `README.pt-BR.md` (historical preservation), `CONTRIBUTING.md` (cross-review-discipline-based contribution model with v1.x semver policy), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (responsible disclosure).
- Smoke gate: 125 steps GREEN (Node 22 LTS / ubuntu-latest in CI).
- Drift audit: `npm run check-models` GREEN (no drift, fallback_chain invariant holds, no staleness).
- Repo: public on GitHub at `github.com/lcv-leo/cross-review-mcp`.

### Out of scope for v1.0.0 (deferred to v1.1+ as polish)

- v1.1 candidate: rename `GeminiOnly.UnknownFields` → `ExtraFields` or split into `ControlFields`+`UnknownFields` (Codex Q2 from session `566f2709`, non-blocking).
- v1.1 candidate: probe-level Item E banner elevation (currently only `parsePeerOutputs` round-level applies banner attestation; probe captures `cli_attested_model_raw` but doesn't elevate `cli_banner_attested` — non-blocking audit-trail symmetry gap).

---

## [0.9.0-alpha.1] — 2026-04-24

Patch release: field-use validation session #1/10 (`6cf09af3-163c-49c2-98ae-435e6c62a686`) surfacou bug crítico em `detectGeminiAuth()` que reintroduzia false-positive `silent_model_downgrade` quando `GEMINI_API_KEY` estava presente no env do MCP host enquanto o CLI Gemini internamente usava `oauth-personal` via `~/.gemini/settings.json`. Round 1 do Codex NOT_READY com `caller_request` explícito para patch antes do v1.0 cut; Round 1 do Gemini READY concordando. Ambos peers concurring: ship como v0.9.0-alpha.1 próprio release (não absorber diretamente em v1.0) para que a correção tenha field-validation antes do freeze permanente.

### Corrigido
- **`detectGeminiAuth()` em `src/lib/peer-spawn.js`** refatorado em dois níveis:
  - `geminiAuthFromSignals({ settingsSelectedType, hasApiKeyEnv, hasOauthCreds })` — pure decision function, sem fs/env reads. Exportada para testabilidade.
  - `detectGeminiAuth()` — production wrapper que lê os três signals e delega.
- **Nova precedence** (era env-var first em v0.6.0-alpha → v0.9.0-alpha):
  1. `~/.gemini/settings.json` `security.auth.selectedType` se parseável. Valores reconhecidos: `'oauth-personal'` → `'oauth-personal'`; `'api-key'` ou `'gemini-api-key'` → `'api-key'`. Valores desconhecidos caem para o próximo nível.
  2. `GEMINI_API_KEY` env var presence → `'api-key'`.
  3. `~/.gemini/oauth_creds.json` fs.existsSync → `'oauth-personal'`.
  4. Default → `'oauth-personal'` (CLI documented default).
- **Rationale:** o CLI Gemini decide auth mode internamente via `settings.json`; presença de env var no host MCP NÃO força o CLI para api-key. Sessão 6cf09af3 probe capturou `transport_descriptor: { auth: 'api-key', endpoint_class: 'generativelanguage-v1beta' }` incorretamente para Gemini, executando o model-check no path api-key (que é autoritative), recebendo `model_reported: "Gemini"` (self-report terse), comparando contra `gemini-3.1-pro-preview`, → mismatch → `tier: offline` + `failure_class: silent_model_downgrade`. Com a precedence corrigida, `detectGeminiAuth()` lê o `selectedType: 'oauth-personal'` do settings.json primeiro e retorna `'oauth-personal'`, ativando o §6.11 skip path adequadamente.

### Adicionado
- **Smoke coverage (125 steps total, 117 → 125, +8 assertions):** novo `driveV091GeminiAuthPrecedenceUnit` em `scripts/functional-smoke.js` cobrindo as 8 combinações de signal relevantes:
  - settings=oauth-personal + env=T + oauth_creds=T → oauth-personal (**regression explícita da sessão 6cf09af3**).
  - settings=oauth-personal + env=T + oauth_creds=F → oauth-personal.
  - settings=api-key + env=F + oauth_creds=T → api-key.
  - settings=gemini-api-key alias → api-key.
  - settings=null + env=T + oauth_creds=T → api-key (env beats oauth_creds).
  - settings=null + env=F + oauth_creds=T → oauth-personal.
  - settings=null + env=F + oauth_creds=F → oauth-personal (default).
  - settings='future-auth-type' (unrecognized) → fall-through para env signal.

### Alterado
- `src/server.js` `VERSION` bumpado `0.9.0-alpha` → `0.9.0-alpha.1`.
- `package.json` version bumpado `0.9.0-alpha` → `0.9.0-alpha.1`.

### Não alterado (invariantes preservadas)
- Spec `docs/workflow-spec.md` permanece v4.11 — a correção é implementation-layer bug fix, não spec change. §6.11 transport-descriptor shape + gate semantics permanecem idênticos.
- `parsePeerOutputs` + `classifyModelMatch` inalterados — a fix é upstream em `detectGeminiAuth()` e o downstream chain continua correto.
- Contract público (7 MCP tools + structured block schema + meta.json schema) não tocado. Eligível para v1.0 freeze inalterado pós-patch.

### Field-use session registered
- Session `6cf09af3-163c-49c2-98ae-435e6c62a686` (#1/10): v1.0 cut scope review (§8 closures + frozen surface + semver policy + D bug). Outcome pendente Round 2 — necessita reapresentação com patch landed + expanded FROZEN surface per Codex's 3 caller_requests.

---

## [0.9.0-alpha] — 2026-04-24

Release: **pre-cut for v1.0 stable public GitHub**. Spec v4.11 (unchanged; absorved from commit `21a416b`). Two classes de change: (1) license change AGPLv3 → Apache-2.0 (operator decision registered this release), (2) public-facing documentation suite consolidada.

### Alterado — License change (operator decision 2026-04-24)
- **`LICENSE` swapped from AGPLv3 (workspace default) to Apache-2.0.** Canonical Apache License 2.0 text fetched from `https://www.apache.org/licenses/LICENSE-2.0.txt` (11.3KB). Operator considered three candidates mid-session 2026-04-24:
  - (A) Keep AGPLv3 — consistent with workspace default; strong copyleft protecting against closed-source SaaS wrappers. Rejected in favor of ecosystem compatibility.
  - (C) MIT — most permissive; briefly chosen then reconsidered.
  - (B) **Apache-2.0 — final choice.** Adopted for MCP ecosystem compatibility (most MCP reference servers use MIT or Apache-2.0) + explicit patent grant over MIT. Third-party vendoring and commercial integrations are permitted; `NOTICE` preservation required on redistribution.
- **`NOTICE` file NEW (Apache-2.0 standard pattern).** Copyright attribution (`Copyright 2026 Leonardo Cardozo Vargas`) + pointer to LICENSE + third-party dependencies note (`@modelcontextprotocol/sdk` MIT as only direct runtime dep at v0.9.0-alpha).
- `README.md` updated: license badge MIT/AGPLv3 candidate placeholders removed in favor of Apache-2.0 SVG badge; license section rewritten to explain the choice (ecosystem compatibility + patent grant) and reference both LICENSE and NOTICE; architecture-tree line now shows `LICENSE ... Apache-2.0` + `NOTICE ... Apache-2.0 attribution + third-party notices`.

### Adicionado — Public-facing documentation suite (pre-cut for v1.0 public GitHub)
- **`README.md`** reescrito em en-US como README primário público (18.6KB; commit `9be587e`). Estrutura: What it does / Topology / Peers and transport / Install / Register with each peer / Running a session / Anti-hallucination discipline / Observe the session / Protocol contract (pointer to `docs/workflow-spec.md` §§1-8) / Architecture / Exposed tools (7 total) / Development / Contributing / Security / License / Acknowledgements / Links. Versão-table matrix cobrindo v0.5.0-alpha → v0.7.0-alpha → v0.9.0-alpha (spec v4.7 → v4.11). Transport descriptor table (cli-subscription / oauth-personal / api-key). Fluxo de sessão passo-a-passo.
- **`README.pt-BR.md`** preserva o conteúdo original em pt-BR (13.4KB; commit `9be587e`) que documentava o desenvolvimento iterativo desde v0.3.0-alpha. Mantido como arquivo histórico + referência para o operator.
- **`CONTRIBUTING.md`** (7.4KB; commit `9be587e`) define três classes de contribuição:
  - Class 1 trivial: single maintainer review + gates.
  - Class 2 additive + deferred-scope implementation: cita spec section.
  - Class 3 normative: **cross-review session trilateral obrigatória antes do merge**, citando session UUID + trail de aprovação; implementation-ratified acceptable somente para pre-ratified deferred scope per §8 v4.5 preamble rule.
  - Gates obrigatórios: `npm test` (117+ smoke steps) + `npm run check-models`.
  - Non-negotiables: tri-tool stack (ultrathink + code-reasoning + cross-review), top-level models only, CLI transport (not SDK) per billing-veto, strict-only convergence, no fabrication (§6.14), ASCII-only on disk + en-US for peer-exchange artifacts, no secrets in repo.
- **`CODE_OF_CONDUCT.md`** (2KB; commit `9be587e`) adota Contributor Covenant 2.1 via link canônico + reporting contact (`alert@lcvmail.com`, mesmo canal de SECURITY.md) + nota específica sobre a discordância estruturada do protocolo (peers respondendo `NOT_READY` com objeções técnicas é comportamento esperado e não é CoC concern).

### Confirmado — Security posture
- **Full-history secrets scan** (commit `9be587e`) concluído 2026-04-24 contra 10 padrões comuns (OpenAI `sk-`, Google `AIza`, GitHub `gh[pousr]_`, Anthropic `sk-ant-`, Cloudflare `cfut_`/`CF_API_TOKEN`, SumUp `sup_sk_`, JWT, Bearer, PEM private-key blocks, env-style `*_TOKEN`/`*_SECRET`/`*_PRIVATE_KEY`/`*_API_KEY` assignments). Resultado: **CLEAN** — todos os pattern matches são test fixtures do R14 redaction corpus em `scripts/functional-smoke.js` por design (exercitam `driveSessionStoreUnit`'s redaction assertions). Nenhum secret real na história do git.
- **R14 redaction patterns** (definidos em `src/lib/session-store.js` REDACTION_PATTERNS) continuam aplicados sobre `stderr_tail` de `failed_attempts` e outras superfícies persistidas. Zero change em v0.9.0-alpha.

### Alterado — Version
- `src/server.js` VERSION bumpado `0.7.0-alpha` → `0.9.0-alpha`. Nota: versão pula de `0.7.0-alpha` para `0.9.0-alpha` (não existe `0.8.0-alpha` como release — foi substituído por spec v4.11 spec-only revision que fechou o Claude CLI banner follow-up como negative result sem tocar código).
- `package.json` version bumpado `0.7.0-alpha` → `0.9.0-alpha`.

### Spec delta absorbed
- Spec v4.11 (commit `21a416b`) absorbed into v0.9.0-alpha release. No additional spec changes in this release. Spec title `Cross-Review MCP Workflow Specification v4.11` remains current.

### Trade-offs documentados / deferred to v1.0+
- **Claude CLI banner parsing:** CLOSED 2026-04-24 como negative empirical result (CLI 2.1.119 emits 0 bytes stderr). Reabre apenas se future Claude CLI version introduzir banner channel.
- **Future pre-v1.0 work:** field-use validation em production sessions + community onboarding (issue templates, PR templates, contributing agent badge) + eventual round trilateral adicional para v1.0 spec freeze decision. Sem timelines pré-committed.

---

## [0.7.0-alpha] — 2026-04-24

Release: spec v4.10 implementation. Executa os dois scope items diferidos da sessão trilateral c9508617 (v4.9 convergida) sem nova sessão de design, per operator directive 2026-04-24: (D) anti-hallucination / epistemic discipline, (E) CLI banner como authoritative attestation. Item F (open-source readiness) confirmado já-em-vigor: `LICENSE` (AGPLv3, alinhado ao workspace) e `SECURITY.md` presentes em disco desde antes de v0.5.0-alpha.

### Adicionado
- **Anti-hallucination / epistemic discipline (Item D / spec v4.10 §6.14):**
- `src/lib/status-parser.js` aceita dois novos campos opcionais no bloco estruturado:
  - `confidence: 'verified' | 'inferred' | 'unknown'` — peer self-declara o estado epistemológico da resposta.
  - `evidence_sources: [string]` — array de fontes concretas consultadas (shape validado como `caller_requests`, max 20 entradas, max 500 chars cada). Prefixos recomendados: `file:`, `tool:`, `cli:`, `url:`, `memory:`.
- Regras cross-field (parser-enforced):
  - Hard-pair: `confidence='unknown'` MUST pair with `status='NEEDS_EVIDENCE'`. Violação emite parser warning.
  - Advisory: `confidence='verified'` sem `evidence_sources` (ausente ou vazio) emite parser warning.
- `src/server.js` `attachPromptTailDirective` estendido com diretiva explícita anti-fabricação, NEEDS_EVIDENCE-first discipline, exhaustive-search mandate, e descrição do shape dos dois campos novos.
- Novo tool MCP `escalate_to_operator(session_id, question, context)` que persiste o registro de escalação em `meta.escalations[]` com `escalation_id` (UUIDv4), `from_agent`, `question`, `context`, `round_index`, `timestamp`. O tool NÃO auto-dispatcha ao operador — o caller orchestrator (Claude Code) é responsável por surfacing via chat. Empty/whitespace question é rejeitado com validation error.
- `src/lib/session-store.js` novo export `saveEscalation(sessionId, fromAgent, question, context)`; `meta.escalations[]` é lazy-created na primeira chamada; backward compat preservado para sessões que nunca escalam (campo ausente).

- **CLI banner as authoritative attestation (Item E / spec v4.10 §6.11 amendment):**
- `src/server.js` `parsePeerOutputs` aceita quarto argumento opcional `cliAttestedModel` (sourced de `spawnPeer`'s `cli_attested_model_raw`). Quando transport.auth === 'cli-subscription' E cliAttestedModel é uma string parseável:
  - Banner MATCHES pinned peer_model → audit elevation: `cli_banner_attested: true` no per-peer round entry; `model_check_skipped.cli_banner_attested: true` no sub-registro de audit. Text-level self-report check continua SKIPPED per §6.11 (discipline preservada; o banner é o que atesta).
  - Banner MISMATCHES pinned peer_model → hard gate: `model_check_applicable: true`, `model_match: false`, `model_failure_class: 'cli_banner_attestation_mismatch'`, `protocol_violation: true`. Não é retried (mesma disciplina do silent_model_downgrade sob §6.11 api-key path).
  - Banner ABSENT/UNPARSEABLE → fall-through ao v4.9 `model_check_skipped` path inalterado.
- Banner parsing confinado a Codex CLI em v0.7.0-alpha; Claude CLI banner parsing DIFERIDO para v0.8+ pending empirical format survey; oauth-personal (Gemini v1internal) não tem banner e continua na §6.11 skip discipline independente do cliAttestedModel passado.
- `src/lib/peer-spawn.js` já expõe `cli_attested_model_raw` via `extractCodexAttestedModelRaw` (v0.6.0-alpha) — v0.7.0-alpha apenas promove o consumo downstream de forensic-only para authoritative gate.

- **Smoke (`scripts/functional-smoke.js`) expandido de 103 para 117 steps:** +14 novas assertions cobrindo:
  - v4.10 Item D: confidence field parsing (verified-without-evidence advisory, unknown-without-NE hard-pair, unknown+NE compliant, evidence_sources validation, invalid confidence drop).
  - v4.10 Item D: escalate_to_operator end-to-end (return shape, empty question rejection, persistência em meta.escalations[], cleanup) + saveEscalation unit.
  - v4.10 Item E: banner match (elevated audit), banner mismatch (hard gate), no banner (fall-through), oauth-personal indifference ao banner.
- Novo env var `CROSS_REVIEW_TEST_IMPORT=1` em `src/server.js`: quando setado, pula `main()` e relaxa a validação de `CROSS_REVIEW_CALLER` (default 'claude'). Permite `require('../src/server.js')` nos smoke unit drivers sem ativar o stdio transport. Smoke drivers que spawnam o server como child process agora removem explicitamente essa env do childEnv para evitar leak que skiparia o main() do subprocesso.

### Alterado
- `src/server.js` `VERSION` bumpado `0.6.0-alpha` → `0.7.0-alpha`.
- `package.json` `version` bumpado `0.6.0-alpha` → `0.7.0-alpha`.
- `parsePeerOutputs` signature estendida para `(stdout, peerModel, transportDescriptor, cliAttestedModel = null)`. Callers sem o 4º arg (null default) preservam comportamento v0.6.0-alpha (Item E não se ativa; §6.11 skip puro).
- `attachPromptTailDirective` tail text cresce para incluir diretiva anti-hallucination + descrição dos dois campos estruturados novos. Shape do tail preserva os dois structured blocks canônicos (peer_model + status) — os campos novos vão dentro do status block.
- Tool list do server retorna 7 tools agora (vs 6 em v0.6.0-alpha): `session_init`, `session_read`, `session_check_convergence`, `session_finalize`, `ask_peer`, `ask_peers`, **`escalate_to_operator`** (novo em v4.10).

### Confirmado / no-change
- **Open-source readiness (Item F):** `LICENSE` (AGPLv3 per workspace default; recomendação de revisitar Apache-2.0 permanece registrada para v0.9.0-alpha pre-cut) e `SECURITY.md` (responsible disclosure, canais privados, CodeQL + Dependabot mencionados) já estavam em disco antes de v0.5.0-alpha. `README.md` em pt-BR permanece — tradução en-US para público internacional é follow-up de v0.9+ pre-cut conforme `project_cross_review_mcp_open_source_plan`. Nenhum código mudou por conta de Item F em v0.7.0-alpha.

### Trade-offs documentados / deferred
- **Claude CLI banner parsing:** diferido para v0.8+ pending empirical survey do formato do banner Claude CLI. v0.7.0-alpha Codex-only para Item E.
- **README hardening (en-US + setup + architecture):** diferido para v0.9.0-alpha pre-cut (próximo antes de v1.0 stable público no GitHub), conforme `project_cross_review_mcp_open_source_plan.md`.
- **License revisit (AGPLv3 vs Apache-2.0):** operator pré-decisão pendente para v0.9.0-alpha. v0.7.0-alpha preserva AGPLv3 workspace-default.

---

## [0.6.0-alpha] — 2026-04-24

Release: spec v4.9 implementation. Trilateral design session `c9508617` (caller=claude + peers=codex+gemini) convergiu em 3 rounds sobre três scope items aprovados como normativos: (A) transport-class-aware model-check bypass, (B) strict-only convergence com persisted snapshot, (C) rate-limit class ortogonal a silent-downgrade. Itens diferidos para v0.7+ por decisão do operador 2026-04-24: anti-hallucination safeguards, open-source readiness, CLI stderr banner como authoritative attestation (v0.6.0-alpha aceita captura forensic-only não-parseada).

### Adicionado
- **Transport-class-aware model-check bypass (Item A / spec v4.9 §6.11):** `spawnPeer` e `probeAgent` em `src/lib/peer-spawn.js` passam a retornar `transport_descriptor: { agent, auth, endpoint_class }`:
  - Codex CLI → `{ auth: 'cli-subscription', endpoint_class: 'chatgpt-pro-backend' }`.
  - Claude CLI → `{ auth: 'cli-subscription', endpoint_class: 'claude-pro-backend' }`.
  - Gemini CLI com `~/.gemini/oauth_creds.json` → `{ auth: 'oauth-personal', endpoint_class: 'v1internal' }`.
  - Gemini CLI com `GEMINI_API_KEY` env → `{ auth: 'api-key', endpoint_class: 'generativelanguage-v1beta' }` (não alcançável sob o veto de billing 2026-04-24 — codificado defensivamente).
- `parsePeerOutputs(stdout, peerModel, transportDescriptor)` em `src/server.js` agora aceita o descriptor como 3º argumento. Gate: `authoritativeModelAttestationAvailable(descriptor)` (≡ `auth === 'api-key'`). Quando falso, `classifyModelMatch` é SKIPPED; o round record recebe `model_check_skipped: { reason: 'unreliable_text_self_report_on_cli', auth, endpoint_class }`. `model_failure_class` fica `null` sob bypass; `failure_class` fica reservado para falhas reais (spawn errors, rate-limits).
- `probeAgent` retira `tier: 'fallback'` ambíguo. Novos valores canônicos: `tier: 'ok' | 'offline'`. `ok` = respondeu E (api-key match OU bypass aplicado com `model_check_skipped` setado). `offline` = não respondeu ou falhou. Stubs de probe (`probeStubFor`) aceitam tanto `{top, fallback, excluded}` legacy quanto `{ok, offline}` canônico para backward-compat de smoke.
- Captura forensic-only `cli_attested_model_raw` em `spawnPeer` e `probeAgent`: extrai a linha de banner Codex CLI `model: <id>` via regex. Não-autoritativo; é apenas record-only para trilha de auditoria. Promoção a attestation autoritativa diferida para v0.7+.

- **Strict-only convergence + persisted snapshot (Item B / spec v4.9 §6.10):** predicate normativo — `converged iff caller_status === 'READY' AND every p in round.peers has p.peer_status === 'READY'`. `status_missing` conta CONTRA convergence (strict). Sem toggle "loose".
- `src/lib/session-store.js` `appendRound` computa e persiste `round.convergence_snapshot` com shape:
  ```
  {
    round_index, spec_version: 'v4.9', denominator_mode: 'strict',
    caller_status, responded_peers, excluded_probe, excluded_runtime,
    ready_peers, blocking_peers: [{ agent, reason }], converged
  }
  ```
  Snapshot é computado a partir de `meta.capability_snapshot.peers` (exclusões de probe) + `meta.failed_attempts` filtrado pela rodada (exclusões runtime) + `round.peers[]` (responded).
- `checkConvergence` prefere o `round.convergence_snapshot` persistido (imutabilidade histórica sob evolução futura do predicate); fallback a compute-on-read somente para rounds pré-v4.9. Return value agora inclui `convergence_snapshot` junto aos campos backward-compat.

- **Rate-limit class (Item C / spec v4.9 §6.12):** nova classe `rate_limit_induced_response`, ortogonal a `silent_model_downgrade`, `probe_no_model_report`, `unreliable_text_self_report_on_cli`.
- Detecção spawn-level em `peer-spawn.js` `spawnPeer` + `probeAgent`: lexeme set provider-shaped `{429, rate limit, usage limit, quota exceeded, insufficient_quota, RESOURCE_EXHAUSTED, Retry-After}`. Genéricos `{rate, quota, limit}` EXPLICITAMENTE EXCLUÍDOS para prevenir false-positives em meta-discussion legítima. `retry_after_seconds` parseado de `Retry-After: <N>` no stderr quando presente; `null` quando ausente (nunca fabricado).
- Não-zero exit com lexeme match → rejection error carrega `err.spawn_rate_limit = { retry_after_seconds, lexeme_matched, detection_source: 'spawn' }`. `ask_peers` handler em `server.js` classifica via `saveFailedAttempt(agent, 'rate_limit_induced_response', { failure_class, retry_after_seconds, detection_source: 'spawn', lexeme_matched })`.
- Detecção response-level em `server.js` `detectResponseRateLimit`: requer TODAS AS TRÊS — (1) `</cross_review_status>` ausente, (2) body < 200 chars, (3) lexeme provider-shaped match. Match → per-peer entry ganha `response_class: 'rate_limit_induced_response'` + `retry_after_seconds`; `peer_status` permanece `null` (conta contra strict convergence per Item B).
- `ask_peers` e `ask_peer` response envelope agora incluem `rate_limited_peers: [{ agent, retry_after_seconds, detection_source, lexeme_matched }]` para que o caller possa decidir retry-after-wait vs abort.

- `src/lib/peer-spawn.js` helpers exportados: `detectGeminiAuth`, `buildTransportDescriptor`, `authoritativeModelAttestationAvailable`, `RATE_LIMIT_LEXEMES`, `matchRateLimitLexeme`, `extractRetryAfterSeconds`, `detectSpawnRateLimit`, `extractCodexAttestedModelRaw`.
- `src/lib/session-store.js` helpers exportados: `computeConvergenceSnapshot`, `collectSessionExclusions`, `CONVERGENCE_SPEC_VERSION`.
- `saveFailedAttempt` extras estendidos: `retry_after_seconds`, `detection_source`, `lexeme_matched`. Aditivo; entries pre-v4.9 preservam shape v0.5.0-alpha.

### Alterado
- `src/server.js` `VERSION` bumpado `0.5.0-alpha.1` → `0.6.0-alpha`.
- `package.json` `version` bumpado `0.5.0-alpha.1` → `0.6.0-alpha`.
- `parsePeerOutputs` signature estendida para `(stdout, peerModel, transportDescriptor)`. Callers sem descriptor preservam comportamento v0.5.0-alpha (bypass desligado).
- `probeChain` fallback para rejection passa a retornar `tier: 'offline'` + `transport_descriptor` + `model_check_skipped: null` + `cli_attested_model_raw: null` (antes retornava apenas `tier: 'excluded'` e campos mínimos).
- `checkConvergence` return value agora inclui `convergence_snapshot` (aditivo). Backward-compat preservado para shape N-ary e bilateral.
- Peer Gemini sob oauth-personal + Google One AI Ultra não emite mais `protocol_violation=true` class `silent_model_downgrade` no audit trail (era o trade-off documentado em v0.5.0-alpha.1 — resolvido agora via bypass transport-class-aware, NÃO via migração SDK). Peer Codex sob ChatGPT Pro também beneficiado: a false-positive `gpt-5.5 → "gpt-5"` do text self-report deixa de ser flaggada.

### Corrigido
- Capability probe que flaggava BOTH Codex (`gpt-5.5 → "gpt-5"`) AND Gemini (`→ "Pro"`) como `silent_model_downgrade` em sessions triangulares sob CLI subscription auth. Evidência empírica: session `c9508617` 2026-04-24 confirmou que Codex CLI stderr banner `model: gpt-5.5` honra corretamente o pin no layer CLI; a mismatch está no text self-report unreliable do modelo, não em downgrade real. Correção normativa: bypass transport-class-aware elimina o false-positive em todos os CLI-subscription peers.

### Trade-offs documentados / diferidos para v0.7+
- **Anti-hallucination safeguards:** NEEDS_EVIDENCE discipline + exhaustive search directives no tail prompt + `evidence_sources` audit trail. Diferido para v0.7+ conforme diretiva do operador 2026-04-24.
- **Open-source readiness:** LICENSE + README + SECURITY.md + security audit para publicação GitHub pública. Diferido para v0.7+.
- **CLI stderr banner como authoritative attestation:** fragilidade sob ANSI codes + drift de versão do CLI. v0.6.0-alpha aceita captura forensic-only não-parseada (`cli_attested_model_raw`); promoção a attestation autoritativa (comparação hard-gate contra `peer_model`) fica para v0.7+.

---

## [0.5.0-alpha.1] — 2026-04-24

Patch release: pin Gemini bumpado de `gemini-2.5-pro` para `gemini-3.1-pro-preview`. CLI path mantido (oauth-personal), sem migração para SDK. Habilitação pelo Google One AI Ultra subscription do operador.

### Alterado
- **`GEMINI_MODEL = 'gemini-3.1-pro-preview'`** em `src/lib/peer-spawn.js` (era `gemini-2.5-pro`). Verificado empiricamente 2026-04-24 que o Gemini CLI 0.39.1 oauth-personal, sob Google One AI Ultra subscription, roteia `gemini-3.1-pro-preview` corretamente via endpoint `cloudcode-pa.googleapis.com/v1internal` sem silent-downgrade (servidor aceita IDs válidos, retorna 404 clean para IDs inválidos como `gemini-9.9-nonexistent`).
- **`docs/top-models.json`** gemini entry atualizada com id + notes documentando o Ultra-tier unlock e a limitação conhecida (response oauth-personal não expõe modelVersion autoritativo, então runtime silent-downgrade defense continua false-positive-flagging baseado no self-report de texto inconfiável; protocol_violation é noisy mas convergence continua funcionando baseado em peer_status só).
- `src/server.js` VERSION + `package.json` version bumpados de `0.5.0-alpha` para `0.5.0-alpha.1`.
- Header de `peer-spawn.js` reescrito para documentar a rota Ultra-tier + oauth-personal como autoritativa e a limitação do audit trail.

### Corrigido
- Operador com Google One AI Ultra subscription agora acessa o modelo 3.1-pro-preview (top-tier Gemini disponível) nas sessões cross-review-mcp sem custo extra (coberto pela subscription Ultra, não requer API key metered billing).

### Trade-off documentado (resolução futura em v0.6.0-alpha)
- Peer Gemini responde com `protocol_violation=true` class `silent_model_downgrade` mesmo quando o modelo correto (3.1-pro-preview) está sendo servido, porque o self-report textual do modelo hallucina (tipicamente "gemini-1.5-pro" ou "gemini-2.5-pro"). Isso é um falso-positivo conhecido. **Mitigação: adicionar bypass Gemini-específico na model-check quando `oauth-personal` (v0.6.0-alpha scope).** OU: migrar peer Gemini para @google/genai SDK contra v1beta (expõe `response.modelVersion` autoritativo) -- veto atual do operador por billing separado.

---

## [0.5.0-alpha] — 2026-04-24

Release F2: triangular + tier resilience integrados, per spec v4.7 (triangular topology additive) + v4.8 (tier resilience + transient failure handling). Design session selada em 4 rounds entre Claude Code (caller) e ChatGPT Codex (peer) sob mandato tri-tool (ultrathink + code-reasoning + cross-review). Implementação aplicada em 9 waves com smoke gate após cada wave (62 → 87 steps).

### Adicionado
- `VALID_AGENTS = {claude, codex, gemini}` — terceiro peer (Gemini) entra no arranjo como complemento triangular. `CROSS_REVIEW_CALLER` aceita os três; `PEERS = VALID_AGENTS.filter(a => a !== CALLER)` é N-ary.
- Ferramenta MCP `ask_peers` (N-ary): spawna todos os complementos em paralelo via `spawnPeers` (Promise.allSettled wrapped), preserva identity por peer (R12), registra spawns falhos em `meta.failed_attempts` com redaction R14, e persiste o round com `peers[]` + `quorum: {requested, responded, rejected}` para convergência N-ary (unanimidade).
- Capability probe em `session_init`: `probeChain` roda em paralelo contra todos os peers com budget alvo 25s / ceiling 30s, emite snapshot por agent `{agent, tier: top|fallback|excluded, requested_model, model_reported, model_match, probe_latency_ms, probe_budget_ms, exit_code, failure_class, timestamp}` e persiste em `meta.capability_snapshot` (session-level, nunca per-round). Controlado em testes por `CROSS_REVIEW_SKIP_PROBE=1` e `CROSS_REVIEW_PROBE_STUB`.
- Silent-downgrade defense: toda resposta de peer (real-spawn) é re-parseada pelo sibling `model-parser.js` (`parseDeclaredModel` + `classifyModelMatch`). O prompt do peer recebe tail-augmentation com diretriz para emitir `<cross_review_peer_model>{"model_id":"..."}</cross_review_peer_model>` imediatamente antes de `<cross_review_status>{...}</cross_review_status>`. Mismatch → `protocol_violation: true` com classe `silent_model_downgrade`; bloco ausente → classe `missing_model_report`. Não é retried (spec v4.8 §6.9.3.6 + F2 R15). Formalização diferida para spec v4.9 (TODO-spec-v4.9).
- `top-models.json` schema_version 2 com entry `gemini` pinado em `gemini-2.5-pro` (top verificado no auth path oauth-personal; 3.x previews ainda beta por diretriz do operador 2026-04-24), `fallback_chain[]` por entry com invariante `fallback_chain[0] === id`, `last_verified` substituindo `validated_at`, e `notes_en` por provider.
- `audit-model-drift.js` suporte estrito a schema v2: exige `schema_version === 2`, presença dos três agents canônicos (codex, claude, gemini), invariante `fallback_chain[0] === id` por entry, `last_verified` obrigatório, e reconhece constantes `GEMINI_MODEL` / `CODEX_MODEL` / `CODEX_REASONING_EFFORT` / `CLAUDE_MODEL` em `peer-spawn.js` via regex.
- `peer-spawn.js` branch Gemini: `GEMINI_MODEL = 'gemini-2.5-pro'`, `GEMINI_ALLOWED_MCP_SERVERS = ['memory','ultrathink','code-reasoning']` (cross-review-mcp deliberadamente ausente — recursion prevention), `buildGeminiArgs()` produzindo `-m gemini-2.5-pro -p " " --approval-mode plan --output-format text --allowed-mcp-server-names memory --allowed-mcp-server-names ultrathink --allowed-mcp-server-names code-reasoning`. `modelForPeer` estendido aos três agents; agent desconhecido lança erro.
- `peer-spawn.js` process-tree kill (R11): Windows `taskkill /PID /T /F`, Unix `process.kill(-pid, 'SIGKILL')`. Substitui o antigo `proc.kill('SIGKILL')` parent-only que deixava CLI órfão sob `shell: true`.
- `peer-spawn.js` `spawnPeers(agents, prompt, options)` — spawn N-ary paralelo preservando partial results via `{agent, status: 'fulfilled'|'rejected', value|reason}` (R12 explicit identity).
- `peer-spawn.js` `probeAgent(agent, {budgetMs})` + `probeChain(agents, options)` — probe CLI self-report mínimo com classificação de tier e short-circuit por stub via `CROSS_REVIEW_PROBE_STUB` (smoke-only). `extractReportedModel(stdout)` heurística de extração de id.
- `session-store.js` extensão de schema (v0.5.0-alpha): array `peers[]` (N-ary) junto ao scalar legacy `peer` (read-time `normalizePeers` sintetiza, idempotente, prefere `peers[]` quando ambos presentes e divergem), `capability_snapshot` session-level, `failed_attempts[]`, e `quorum` carregado em rounds N-ary. `checkConvergence` N-ary requer caller READY e todos os peers respondidos READY.
- `session-store.js` `saveCapabilitySnapshot`, `saveFailedAttempt(sessionId, agent, reason, extras)`, `redactSensitive(text)`, `clipStderrTail(text)` com patterns R14 (OpenAI sk-, Google AIza, GitHub gh_, Slack xox-, JWT, Bearer, PEM blocks, URL userinfo, atribuições env-style `TOKEN/SECRET/PASSWORD/API_KEY/PRIVATE_KEY`).
- Novo sibling parser `src/lib/model-parser.js` com `parseDeclaredModel(text)` (tail discipline: status block no tail; peer-model block como penúltimo structured block; caso contrário retorna null + parser warning) e `classifyModelMatch(requested, reported)`. Não compartilha estado com `status-parser.js` por R20.
- Corpus de stubs em `peer-spawn.js` estendido: `REAL_MATCH:<model>:<status>`, `REAL_DOWNGRADE:<requested>:<reported>:<status>`, `REAL_MISSING_MODEL:<requested>:<status>` retornam peer_model non-'stub' para exercitar o model-check server-side end-to-end.
- `functional-smoke.js` expandido de 62 para 87 steps: model-parser unit coverage (6), buildGeminiArgs shape, spawnPeers explicit identity (2), probeChain stub/tier (2), session-store N-ary + redaction (7), ask_peers end-to-end (2), ask_peer gemini-caller rejection (1), e ask_peer model-check via server para MATCH / DOWNGRADE / MISSING (3).

### Alterado
- `server.js` version bump `0.4.0-alpha` → `0.5.0-alpha`; startup log enumera `caller` + `peers[]` + `legacy_bilateral_peer` (ou `(none)` para caller=gemini).
- `server.js` `ask_peer` agora é estritamente bilateral (claude↔codex); callers gemini recebem erro explícito apontando para `ask_peers` (R23).
- `server.js` `parsePeerOutputs(stdout, peerModel)` é o ponto canônico de integração combinando `parsePeerResponse` (status) com `parseDeclaredModel` (model). O model-parser e seus warnings ativam apenas quando `peerModel !== 'stub'`; respostas stub bypassam o check por design.
- `server.js` todo prompt de peer spawnado recebe tail-augmentation via `attachPromptTailDirective` (bloco model declarado + status block).
- `session-store.js` `checkConvergence` agora roteia para lógica N-ary ou legacy baseado no shape do round (`round.peers[]` vs `round.peer_status`), preservando comportamento bilateral legacy.
- `top-models.json` `validated_at` → `last_verified` (schema v2); `reasoning_effort` retido na entry codex.
- `package.json` version bump `0.4.0-alpha` → `0.5.0-alpha`.

### Corrigido
- Preexisting-issues sweep (diretriz do operador 2026-04-24): todos os imports builtin migrados para `node:` protocol em `peer-spawn.js`, `session-store.js`, `audit-model-drift.js`, `functional-smoke.js`. Template literals substituem concatenação de strings nos sites flaggeados. Optional chaining substitui `a && a.b` nos sites novos. `while ((x = next()) !== null)` refatorado: `functional-smoke.js` centraliza o JSON-RPC reader como `attachJsonRpcReader(stream, responses)` (5 sites → 1 helper compartilhado); `peer-spawn.js` `listCodexConfiguredServers` usa `for (;;)` explícito. Destructuring com `payload` unused em `drivePeerModelAndWarningsPersisted` removido. Shadowed `const fs = require('fs')` dentro de driver functions removido em favor do import top-level.

### Removido
- Default bilateral legacy de `CROSS_REVIEW_CALLER`: o complemento binário `PEER` (scalar) não é mais derivado globalmente. `LEGACY_PEER` guarda o partner bilateral apenas para callers claude / codex; gemini não tem legacy partner.
- Campo `validated_at` em entries de top-models.json (renomeado para `last_verified` no boundary do schema v2).

---

## Infra e operacional (2026-04-24)

**Sistema de versionamento, CHANGELOG e memórias de agentes AI** adicionados seguindo o padrão dos demais repositórios do workspace lcv.

### Adicionado
- `CHANGELOG.md` (este arquivo) — histórico de mudanças.
- `.ai/memory.md`, `.ai/GEMINI.md` — memórias de contexto para agentes AI (formato paralelo aos outros repos do workspace).
- `.github/copilot-instructions.md` — diretivas do Copilot.
- `AGENTS.md` — pointer global às memórias AI do projeto.

### Alterado
- Discipline de versionamento formalizada: releases spec-only tracam no CHANGELOG por versão de spec (v4.1/v4.2/v4.3/v4.4/v4.5/v4.6); releases de código tracam via SemVer de `package.json`.

---

## GitHub activation (commits `23fb1b1`, `3acccc2`, `e5ec531` — 2026-04-24)

### Adicionado
- GitHub remote em `https://github.com/lcv-leo/cross-review-mcp` (privado).
- `.github/workflows/ci.yml` — Actions workflow que roda `npm run smoke` + `npm run check-models` em push/PR para `main`.
- `.github/dependabot.yml` — Dependabot configurado para `npm` + `github-actions` weekly (segunda 06:00 America/Sao_Paulo), 5 PRs/ecosystem cap.
- `LICENSE` (AGPL-3.0) importado do remote template.
- `SECURITY.md` importado do remote template (política de report privado).

### Alterado
- Actions atualizadas para `actions/checkout@v5` + `actions/setup-node@v5` (compatível com Node.js 24); workflow usa Node 22 LTS (antes Node 20, deprecated).
- History reescrita via `git filter-branch` substituindo `leonardocardozovargas@gmail.com` por `268063598+lcv-leo@users.noreply.github.com` em 15 commits, após GitHub rejeitar push inicial com `GH007: Your push would publish a private email address`.

### Corrigido
- Primeira CI run (`24875620870`) passou com warning Node 20 deprecation — corrigido imediatamente em `e5ec531` (bump actions + Node 22).

---

## Relocação do repositório (commit `983472f` — 2026-04-24)

Repositório movido de `C:/Scripts/cross-review-mcp/` para `C:/Users/leona/lcv-workspace/cross-review-mcp/` por diretiva do usuário.

### Alterado
- `README.md` — 5 referências de path atualizadas (Codex TOML, VS Code JSON, `claude mcp add`, `npm install cd`, `reviewer-minimal mcp-config` arg).
- Companion changes operacionais (fora do repo):
  - 4 MCP configs atualizadas: Claude Code workspace (`lcv-workspace/.mcp.json`), VS Code (`lcv-workspace/.vscode/mcp.json`), Antigravity (`~/.gemini/antigravity/mcp_config.json`), ChatGPT Codex (`~/.codex/config.toml`).
  - 7 memory files do Claude Code user com novo path.

---

## v4.6 — Language policy + bulk en-US migration (commits `6f7c607`, `d0998b5`, `f9ddf93`, `9904fd9` — 2026-04-24)

Spec-only. Zero toque em runtime (`src/server.js`, `src/lib/*.js`, `scripts/functional-smoke.js` imutáveis). Sessão cross-review `b1700438`, 5 rodadas, `outcome=converged`.

### Adicionado
- **§6.10 "Language policy for peer exchange and internal artifacts"** em `docs/workflow-spec.md`. Clausula normativa: todo peer exchange (prompts `ask_peer`, respostas do peer, transcripts em `~/.cross-review/`) + artefatos não-user-facing do cross-review-mcp (corpo da spec, scripts tooling + comments, campos `description`/`notes` de JSON, memórias do projeto, reports) DEVEM ser en-US. Autoriza bulk translation de conteúdo pt-BR pré-existente sem cross-review per-artifact.
- Exceções escopadas em §6.10: (a) chat assistant-user; (b) entradas historicamente seladas em §8 v4-v4.6 (não-retroativas); (c) documentos explicitamente user-facing (PR descriptions, CHANGELOG entries).

### Alterado
- Título da spec `v4.2` → `v4.6`; novas delta sections `0f` (v4.5→v4.6), `0e` (v4.4→v4.5), `0d` (v4.3→v4.4), `0c` (v4.2→v4.3).
- Corpo da spec (§§0-7) traduzido pt-BR → en-US mantendo fidelidade semântica.
- Comments/JSDoc de `src/server.js`, `src/lib/peer-spawn.js`, `src/lib/status-parser.js`, `src/lib/session-store.js`, `scripts/functional-smoke.js`, `scripts/audit-model-drift.js`, `scripts/probe-reviewer-isolation.js` traduzidos.
- `docs/top-models.json` campos `description` + `notes` traduzidos.
- `docs/reports/post-reload-cycle-2026-04-24.md` traduzido.
- `audit-model-drift.js`: variável `cravadas` renomeada para `pinned` (consistência EN).
- §7 table header + row labels traduzidos; §8 narrative "Uma vez aceita..." → "Once accepted..." traduzido; §8 follow-ups list traduzida + pruned (items fechados em v4.3/v4.4/v4.5 removidos).

### Corrigido
- Follow-up "Normalize historical non-ASCII drift (U+00A7)" marcado RESOLVED no §8 pós-v4.6 (commit `9904fd9`). Pré-v4.6: 24 ocorrências. Pós-v4.6: 1 (dentro de §8 sealed entry v4.2, preservada por §6.10 exception (b)).

---

## v4.5 — Em-revalidacao → aprovada pattern (commit `c6fc376` — 2026-04-24)

Spec-only. Sessão cross-review `843d57eb`, 3 rodadas, `outcome=converged`.

### Adicionado
- Preâmbulo editorial normativo em §8 `docs/workflow-spec.md`. Regra: entradas usando linguagem de aprovação bilateral SÓ PODEM ser gravadas em disco APÓS bilateral READY confirmado via `session_check_convergence`. Durante sessão (pre-sealing), usar "em revalidacao bilateral (sessao XXX, iniciada DATA)". Promoção para "aprovada bilateralmente" exige edit separado pos-sealing. Não-retroativa.

### Alterado
- Entrada §8 v4.5 autofollow o próprio padrão: edit inicial com "em revalidacao bilateral", promoção separada pós-sealing, ambos compostos em um commit.

---

## v4.4 — Schema v5 YAGNI-suspend (commit `47ffab9` — 2026-04-24)

Spec-only. Sessão cross-review `bd8c3cfb`, 2 rodadas, `outcome=converged`. Convergência mais rápida do ciclo.

### Alterado
- Follow-up original "caller_requests/follow_ups como arrays de objetos" substituído em §8 por YAGNI-suspension + critério de reabertura objetivo: "um peer v4-era nomeando UM caller_request concreto que tenha FALHADO por limitação de string". "Poderia ser melhor como objeto" NÃO conta.

---

## v4.3 — Drift audit advisory + tooling (commit `1553e65` — 2026-04-24)

Spec-only + tooling (zero toque em runtime). Sessão cross-review `9c56005b`, 4 rodadas, `outcome=converged`.

### Adicionado
- Nova subseção §6.9.2.1 "Model drift audit" em `docs/workflow-spec.md`. Advisory-only; não autoriza fallback silencioso, override, auto-selection, ou troca de ID sem bump + spec edit per §6.9.2.
- `docs/top-models.json` — fonte documental curada pelo usuário com entries por provider (`id`, `reasoning_effort?`, `validated_at`, `ref_url`, `notes`) + `staleness_threshold_days` global (default 30).
- `scripts/audit-model-drift.js` — script Node zero-deps. Lê `peer-spawn.js` via `fs.readFileSync` + regex fixos, compara contra `top-models.json`, emite exit codes 0 (OK) / 1 (drift ID ERROR) / 2 (staleness WARN) / 3 (erro estrutural).
- `package.json` — npm script `check-models`: `node scripts/audit-model-drift.js`.

---

## Alinhamento de versão (commit `382b7a8` — 2026-04-24)

Item 3 do ciclo pós-reload. Sessão cross-review `42130c72`, 2 rodadas, `outcome=converged`.

### Corrigido
- `package.json` version alinhada de `0.3.0-alpha` → `0.4.0-alpha` para bater com `src/server.js:48` (identidade MCP autoritativa).
- `package-lock.json` version alinhada de `0.2.0-alpha` → `0.4.0-alpha` (top-level + `packages[""]`).
- Técnica: `npm version 0.4.0-alpha --no-git-tag-version`. Side-effect cosmético em `bin` field revertido manualmente (diff final: exatamente 3 campos de version).

---

## v4.2 — Evidence matrix normativa (commit `9fdfef3`)

Spec-only. Sessão cross-review `f1fdbee4`, 5 rodadas, `outcome=converged`.

### Alterado
- §6.7 "Minimal evidence matrix per artifact class" promovida de FOLLOW-UP para normativa. Matriz tabular cobrindo JS, TS, JSON, Markdown, e o próprio cross-review-mcp.

---

## v4.1 — Overflow policy normativa (commit `1716c57`)

Spec-only. Sessão cross-review `a847f897`, 7 rodadas, `outcome=converged`.

### Alterado
- §6.6 "Overflow / truncamento" promovida de FOLLOW-UP para normativa. 4 subseções: 6.6.1 Transcript, 6.6.2 Ledger, 6.6.3 meta.json, 6.6.4 Non-destructive compression.
- §6.5 Ledger "suavizada" de linguagem obrigatória para opcional (evidência empírica: nenhum ledger produzido em uso real até 2026-04-24).

---

## [0.4.0-alpha] (commit `d5bc04e` — 2026-04-24)

Spec v4 normativa. Sessão cross-review `08cd61e6`, 2 rodadas, `outcome=converged`.

### Adicionado
- Schema JSON expandido do bloco estruturado (§2.3.1): campos opcionais `uncertainty`, `caller_requests`, `follow_ups` validados per-field com omit-unless-signal.
- `parser_warnings` + `peer_model` no contrato de retorno do parser (§5).
- §6.9 "Ferramentas complementares obrigatórias": 6.9.1 Tri-tool (cross-review + ultrathink + code-reasoning mandatórios pre-session_init) e 6.9.2 Modelo top-level (Codex=`gpt-5.5 xhigh`, Claude=`claude-opus-4-7`; sem fallback silencioso).

### Alterado
- `src/lib/status-parser.js` — validação per-field com whitelist de campos; unknown fields dropped com warning.
- `src/lib/peer-spawn.js` — flags de modelo explícitas em `buildCodexArgs` / `buildClaudeArgs`.

---

## v3 (commit `12cbcdd`)

Spec-only. Sessão cross-review `806a1c4f`, 3 rodadas.

### Adicionado
- §2.1 reescrita: contrato de STATUS ancorado no tail da resposta (ultima linha não-vazia). `NEEDS_EVIDENCE` adicionado ao enum.
- §2.2 Anchor posicional ("o que estiver no final vence").
- §2.3 bloco estruturado `<cross_review_status>{...}</cross_review_status>` como forma preferida (implementado em v0.3.0-alpha).
- §2.4 falha silenciosa do bloco estruturado.
- §6.3 `NEEDS_EVIDENCE` como estado peer-only canônico.
- §3.5 limitação operacional de sandbox do peer.

---

## [0.3.0-alpha] (commit `1d106f0`)

### Adicionado
- Initial commit do cross-review-mcp. Implementação MVP: 5 tools MCP (`session_init`, `session_read`, `session_check_convergence`, `session_finalize`, `ask_peer`), parser STATUS via regex legacy `STATUS: X`, spawn contido de peers (Codex `-a never -s read-only`, Claude `--permission-mode default --strict-mcp-config`), session state em `~/.cross-review/<uuid>/`, smoke tests E2E.

---

## Referências cruzadas

- Spec normativa vigente: `docs/workflow-spec.md` v4.6.
- Relatórios consolidados: `docs/reports/post-reload-cycle-2026-04-24.md` (ciclo de 5 items), `docs/reports/full-project-report-2026-04-24.md` (relatório abrangente).
- Testes: `scripts/functional-smoke.js` (60 steps, `npm run smoke`).
- Auditoria advisory: `scripts/audit-model-drift.js` (`npm run check-models`).
