# AGENTS.md — cross-review-mcp

Pointer global para agentes AI (Claude Code, Copilot, Gemini, Codex) trabalhando neste repositório. Atualizado para runtime `v1.2.2` / spec `v4.14` (2026-04-26).

---

## Fontes autoritativas

1. **`docs/workflow-spec.md`** — spec normativa (atualmente v4.14, ~2200 linhas). Fonte única de verdade para protocolo, diretivas operacionais, schema do bloco estruturado, e regras de versionamento. Cobre §§1-8 (STATUS protocol, tooling parity, FOLLOW-UP vs blocker, Noise, mandatory companion tooling incluindo §6.11 transport-aware model-check, §6.12 strict-only convergence, §6.13 rate-limit class, §6.14 anti-hallucination, §7 conventions summary, §8 acceptance criteria).
2. **`CHANGELOG.md`** — histórico de mudanças por versão (pt-BR para consumo do operator per §6.10 exception c). Releases listadas: v0.5.0-alpha → v1.2.2 (spec range v4.7 → v4.14).
3. **`CONTRIBUTING.md`** — contrato público de contribuição com três classes (trivial / additive / normative), gates obrigatórios, e non-negotiables. Classe 3 (normative) exige trilateral cross-review session antes do merge.

## Diretivas mandatórias resumidas

- **ASCII-only** em arquivos em disco (spec §6.4).
- **en-US** em peer exchange + artefatos internos do cross-review-mcp (spec §6.10). Exceções: chat assistant-user em pt-BR; §8 historical entries v4-v4.6 preservadas pt-BR (não-retroativas); `README.pt-BR.md` preservado para consumo do operator; `CHANGELOG.md` em pt-BR como user-facing per exception (c).
- **Tri-tool obrigatório** pre-session_init: cross-review + ultrathink + code-reasoning (spec §6.9.1). Pairing MUST hold throughout pipeline.
- **Modelo top-level** sempre, sem fallback silencioso (spec §6.9.2). IDs cravados em `peer-spawn.js`: `codex=gpt-5.5` + `reasoning_effort=xhigh`, `claude=claude-opus-4-7`, `gemini=gemini-3.1-pro-preview`. Troca exige bump + spec edit. Tier resilience (§6.9.3) é auditada, nunca silenciosa.
- **Transport descriptor (§6.11 v4.9)**: `spawnPeer` retorna `{ agent, auth, endpoint_class }`. `parsePeerOutputs` aplica `classifyModelMatch` apenas quando `auth === 'api-key'` (authoritative model attestation). Outros transports recebem `model_check_skipped` audit record — no false-positive `silent_model_downgrade`.
- **CLI transport, NOT SDK**. Peer spawn fica em CLI-subscription (billing covered by existing subscriptions). Migração para SDK (`@anthropic-ai/sdk`, `openai`, `@google/genai`) switches billing to per-token API metering — vetoed.
- **Strict-only convergence (§6.12 v4.9)**. `status_missing` counts AGAINST. Persisted `round.convergence_snapshot` with `spec_version`. No loose-mode toggle.
- **No fabrication (§6.14 v4.10)**. Lack of verified info → `NEEDS_EVIDENCE` with concrete `caller_requests`. Optional `confidence`/`evidence_sources` fields. `escalate_to_operator(session_id, question, context)` tool for terminal gaps.
- **Prompt-flag recovery (§6.16 v4.12)**. When a peer rejection carries `failure_class='prompt_flagged_by_moderation'` + `recovery_hint='reformulate_and_retry'`, the caller MUST reformulate the prompt per the embedded `reformulation_advice` (avoid charged words like "adversarial"/"jailbreak"/"exploit"/"bypass"; replace model-introspection prose with neutral technical descriptions) and call `ask_peers`/`ask_peer` again in a NEW round — repeat up to 5 attempts. **Do NOT abort the session** — only the flagged peer's contribution for that round is missing, and reformulation recovers it. Aborting on a moderation flag is non-conforming behavior.
- **Spec-version persistence (§6.17 v4.13)**. Every `session_init` records `meta.spec_version = SESSION_SPEC_VERSION` (currently `'v4.14'`). Audit consumers MUST tolerate the field's absence on pre-v4.13 sessions.
- **Long-idle reconciliation + outcome_reason (§6.18 v4.13)**. New `session_sweep` tool finalizes long-idle sessions with `outcome: 'aborted'` + `outcome_reason: 'stale'`. 24h hard floor is non-overridable. Locked sessions are reported, never finalized. Dry-run is read-only. `session_finalize` accepts optional `reason` argument; conventions: `'stale'`, `'peer_scope_creep'`, `'moderation_flag_unresolved'`, `'operator_abort'`. Free-form string — open list.
- **Peer-exchange language (§6.10 + §6.10.1 clarification v1.2.2)**. All `task` and `prompt` fields sent through `session_init`/`ask_peer`/`ask_peers` are peer exchange and MUST be en-US, regardless of the operator-facing chat language. The caller is responsible for translating peer-exchange content to en-US before submission. Operator chat in pt-BR (per §6.10 exception a) does NOT propagate. Runtime emits advisory `task_language_warning`/`prompt_language_warning` when non-en-US is detected (diacritics + pt-BR lexemes); warn-only currently, may tighten to hard-reject after field calibration.
- **Convergence-health hint (§6.19 v4.13)**. Every `ask_peer`/`ask_peers` response carries `convergence_health: 'normal' | 'extended' | 'concerning'` (also persisted in `round.convergence_health`). PURELY ADVISORY: caller SHOULD consider stepping back at `concerning`, but no automatic action is triggered. v1.1.0 thresholds: extended at rounds≥6, concerning at rounds≥8 (round-count only; pattern detection deferred to future release).
- **Em-revalidacao → aprovada**: entradas §8 com "aprovada bilateralmente/trilateralmente" só pós-`session_check_convergence`=true (spec §8 preâmbulo v4.5).
- **Runtime immutable em bumps coordenados**: `src/server.js`, `src/lib/*.js`, `scripts/functional-smoke.js` mudam juntos.

## Gates obrigatórios

```bash
npm test              # 156 smoke steps at v1.2.2 (count grows with each release; check the last line)
npm run check-models  # OK: no drift, fallback_chain invariant holds, no staleness
```

Ambos gates também rodam em CI (`.github/workflows/ci.yml`) em push/PR para main.

## Commit messages

Conventional Commits, em English. Exemplos: `feat(v0.9.0-alpha.1): ...`, `docs(v4.11): ...`, `fix(parser): ...`, `chore: ...`, `ci: ...`. Incluir `Co-Authored-By:` quando assistido por AI. Class 3 PRs MUST citar session UUID + spec delta no body.

## Versionamento

- Código: SemVer em `package.json` alinhado com `src/server.js` `VERSION`. Integer triplet + pre-release tag (`-alpha`, `-alpha.N`).
- Spec: ciclo próprio (v4.1, v4.2, ..., v4.14) documentado em §8. Releases spec-only NÃO bumpam código.
- CHANGELOG.md atualizado a cada release. `[Unreleased]` section só contém follow-ups abertos.
- v1.x semver policy (aprovada por trilateral session 6cf09af3 2026-04-24): patch = bug fix preservando frozen surface; minor = additive; major = breaking change em frozen surface (requires new trilateral session per §8 v4.5 preamble).

## Repositório

- Local: `C:/Users/leona/lcv-workspace/cross-review-mcp/` (independent git repo dentro do workspace).
- Remote: `github.com/lcv-leo/cross-review-mcp` (**público desde v0.9.0-alpha pre-cut**).
- Branch principal: `main`.
- License: Apache-2.0 (adotada em v0.9.0-alpha pre-cut 2026-04-24; ver `LICENSE` + `NOTICE`).
- CI: GitHub Actions (`npm test` + `npm run check-models` em Node 22 LTS / ubuntu-latest).
- Dependabot: npm + github-actions weekly.

## Idiomas dos arquivos (§6.10)

| Arquivo | Idioma | Razão |
|---------|--------|-------|
| `docs/workflow-spec.md` corpo §§0-7 + narrative/follow-ups | en-US | peer-consumed, non-user-facing (§6.10 default) |
| `docs/workflow-spec.md` §8 sealed entries v4-v4.6 + preâmbulo v4.5 rule | pt-BR | non-retroactive (§6.10 exception b) |
| `docs/workflow-spec.md` §8 entries v4.7+ | en-US | authored post-v4.6 under the en-US rule |
| `src/`, `scripts/` (comments, JSDoc, stderr) | en-US | non-user-facing (§6.10 default) |
| `docs/top-models.json` (description, notes) | en-US | §6.10 default |
| `docs/reports/*.md` | en-US | §6.10 default |
| `README.md` (primary public) | en-US | public-facing on GitHub |
| `README.pt-BR.md` (historical) | pt-BR | §6.10 exception c + non-retroactive preservation |
| `CHANGELOG.md` | pt-BR | user-facing operator-directed per §6.10 exception c |
| `CONTRIBUTING.md` | en-US | public-facing contribution model |
| `CODE_OF_CONDUCT.md` | en-US | public-facing community standard |
| `SECURITY.md` | en-US | public-facing disclosure channel |
| `LICENSE`, `NOTICE` | en-US (canonical) | Apache-2.0 canonical text |
| `AGENTS.md` (este) | pt-BR | agent-facing operator documentation, user-facing exception c |
| Chat assistant-user | pt-BR | user-facing per §6.10 exception a |

## Auditoria periódica

Este arquivo deve ser auditado a cada release (patch+) para garantir que spec version, smoke step count, runtime version, e claim de visibilidade remote continuam corretos. Stale references aqui quebram o contrato de pointer para agents. Regressão catch em field-use session #2/10 (2026-04-24, `5db2617c`): AGENTS.md estava em v4.6 / 60 steps / private quando runtime real era v0.9.0-alpha.1 / 125 / public. Este refresh fecha essa regressão.
