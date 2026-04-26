# External code audit — Gemini, 2026-04-26

The operator commissioned an independent code audit from a Gemini agent
running outside the cross-review-mcp pipeline. The full report is
preserved here for traceability. This document records: (a) which
findings were validated against the v1.2.0 source, (b) which were
shipped in the v1.2.1 patch, (c) which are deferred to future releases
and why.

The audit predates the v1.2.0 ship (it does not mention the §6.20
dynamic caller resolution shipped earlier the same day) but was written
against a recent enough snapshot that v1.0.5 §6.16 + v1.1.0 §6.17–6.19
material is not surfaced as findings — those features are accepted as
present.

## Validation matrix

| # | Finding | Verified against v1.2.0 source | Shipped in v1.2.1 | Deferred / why |
|---|---|---|---|---|
| F1 | Path traversal via `session_id` | YES — `sessionDir` did `path.join(STATE_DIR, sessionId)` without UUID validation | YES — `assertValidSessionId` + `path.resolve` containment check + 5 smoke invariants in `driveV414PathTraversalGuardUnit` | — |
| F2 | Command injection via `shell: true` | NO real attack surface — cmd built from constants (`buildCodexArgs`/`buildClaudeArgs`/`buildGeminiArgs`); prompt goes via stdin not arg | NO | Best-practice hardening only. Migration to `shell: false` + arg arrays is a structural change with no field-evidenced bug. Track for v1.3+ if a dynamic-arg use case emerges. |
| F3 | Success-path outputs without redaction | YES (partial) — `saveFailedAttempt` redacts; success-path `stdout`/`stderr_tail` returned to caller without filter | NO | Threat model: peers are LLM CLIs on subscription tier; CLI banners do not contain creds in this setup. Mitigation is real defense-in-depth but not emergency. Track as F3-deferred for v1.3 — wrap success-path returns through `redactSensitive` before the response payload. |
| F4 | Runtime validation gaps (Zod) | YES — schemas are permissive (`session_id: { type: string }` without pattern) | YES (partial) — F1's UUID validation closes the highest-value subcase (path injection). | Zod-level rigor across all handlers is broader scope; track as F4-deferred for v1.3. The MCP SDK validates against JSON schema at the boundary; tightening schemas (`pattern`, `format`) is the next step. |
| F5 | Buffer accumulation / DoS | YES (partial) — `stdout += d` and `stderr += d` accumulate without cap (lines 559-560, 1055-1056 in `peer-spawn.js`); session disk growth IS already addressed by `session_sweep` (v1.1.0 §6.18) — auditor missed this. | NO | Practical risk is low (peers output O(10kb), 600s timeout caps duration). Track as F5-deferred for v1.3 — implement a per-stream byte cap (e.g., 1 MiB) with a `{ stream_truncated: true }` audit field when hit. |
| F6 | Lock lifecycle race | YES (bounded) — stale-detect + remove + recreate is non-atomic; `releaseLock` is unconditional (no PID/token check) | NO | Bounded race: the recreate's `mkdirSync` is itself atomic, so the worst-case is a thrown `EEXIST` already handled in fallback. The unconditional release CAN clobber a peer's lock under contention (rare). Track as F6-deferred for v1.3 — record `acquired_at` token in the lock dir and verify token match before release. |
| F7 | `log()` uses global `CALLER` instead of session-resolved | YES — line 171 `caller=${CALLER}` was the env-var, not session-resolved | YES — renamed to `env_caller=` in the prefix to make the semantics explicit (this prefix names the SERVER INSTANCE'S configured caller, not the round's resolved caller). Per-round logs already pass session-specific context via `meta` arg. | — |
| F8 | Stale model ID in tool description (`gemini-2.5-pro` vs pinned `gemini-3.1-pro-preview`) | YES — line 482 of `server.js` had stale `gemini=gemini-2.5-pro` in `ask_peer` description | YES — fixed + new smoke step `driveV414ToolDescriptionDriftUnit` asserts no stale IDs in descriptions and pinned IDs are referenced. | — |

## Findings the auditor missed

The Gemini audit was operating against a snapshot that did not yet
surface these v1.x defenses, so they were not credited in the report:

- **`session_sweep` (v1.1.0 §6.18)** — addresses F5 disk-side; long-idle
  sessions are reclaimable with `outcome: 'aborted'` + `outcome_reason:
  'stale'`.
- **Dynamic caller resolution (v1.2.0 §6.20)** — addresses F7 fully on
  the meta side; the F7 finding remained valid only for the `log()`
  prefix line, which v1.2.1 fixes.
- **`detectPromptModerationFlag` + recovery contract (v1.0.5 §6.16)** —
  not surfaced as a finding; was visible in source.

## Operator action item from the report

The auditor reported `gemini` peer as `tier: 'offline'` due to:

```
Gemini CLI is not running in a trusted directory. To proceed, either
use --skip-trust, set the GEMINI_CLI_TRUST_WORKSPACE=true environment
variable, or trust this directory in interactive mode.
```

This is **operational, not a code defect** — the local Gemini CLI
configuration in the audit environment did not trust the workspace
directory. To restore native trilateral redundancy in that environment,
either run `gemini trust` in the workspace OR set
`GEMINI_CLI_TRUST_WORKSPACE=true` in the MCP server env block.

## Roadmap synthesis

| Finding | Priority | Target release | Effort |
|---|---|---|---|
| F1 / F4 partial — UUID validation | P1 | **v1.2.1** (this) | small (DONE) |
| F7 — log prefix clarity | P1 | **v1.2.1** (this) | trivial (DONE) |
| F8 — description drift smoke | P1 | **v1.2.1** (this) | small (DONE) |
| F3 — success-path redaction | P2 | v1.3.0 | medium |
| F4 — full Zod runtime validation | P2 | v1.3.0 | medium |
| F5 — per-stream byte cap | P2 | v1.3.0 | medium |
| F6 — lock token verification | P3 | v1.3+ | small |
| F2 — shell:false + arg arrays | P3 | v1.3+ if vector emerges | medium |

The v1.3+ items are tracked but not blocking. v1.2.1 closes the
high-signal subset.
