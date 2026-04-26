# cross-review-mcp

> MCP server orchestrating cross-review between Claude Code, ChatGPT Codex, and Gemini CLI.

[![status: stable](https://img.shields.io/badge/status-stable-brightgreen.svg)](#status)
[![npm](https://img.shields.io/npm/v/@lcv-leo/cross-review-mcp.svg)](https://www.npmjs.com/package/@lcv-leo/cross-review-mcp)
[![spec: v4.14](https://img.shields.io/badge/spec-v4.14-informational.svg)](./docs/workflow-spec.md)
[![MCP](https://img.shields.io/badge/MCP-stdio-blue.svg)](https://modelcontextprotocol.io/)
[![license: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

**Install.** `npm install -g @lcv-leo/cross-review-mcp` (npmjs.com) or `npm install -g @lcv-leo/cross-review-mcp --registry=https://npm.pkg.github.com` (GitHub Packages mirror).

**Status.** Stable. Current release: **v1.2.2** runtime paired with **spec v4.14**. See [CHANGELOG.md](./CHANGELOG.md) for the release history. v1.x releases follow a frozen-public-surface contract (see [CONTRIBUTING.md](./CONTRIBUTING.md) for the v1.x semver policy: patch additive within frozen surface, minor additive only, major requires a new trilateral cross-review session). v1.0 was cut on 2026-04-25 after a 10-session field-use validation gate per operator directive 2026-04-24, ratified by trilateral final approval session `fca13b80`.

The version history at a glance:

| Release | Spec | Scope |
|---|---|---|
| `v0.5.0-alpha` | v4.7 + v4.8 | Triangular topology + tier resilience + transient failure handling |
| `v0.5.0-alpha.1` | v4.8 | Gemini pin bumped to `gemini-3.1-pro-preview` under Google One AI Ultra |
| `v0.6.0-alpha` | v4.9 | Transport-aware model-check bypass + strict-only convergence with persisted snapshot + rate-limit class |
| `v0.7.0-alpha` | v4.10 | Anti-hallucination / epistemic discipline + CLI banner as authoritative attestation (Codex-specific) |
| (spec-only) | v4.11 | Claude CLI banner parsing follow-up CLOSED as negative empirical result |
| `v0.9.0-alpha` | v4.11 | Public-GitHub pre-cut: en-US README + CONTRIBUTING + CODE_OF_CONDUCT + NOTICE + Apache-2.0 LICENSE + full-history secrets scan |
| `v0.9.0-alpha.1` | v4.11 | Fix: Gemini auth detection precedence (settings.json → env → oauth_creds → default); eliminates false-positive `silent_model_downgrade` when `GEMINI_API_KEY` env is present in MCP host with oauth-personal CLI |
| `v1.0.0` | v4.11 | Stable cut. Frozen public surface: 7 MCP tools, structured peer-block contracts, `meta.json` semantics, strict-only convergence predicate, transport descriptor + audit fields/enums. v1.x follows the semver policy in CONTRIBUTING.md. Cut ratified by 10-session field-use validation gate (PRAGMATIC counting rule, 2026-04-24/25) + trilateral final approval session `fca13b80` (2026-04-25). |
| `v1.0.1` | v4.11 | Doc-only patch: refresh user-visible MCP tool descriptions (`session_init` / `session_read` / `ask_peer` / `ask_peers` / `escalate_to_operator` / tail directive) to current spec head. Removed stale alpha labels (`v0.5.0-alpha` / `v0.7.0-alpha`) and outdated cites (`spec v4.7` / `v4.8` / `v4.10`). Zero behavioral change. |
| `v1.0.2` | v4.11 | First npm publish. Renamed package to `@lcv-leo/cross-review-mcp`, published to both npmjs.com and GitHub Packages with provenance attestations. Added `files` whitelist (-58% tarball size, 13 files). Zero behavioral change. |
| `v1.0.3` | v4.11 | **Security patch.** ReDoS hardening: replaced `/\s+$/` regex with `String.prototype.trimEnd()` in `model-parser.js` and `status-parser.js` (CodeQL `js/polynomial-redos` alerts #1 + #2 resolved). Zero observable change. |
| `v1.0.4` | v4.11 | Workspace parity sweep + Pages enablement. Added `THIRDPARTY.md` + `.github/CODEOWNERS`. `actions/configure-pages` declares `with: enablement: true` for idempotency on forks/clones. Zero behavioral change. |
| `v1.0.5` | **v4.12** | **§6.16 prompt-flag recovery contract.** New `failure_class: 'prompt_flagged_by_moderation'` + `recovery_hint: 'reformulate_and_retry'` + embedded `reformulation_advice` text on rejected peers. Caller MUST reformulate (up to 5 attempts) and resubmit; aborting on a moderation flag is non-conforming. 60-session audit shipped at `docs/session-audit-2026-04-26.md`. |
| `v1.1.0` | **v4.13** | Audit closure (FU-1..FU-4). §6.17 `meta.spec_version`; §6.18 `session_sweep` long-idle reconciliation + structured `outcome_reason`; §6.19 advisory `convergence_health` per round (`normal`/`extended`/`concerning`). 8th MCP tool: `session_sweep`. Validated by trilateral cross-review `483b2d1c` (READY in R2). |
| `v1.2.0` | v4.14 | **§6.20 dynamic caller resolution.** session_init now resolves the caller per call with precedence `args.caller` > MCP `clientInfo.name` mapping > `CROSS_REVIEW_CALLER` env var. Each session's peers are computed dynamically from the resolved caller. ask_peer / ask_peers read caller and peers from `meta.json` (not global constants). New `meta.caller_resolution = { source, client_info_name }` audit field. README/spec/CHANGELOG anti-drift smoke step prevents recurrence of v1.0.4/v1.0.5-style doc lag. |
| `v1.2.1` | v4.14 | **External-audit hardening (Gemini audit 2026-04-26).** F1: `session_id` UUID validation in `sessionDir()` + `path.resolve` containment check (path-traversal defense). F7: `log()` prefix renamed `env_caller=` so it's clear the prefix names the server-instance config, not the resolved per-round caller. F8: stale `gemini-2.5-pro` reference in `ask_peer` description swapped for pinned `gemini-3.1-pro-preview` + new smoke step asserts no stale model IDs in tool descriptions. Audit roadmap at `docs/external-audit-2026-04-26-gemini.md`. F2/F3/F5/F6 deferred to v1.3+ with rationale documented. |
| **`v1.2.2`** | v4.14 (§6.10.1 clarification) | **Peer-exchange language enforcement (B+C).** Field-evidence from a Gemini-initiated session that submitted a pt-BR `ask_peers` prompt motivated formalization of §6.10's caller responsibility: operator-facing chat language does NOT propagate to peer exchange. (B) Tool descriptions for `session_init`/`ask_peer`/`ask_peers` now carry an explicit en-US directive block. (C) Runtime detects non-en-US in `task` and `prompt` fields via two conservative signals (≥4 diacritics OR ≥3 pt-BR-specific lexemes); emits non-blocking advisory `task_language_warning`/`prompt_language_warning` field on the response with `confidence: low|medium|high`. Warn-only currently — operator may tighten to hard-reject after observing false-positive rate. Spec §6.10.1 clarification (no version bump) records the caller obligation. |

---

## What it does

`cross-review-mcp` is an **MCP stdio server** that orchestrates **structured review sessions** between three top-tier AI peers:

- **Claude Code** (Anthropic Claude Pro/Max subscription, model `claude-opus-4-7`)
- **ChatGPT Codex** (ChatGPT Pro subscription, model `gpt-5.5` + `reasoning_effort=xhigh`)
- **Gemini CLI** (Google One AI Ultra subscription, model `gemini-3.1-pro-preview` via oauth-personal)

Any one of the three serves as the **caller**; the other two (or one, for bilateral sessions) serve as **peers**. The server spawns peers under contained CLI invocations, collects their structured responses, and reports convergence via a unanimity predicate:

> **converged iff caller_status === 'READY' AND every responded peer has peer_status === 'READY'**

This is the canonical defense against single-model hallucinations: if one peer confabulates, the other two catch it. The protocol codifies the defense rather than rely on emergent behavior.

---

## Topology

The server supports two session shapes:

- **Bilateral** (`ask_peer`): legacy `claude<->codex` only. Gemini callers must use `ask_peers`.
- **Trilateral / N-ary** (`ask_peers`): all complements spawn in parallel via `Promise.allSettled`. Per-peer identity is explicit (R12 invariant: never infer agent from array index). Failed spawns enter `meta.failed_attempts[]` (redacted per R14) and are excluded from the convergence denominator.

Convergence uses the strict denominator: **`status_missing` counts AGAINST**. No "loose mode" toggle. Round state is snapshotted at append time into `round.convergence_snapshot` with `spec_version: 'v4.9'` — audit immutability under future predicate evolution.

---

## Peers and transport

All three peers are spawned via their **CLI** (not SDK). This is a deliberate billing-coverage choice: each CLI is covered by a subscription the operator already pays for. Migrating to the official SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) would switch billing to per-token API metering, which is vetoed.

**Transport descriptor** returned by `spawnPeer` / `probeAgent`:

| agent  | auth              | endpoint_class                  | Notes |
|--------|-------------------|---------------------------------|-------|
| codex  | `cli-subscription`  | `chatgpt-pro-backend`             | Stderr banner `model: <id>` parsed for authoritative attestation (spec v4.10 §6.11 amendment). |
| claude | `cli-subscription`  | `claude-pro-backend`              | No stderr banner in CLI 2.1.119 (empirically surveyed 2026-04-24, spec v4.11). Falls back to `model_check_skipped` path. |
| gemini | `oauth-personal`    | `v1internal` (cloudcode-pa)       | No authoritative `modelVersion` header — §6.11 skip applies. Ultra tier unlocks 3.x preview models. |
| gemini | `api-key`           | `generativelanguage-v1beta`       | Defensive-coded but not reachable under the current billing veto. |

**Item A (spec v4.9 §6.11).** For non-api-key transports the model's text self-report is unreliable across all three providers; `parsePeerOutputs` gates `classifyModelMatch` on `authoritativeModelAttestationAvailable(descriptor)` (equivalent to `auth === 'api-key'`). When false, the check is SKIPPED with an audit record (`model_check_skipped`) instead of flagging false-positive `silent_model_downgrade`.

**Item E (spec v4.10 §6.11 amendment).** For `cli-subscription` transports with a parseable CLI stderr banner, the banner is promoted from forensic-only to AUTHORITATIVE attestation. Banner MATCH → `cli_banner_attested: true` audit elevation. Banner MISMATCH → hard gate: `model_failure_class: 'cli_banner_attestation_mismatch'` + `protocol_violation: true`. Codex-specific in practice (spec v4.11 survey closed the Claude follow-up as negative).

---

## Install

### Prerequisites

- **Node.js 18+**
- The three peer CLIs installed, authenticated, and on PATH:
  - `claude` — Claude Code CLI (`npm install -g @anthropic-ai/claude-code` or equivalent)
  - `codex` — Codex CLI (requires ChatGPT Pro subscription)
  - `gemini` — Gemini CLI (requires Google account; Ultra tier recommended for 3.x preview access)
- Active subscriptions covering each CLI (see [Peers and transport](#peers-and-transport)).

### Clone and install

```bash
git clone https://github.com/lcv-leo/cross-review-mcp.git
cd cross-review-mcp
npm install
```

The only runtime dependency is `@modelcontextprotocol/sdk`.

### Gate verification

Before using the server or after any edit, confirm both gates pass:

```bash
npm test             # 156 smoke steps (unit + end-to-end stdio JSON-RPC)
npm run check-models # model-drift audit against docs/top-models.json
```

Both must report GREEN. The smoke suite exercises: parser fuzz coverage, schema evolution, spawn contention, probe stubs, session-store atomicity, redaction, N-ary convergence, model-check MATCH/DOWNGRADE/MISSING, rate-limit detection, banner attestation, anti-hallucination confidence/evidence_sources field parsing, operator escalation end-to-end, and Gemini auth-detection precedence regression coverage. Exact count evolves with each release — check the last line of `npm test` output for the current total.

---

## Register with each peer

Each peer registers the MCP server with its own `CROSS_REVIEW_CALLER` env var. The server uses that var to determine identity at startup and compute `PEERS = VALID_AGENTS.filter(a => a !== CALLER)`.

### Claude Code

```bash
claude mcp add -e CROSS_REVIEW_CALLER=claude -s user cross-review -- node /absolute/path/to/cross-review-mcp/src/server.js
```

Verify: `claude mcp get cross-review` should show `Status: Connected`.

### ChatGPT Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.cross-review]
command = "node"
args = ["/absolute/path/to/cross-review-mcp/src/server.js"]
env = { CROSS_REVIEW_CALLER = "codex" }
tool_timeout_sec = 1800
```

Verify: `codex mcp get cross-review` should show `enabled: true, transport: stdio`.

### Gemini CLI

Add to `~/.gemini/settings.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "cross-review-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/cross-review-mcp/src/server.js"],
      "env": { "CROSS_REVIEW_CALLER": "gemini" }
    }
  }
}
```

Verify: invoke `gemini` and confirm `cross-review-mcp` appears in the MCP list.

### Reload clients

After registering, reload each host (VS Code extensions: Command Palette → "Developer: Reload Window"; Gemini CLI: restart the REPL). For some changes a full application exit+relaunch is required to pick up PATH env changes (Reload Window alone is insufficient).

---

## Running a session

A high-level session from the caller's perspective:

1. **Initialize.** Call `session_init(task, artifacts[])`. The server runs a parallel capability probe (target 20-25s, hard ceiling 30s) and persists `meta.capability_snapshot` with per-agent tier (`ok` | `offline`).
2. **Round 1: caller drafts.** Caller forms its parecer (opinion/analysis). Caller then calls `ask_peers(session_id, prompt, caller_status: 'NOT_READY')` sending the parecer to all peers in parallel. The server attaches a **tail directive** to the prompt requiring the peer to close with two structured blocks:
   - `<cross_review_peer_model>{"model_id":"..."}</cross_review_peer_model>`
   - `<cross_review_status>{"status":"READY|NOT_READY|NEEDS_EVIDENCE", ...}</cross_review_status>`
   The status block MUST be the last non-empty token of the response.
3. **Parse and examine.** The server parses each peer's stdout via two sibling parsers (`parsePeerResponse` + `parseDeclaredModel`) and attaches `transport_descriptor` + `cli_attested_model_raw` metadata. The response envelope surfaces `peers[]` with per-peer `peer_status`, `peer_structured` (clean JSON payload), `status_source` (`structured` | `regex` | `null`), `parser_warnings[]`, `model_check_skipped` (when applicable), `protocol_violation`, plus the round-level `rate_limited_peers[]` array.
4. **Iterate.** If any peer is `NOT_READY` or `NEEDS_EVIDENCE`, address their findings (incorporate valid ones, refute invalid with evidence, run commands requested via `caller_requests[]`) and repeat step 2.
5. **Converge.** When caller is satisfied AND all peers declared `READY`, call `ask_peers` with `caller_status: 'READY'`. Call `session_check_convergence(session_id)` to confirm `converged === true`. Finalize with `session_finalize(session_id, outcome: 'converged')`.
6. **Safety cap.** Abort after a reasonable max-rounds (commonly 10) with `session_finalize(session_id, outcome: 'max-rounds')`.

### Anti-hallucination discipline (spec v4.10 §6.14)

When any participant lacks verified information to complete a claim:

1. **Do not invent.** No plausible-sounding fabrication.
2. **Exhaustively search first.** Re-read artifacts, re-query tools, consult primary sources (docs, CLI `--help`, live probes).
3. **Emit `NEEDS_EVIDENCE`** with concrete `caller_requests` when a peer exchange can resolve it.
4. **Escalate to the operator last** via the `escalate_to_operator(session_id, question, context)` tool when peer exchange alone cannot close the gap. This persists under `meta.escalations[]`; the caller orchestrator surfaces the question via chat.

Optional structured fields to self-declare epistemic state:

- `confidence: 'verified' | 'inferred' | 'unknown'` — `unknown` MUST pair with `status: 'NEEDS_EVIDENCE'`.
- `evidence_sources: ["file:path.ext", "tool:name", "url:https://...", "cli:command --help"]` — concrete sources consulted. `verified` should include at least one entry.

---

## Observe the session

Session state is live on disk under `~/.cross-review/<session-id>/`:

- `meta.json` — full index: rounds, caller_status, peer statuses, peer_structured, status_source, duration_ms, `capability_snapshot`, `failed_attempts` (R14-redacted), `escalations`, `convergence_snapshot` per round.
- `round-NN-prompt.md` — prompt sent to peers for that round.
- `round-NN-peer-<agent>.md` — raw response from each peer.

Useful for debugging when a session diverges from expectations.

---

## Protocol contract

The full normative spec lives at **[`docs/workflow-spec.md`](./docs/workflow-spec.md)** (v4.11 at the time of writing; ~2200 lines; en-US per §6.10).

Quick reference — section map:

| Section | Topic |
|---|---|
| 1 | Session-opening contracts (artifacts, transcript, scope clause) |
| 2 | STATUS protocol (format, positional anchor, structured block, triangular topology, dynamic role assignment) |
| 3 | Tooling parity + CALLER_REQUEST operational valve |
| 4 | FOLLOW-UP vs. blocker |
| 5 | Noise (display names, parser warnings) |
| 6.3 | NEEDS_EVIDENCE state + N-ary convergence |
| 6.6 | Overflow / truncation (transcript, ledger, meta.json) |
| 6.9 | Mandatory companion tooling (tri-tool: ultrathink + code-reasoning + cross-review) |
| 6.9.2 | Top-level model pins per provider (no silent fallback) |
| 6.9.3 | Subscription tier resilience + transient failure handling |
| **6.11** | **Transport-aware model-check discipline** + CLI banner as authoritative attestation |
| **6.12** | **Strict-only convergence + persisted snapshot** |
| **6.13** | **Rate-limit class distinct from silent-downgrade** |
| **6.14** | **Anti-hallucination / epistemic discipline** |
| 7 | Summary of conventions (quick-reference table) |
| 8 | Acceptance criteria (session-by-session approval trail) |

---

## Architecture

```
cross-review-mcp/
|-- src/
|   |-- server.js                    MCP stdio entrypoint; 7 tools
|   |-- lib/
|       |-- session-store.js         ~/.cross-review/ state; atomic write + lock
|       |-- peer-spawn.js            Contained CLI spawn for each peer
|       |-- status-parser.js         STATUS + v4/v4.10 structured block parser
|       |-- model-parser.js          Sibling peer-model block parser (silent-downgrade defense)
|-- scripts/
|   |-- functional-smoke.js          JSON-RPC stdio smoke (156 steps at v1.2.2; count grows with each release)
|   |-- audit-model-drift.js         Advisory drift audit (check-models)
|   |-- probe-reviewer-isolation.js  Legacy Commit-1 hard gate; retained for regression
|-- docs/
|   |-- workflow-spec.md             Normative spec v4.11
|   |-- top-models.json              Schema v2 runtime + advisory table
|-- reviewer-configs/
|   |-- peer-exclusions.json         Codex MCP/apps disable list + approve_tools
|   |-- reviewer-minimal.mcp.json    Minimal --mcp-config for Claude peer spawn
|-- AGENTS.md                        Contract for agents operating inside this repo
|-- CHANGELOG.md                     Release history (pt-BR; operator-facing)
|-- SECURITY.md                      Responsible disclosure + controls
|-- LICENSE                          Apache-2.0
|-- NOTICE                           Apache-2.0 attribution + third-party notices
|-- README.md                        This file (en-US; public-facing)
|-- README.pt-BR.md                  Historical pt-BR README (operator preservation)
```

### Exposed tools (7 total, MCP stdio)

| Tool | Since | Purpose |
|---|---|---|
| `session_init(task, artifacts)` | v0.3.0-alpha | Create session dir; run capability probe; persist `capability_snapshot`. |
| `session_read(session_id)` | v0.3.0-alpha | Return full `meta.json` (rounds, snapshot, escalations, failed_attempts). |
| `session_check_convergence(session_id)` | v0.3.0-alpha | Read the persisted `convergence_snapshot` (or compute for legacy rounds). |
| `session_finalize(session_id, outcome)` | v0.3.0-alpha | Seal with `converged` / `aborted` / `max-rounds`. |
| `ask_peer(session_id, prompt, caller_status)` | v0.3.0-alpha | Bilateral `claude<->codex` only. |
| `ask_peers(session_id, prompt, caller_status)` | v0.5.0-alpha | N-ary parallel spawn; canonical for triangular. |
| `escalate_to_operator(session_id, question, context)` | v0.7.0-alpha | Record anti-hallucination escalation under `meta.escalations[]`. |

---

## Development

### Make a change, verify gates

```bash
npm test              # 156 smoke steps must stay GREEN (count may grow across releases; check the last line of output)
npm run check-models  # advisory drift audit; must stay clean
```

Edits to `src/lib/peer-spawn.js` that change model pins also require updating `docs/top-models.json` in the same commit (the `check-models` gate enforces this).

### Run a single smoke driver

The smoke script is organized into small drivers; you can extract one to debug by calling it directly. See `scripts/functional-smoke.js` around the `runAll()` function.

### Test-import guard

`src/server.js` honors `CROSS_REVIEW_TEST_IMPORT=1` to skip `main()` on load + relax `CROSS_REVIEW_CALLER` validation. This lets unit drivers `require('../src/server.js')` for pure-function tests. Spawned-server tests must explicitly `delete childEnv.CROSS_REVIEW_TEST_IMPORT` to avoid env leak into subprocesses.

### Spec-versioning convention

Code releases use SemVer (`0.9.0-alpha`, `0.9.0-alpha.1`, …). Spec revisions use their own `vN.M` sequence (`v4.7` through `v4.11` so far). A spec-only revision (pure documentation) does NOT bump the code version; an integrated release ships both. Version IDs may skip (e.g. `0.7.0-alpha` → `0.9.0-alpha` with no `0.8.0-alpha` — the skipped slot reflects that spec v4.11 was a spec-only revision that closed a follow-up without a code release).

---

## Contributing

Cross-review-mcp uses its own protocol as the contribution model. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the trilateral design-review workflow required before scope-introducing PRs.

In short:

- Bug fixes + trivial refactors → standard PR with smoke + check-models green.
- New normative spec sections / API-shape changes / protocol semantics → open a trilateral cross-review session first. Implementation-ratified releases are acceptable for deferred scope from a prior approved session (see spec §8 preamble / v4.5 rule).

Community participation is scoped by the code of conduct at **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** (Contributor Covenant 2.1).

---

## Security

See **[SECURITY.md](./SECURITY.md)** for responsible disclosure. Short form:

- Vulnerabilities: report privately to **alert@lcvmail.com**. Please do NOT open a public issue.
- Runtime hardening: R14 redaction on persisted stderr + failed-attempt payloads (OpenAI `sk-`, Google `AIza`, GitHub `gh[pousr]_`, Slack `xox[baprs]-`, JWT, Bearer, PEM blocks, URL userinfo, env-style `*_TOKEN`/`*_SECRET`/`*_API_KEY` assignments).
- Full-history secrets scan completed 2026-04-24 against 10 common patterns — clean (all matches are R14 test fixtures by design).

---

## License

**Apache License 2.0** — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Apache-2.0 was chosen at the v0.9.0-alpha pre-cut (2026-04-24) over MIT and AGPLv3 for ecosystem compatibility with the broader MCP reference-server set (most of which are MIT or Apache-2.0) and for the explicit patent grant that Apache-2.0 provides over MIT. Third-party integrations, vendoring, and derivative works are permitted under the Apache-2.0 terms; please preserve the NOTICE file's attribution when redistributing.

Copyright 2026 Leonardo Cardozo Vargas.

---

## Acknowledgements

- The spec protocol draws from practical cross-review sessions run 2026-04 between Claude Code (caller) and ChatGPT Codex (peer), later extended to include Gemini CLI via Google One AI Ultra oauth-personal.
- The tri-tool mandate (ultrathink + code-reasoning + cross-review) is the defense-in-depth backbone: structured sequential reasoning + structured code reasoning + structured peer review together reduce the hallucination surface below any single tool's baseline.

## Links

- Spec: [`docs/workflow-spec.md`](./docs/workflow-spec.md)
- Release history: [`CHANGELOG.md`](./CHANGELOG.md)
- Security: [`SECURITY.md`](./SECURITY.md)
- Agents contract: [`AGENTS.md`](./AGENTS.md)
- pt-BR README (historical): [`README.pt-BR.md`](./README.pt-BR.md)
