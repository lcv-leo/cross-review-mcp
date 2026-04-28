# Cross-Review MCP Workflow Specification v4.14

**Status**: v4.11 is a SPEC-ONLY revision of v4.10 (no code change, no
version bump). Shipped 2026-04-24 as a small amendment to §6.11 closing
the "Claude CLI stderr banner parsing" follow-up that was registered in
v4.10 as deferred to v0.8+. The follow-up is resolved as a NEGATIVE
empirical result: Claude CLI 2.1.119 does not emit a banner-equivalent
on stderr. v4.11 touches NO code; the v0.7.0-alpha runtime (commit
ae3df46 + 19974ee + 8300e0e) correctly handles the no-banner case via
the existing §6.11 skip-only discipline. Predecessors: v4.10
implementation-ratified with code release v0.7.0-alpha (2026-04-24);
v4.9 trilaterally approved in session c9508617 (2026-04-24, 3/3 READY). Predecessors: v2 (session 7d745f38);
v3 (session 806a1c4f); v4 normative absorbing v0.4.0-alpha (session
08cd61e6); v4.1 spec-only absorbing section 6.6 (session a847f897);
v4.2 spec-only promoting section 6.7 (session f1fdbee4); v4.3 adding
section 6.9.2.1 advisory drift audit (session 9c56005b); v4.4
suspending schema v5 per YAGNI (session bd8c3cfb); v4.5 formalizing
the em-revalidacao to aprovada pattern (session 843d57eb); v4.6
language policy section 6.10 (session b1700438); v4.7 triangular
topology additive extension (session 4b799098, bilateral-approved,
commit 3f89435).

Encoding: ASCII-only with transliteration of Portuguese accents where
they appear (see section 6.4). Peer exchange and non-user-facing
artifacts are authored in en-US (see section 6.10), trivially
satisfying ASCII-only without transliteration.

---

## 0n. Delta v4.13 -> v4.14 (executive summary)

**Single normative addition driven by field-evidence regression: §6.20
dynamic caller resolution.** Operator observed that Gemini-initiated
sessions on a cross-review-mcp instance configured with
`CROSS_REVIEW_CALLER=claude` were recording `meta.caller: 'claude'` —
the env-var was overriding actual caller identity. The audit
distribution skew (claude 78% / codex 20% / gemini 2%) was therefore
partially artificial: gemini-initiated sessions were being mis-attributed
to claude.

§6.20 (NEW in v4.14, simplified to two tiers in v1.2.12):
**Per-session caller resolution.** `session_init` resolves the caller
dynamically with precedence:
  1. `args.caller` (explicit override) — wins if valid.
  2. MCP `clientInfo.name` from initialize, substring-mapped to agent
     (`claude` → claude, `gemini` → gemini, `codex` → codex).

If neither tier resolves to a valid agent, `session_init` throws a
per-call error (NOT a startup crash). The resolved caller is recorded
in `meta.caller` and a new `meta.caller_resolution = { source,
client_info_name }` audit field records HOW it was resolved (`source`
is `"arg"` or `"client_info"`). Peers are computed dynamically
(`peersForCaller(meta.caller)`) and stored in `meta.peers`. `ask_peer`
and `ask_peers` read caller and peers from meta (NOT global
constants) — so a session opened by gemini against a host with no
env-var configuration correctly records gemini and spawns
[claude, codex] peers.

The pre-v1.2.12 third tier (`CROSS_REVIEW_CALLER` env var as legacy
fallback) was removed in v1.2.12 because operator-configured fallback
defeated the dynamic-caller principle and produced "lying logs"
(server affirmed `caller=X` while the actual session was driven by
agent Y). v1.2.12 also removed a startup-time hard-fail that was
making the env var a de-facto requirement, contradicting its
documented "fallback" status. Hosts with stale `CROSS_REVIEW_CALLER`
in their MCP config see a one-shot startup deprecation notice and the
env var is otherwise ignored.

**Anti-drift smoke step.** v1.0.4/v1.0.5 shipped without README sync
(operator noticed READMEs stuck at v1.0.3 while three releases had
landed). v1.2.0 adds a smoke step that asserts README's
"Current release: vX.Y.Z" line matches `server.VERSION`, and the
spec banner version is mentioned in README. Future releases that
forget to update README fail the smoke gate.

The spec is otherwise unchanged. v4.13's §6.17/§6.18/§6.19 remain
canonical. v4.12's §6.16 prompt-flag recovery contract remains
canonical.

---

## 0m. Delta v4.12 -> v4.13 (executive summary)

**Three normative additions, all driven by the 60-session audit shipped
in v1.0.5 (`docs/session-audit-2026-04-26.md`).** The audit catalogued
four follow-ups (FU-1..FU-4); v1.1.0 ships all four together with this
spec evolution.

§6.17 (NEW): **Spec-version persistence in `meta.json`.** Every session
now records the spec version active at `session_init` time
(`meta.spec_version`), so post-hoc audits can determine which spec
rules were in force when a given session ran. Resolves audit §2.4.

§6.18 (NEW): **Long-idle session reconciliation + structured
`outcome_reason`.** New `session_sweep` tool finalizes long-idle
sessions with `outcome: 'aborted'` + `outcome_reason: 'stale'`. Adds
optional `outcome_reason` field to `session_finalize` for structured
"why" tracking (conventions: `'stale'`, `'peer_scope_creep'`,
`'moderation_flag_unresolved'`, `'operator_abort'`). Resolves audit
§2.2.

§6.19 (NEW): **Convergence-health hint per round.** New advisory field
`convergence_health` (`'normal' | 'extended' | 'concerning'`) on every
`ask_peer` and `ask_peers` response. Persisted into
`round.convergence_health`. Spec defines the contract; implementation
chooses thresholds (v1.1.0 canonical: `extended` at rounds≥6,
`concerning` at rounds≥8). Purely advisory: no automatic
status/outcome change. Resolves audit §2.3.

**FU-2 closure.** Audit §2.5 (chatgpt-pro-backend bypass invariant)
landed as a smoke step in v1.1.0 (`v4.13 §2.5 closure: chatgpt-pro-backend
bypass invariant across mismatch shapes`) — no spec section, since it
is a test enforcing existing §6.11 behavior, not a new contract.

The spec is otherwise unchanged. v4.12's §6.16 prompt-flag recovery
contract remains canonical. v4.11's transport-aware bypass (§6.11),
strict-only convergence (§6.12), rate-limit class (§6.13),
anti-hallucination discipline (§6.14), and CLI banner amendment all
remain canonical.

---

## 0l. Delta v4.11 -> v4.12 (executive summary)

**Single normative addition: §6.16 prompt-flag recovery contract.** Field
evidence from three sessions in 2026-04-24 (`6cf09af3`, `70d1d349`,
`fca13b80`) showed OpenAI Codex on reasoning models (gpt-5 family)
rejecting prompts with `your prompt was flagged as potentially violating
our usage policy`. The runtime classified these as generic
`spawn_rejected`, the session outcome went to `aborted`, and the codex
contribution was lost for the round. The technical content of the
flagged prompts was benign engineering prose; the trigger was the
combination of charged words ("adversarial", "exploit") with
model-introspection language reading as jailbreak/circumvention to the
classifier.

§6.16 adds:
- New `failure_class: 'prompt_flagged_by_moderation'` (distinct from
  `spawn_rejected` and `rate_limit_induced_response`).
- New `recovery_hint: 'reformulate_and_retry'` (parallel to
  `wait_and_retry` for rate-limits).
- A new lexeme list `PROMPT_FLAG_LEXEMES` and detector
  `detectPromptModerationFlag` in `peer-spawn.js`.
- Embedded `reformulation_advice` in the tool response.
- A canonical reformulation guide.
- A binding caller obligation: reformulate and retry up to 5 attempts;
  do NOT abort on a moderation flag.

The spec is otherwise unchanged. v4.11's transport-aware bypass (§6.11),
strict-only convergence (§6.12), rate-limit class (§6.13),
anti-hallucination discipline (§6.14), and CLI banner amendment all
remain canonical.

---

## 0k. Delta v4.10 -> v4.11 (executive summary)

- **Section 6.11 amendment UPDATED** — Claude CLI stderr banner
  parsing follow-up (registered in v4.10 as deferred to v0.8+) is
  resolved NEGATIVELY. Empirical survey 2026-04-24 against Claude
  CLI 2.1.119 with three probe variants (production-flag-tree valid
  model, `--verbose` diagnostic, invalid-model-error path) shows the
  CLI emits 0 bytes on stderr in every case. There is no
  banner-equivalent to extract. The §6.11 skip-only discipline
  applies to Claude unchanged; banner attestation remains
  Codex-specific in practice, not just in v0.7.0-alpha. The
  "deferred to v0.8+" follow-up is CLOSED.
- **Section 8** gains v4.11 entry per the v4.5 preamble rule.

v4.11 is spec-only. No code change. The v0.7.0-alpha runtime already
implements the correct behavior (Claude falls through to §6.11
`model_check_skipped` path because `cli_attested_model_raw` from
`extractCodexAttestedModelRaw` is Codex-gated and returns null for
Claude CLI invocations — the gate in `parsePeerOutputs` never sees a
banner string for Claude, so the §6.11 skip path fires naturally).
No test coverage changes needed; existing 117 smoke steps already
exercise this path implicitly via `driveV7BannerAttestationUnit`'s
"no banner → §6.11 skip path unchanged" assertion.

---

## 0j. Delta v4.9 -> v4.10 (executive summary)

- **Section 6.14 NEW — Anti-hallucination / epistemic discipline
  (Item D).** Peer prompt tail directive extended with mandatory
  NEEDS_EVIDENCE-first + exhaustive-search language. Structured
  status block accepts two optional fields: `confidence: 'verified' |
  'inferred' | 'unknown'` and `evidence_sources: [string]`. Hard-pair
  rule: `confidence='unknown'` MUST pair with `status='NEEDS_EVIDENCE'`
  — violating the pairing emits a parser warning. `confidence='verified'`
  SHOULD include at least one `evidence_sources` entry (advisory warning
  when empty). New MCP tool `escalate_to_operator(session_id, question,
  context)` persists operator-escalation requests under
  `meta.escalations[]`; the caller orchestrator surfaces the question
  via chat (the tool does NOT auto-dispatch).
- **Section 6.11 AMENDED — Item E: CLI banner as authoritative
  attestation.** For cli-subscription transports when the CLI stderr
  banner is parseable (Codex CLI `model: <id>` line; Claude CLI
  deferred to v0.8+), the banner is promoted from forensic-only
  (v4.9) to AUTHORITATIVE attestation. A parseable banner that
  MATCHES the pinned `peer_model` elevates the audit record with
  `cli_banner_attested: true`; a parseable banner that MISMATCHES
  is a hard gate — `model_failure_class: 'cli_banner_attestation_mismatch'`
  with `protocol_violation=true`. Absent/unparseable banner
  falls through to §6.11's unchanged `model_check_skipped` path.
  The banner attestation is confined to cli-subscription; oauth-personal
  (Gemini via v1internal) has no banner equivalent and continues on
  the §6.11 skip discipline.
- **Section 7 summary table** extended with anti-hallucination row.
- **Section 8** gains v4.10 entry per the v4.5 preamble rule.

All v4.10 changes ship integrated with code release v0.7.0-alpha in a
single commit. Items D and E were already ratified as deferred scope
in session c9508617 (v4.9 approved design); v4.10 executes the
implementation without a new design session per operator directive
2026-04-24.

---

## 0i. Delta v4.8 -> v4.9 (executive summary)

- **Section 6.11 NEW** — Transport-aware model-check discipline (Item A).
  `parsePeerOutputs` gate on `authoritativeModelAttestationAvailable`
  (equivalently `transport_descriptor.auth === 'api-key'`). When the
  gate is false (`cli-subscription` / `oauth-personal`), the sibling
  `classifyModelMatch` check is SKIPPED; the round record carries
  `model_check_skipped: { reason: 'unreliable_text_self_report_on_cli',
  auth, endpoint_class }` instead of a false-positive
  `silent_model_downgrade` flag. `model_failure_class` stays null for
  bypass rounds. The defense is opt-in by transport, not removed:
  future api-key transports continue to run the check.
- **Section 6.12 NEW** — Strict-only convergence with persisted
  `convergence_snapshot` (Item B). Predicate normativo: `converged iff
  caller_status === 'READY' AND every p in round.peers has p.peer_status
  === 'READY'`. `status_missing` counts AGAINST. `appendRound` computes
  and persists `round.convergence_snapshot` with `spec_version: 'v4.9'`
  at append time; `checkConvergence` reads the persisted snapshot
  (audit immutability under future predicate evolution). No
  "loose-mode" toggle.
- **Section 6.13 NEW** — Rate-limit class distinct from
  silent-downgrade (Item C). New class `rate_limit_induced_response`
  orthogonal to `silent_model_downgrade`. Provider-shaped lexeme set:
  `{429, rate limit, usage limit, quota exceeded, insufficient_quota,
  RESOURCE_EXHAUSTED, Retry-After}`. Generic `{rate, quota, limit}`
  EXPLICITLY excluded. Spawn-level detection on non-zero exit +
  stderr lexeme match → `saveFailedAttempt` with `failure_class =
  'rate_limit_induced_response'` + `retry_after_seconds` + `detection_source`.
  Response-level detection requires ALL THREE: status block absent,
  body < 200 chars, provider-shaped lexeme present. `ask_peers` +
  `ask_peer` response envelopes surface `rate_limited_peers[]`.
  `retry_after_seconds` parsed from `Retry-After: N` when present,
  `null` when absent (never fabricated).
- **Section 6.9.3.4 CLARIFIED** — probe `tier` now takes canonical
  values `ok | offline` only; `fallback` retired as ambiguous. Under
  Item A bypass a responded cli-subscription/oauth-personal peer is
  `tier: 'ok'` with `model_check_skipped` set.
- **Section 7 summary table** updated with two new rows
  (transport-aware bypass + strict-only convergence with persisted
  snapshot + rate-limit class).
- **Section 8** gains v4.9 entry per the v4.5 preamble rule.

Deferred to v0.7+ / v4.10 per operator directive 2026-04-24:
anti-hallucination safeguards (NEEDS_EVIDENCE discipline + exhaustive
search + `evidence_sources` audit trail), open-source readiness
(LICENSE / README / SECURITY / CODE_OF_CONDUCT), CLI stderr banner
promoted from forensic-only to authoritative attestation.

All v4.9 changes ship integrated with code release v0.6.0-alpha in a
single session (session c9508617 design + subsequent implementation).
Predecessor design sessions: F2 v0.5.0-alpha release (2492e99) +
v0.5.0-alpha.1 Gemini pin (67e5138) under Google One AI Ultra.

---

## 0h. Delta v4.7 -> v4.8 (executive summary)

- **Section 6.9.3 NEW** with six subsections:
  - **6.9.3.1 Pre-session capability probe**: minimal CLI invocation
    per canonical agent at `session_init`; probes run in parallel
    across providers; the walk over each provider's `fallback_chain`
    is sequential. Deterministic failure classes defined
    (unreachable_with_pinned_id, response_timeout,
    spawn_error_or_cli_missing, auth_or_permission_denied, other).
    Tool-use-not-verified is a capability note, not a failure.
  - **6.9.3.2 Fallback chain in top-models.json**: per-provider
    `fallback_chain` ordered array of model ids, minimum length 1,
    with invariant `fallback_chain[0] === id`. This is `session_init`
    probe input (NEW runtime role for top-models.json since v4.3).
  - **6.9.3.3 Graceful degradation rules**: triangular session when
    at least 2 peers are viable; bilateral when exactly 1 peer is
    viable; session aborts at init when 0 peers are viable. Mid-
    session peer failure does NOT trigger fallback walk.
  - **6.9.3.4 Session-level `meta.capability_snapshot`** recording
    probe outcomes; `rounds[i].peers[]` contains only active peers
    (never excluded); active-peer records carry
    `peer_capability_tier` ("top" | "fallback").
  - **6.9.3.5 Interaction with section 6.9.2.1**: `id` remains
    advisory (drift-gated); `fallback_chain` is runtime probe input
    (not drift-gated). Dual role formalized.
  - **6.9.3.6 Resilience to transient provider failures (NEW scope
    D4/D5, absorbed mid-session)**: mid-round treatment for
    `prompt_flagged_by_provider`, `rate_limit_exceeded`, and
    `provider_error_transient` (outage/overload/5xx) classes.
    Same-model retry-once with back-off allowed; server-side
    auto-rephrase of flagged prompts prohibited (surfaced to caller
    for judgment); silent model switch mid-round prohibited
    (section 6.9.2 rule preserved); peers NOT excluded mid-round on
    transient failure. New `transient_failure` response field plus
    `attempts` array under `rounds[i].peers[j]` for audit. Clients
    MUST distinguish parse-null (protocol violation) from
    transient-null (transient failure) by checking
    `transient_failure != null`. Cross-reference to 6.9.1 for
    non-stop handling of mandatory local reasoning dependencies
    (ultrathink / code-reasoning); the two domains are NOT
    conflated.
- **Section 6.9.2 CLARIFIED** (small added paragraph): "NO silent
  fallback" scope is explicitly mid-round; pre-session adaptive
  path under 6.9.3 is audited, not silent.
- **Section 7 summary table** updated with a new Tier resilience
  row.
- **Section 8** gains v4.8 entry per the v4.5 preamble rule.
- **`docs/top-models.json`** schema extends to `schema_version: 2`
  with per-provider `fallback_chain` field (F2 populates concrete
  model ids; description text updated to reflect dual role).

All v4.8 changes are policy/documentation. No programmatic contract
was altered in this session.

---

## 0g. Delta v4.6 -> v4.7 (executive summary)

- **Section 2.7 NEW**: triangular topology. Caller broadcasts to two
  peers; peers respond to caller only within a round; cross-session
  caller rotation exercises all K3 directed edges. Topology alpha is
  normative; beta (peer-to-peer cross-talk within a round) is a
  deferred follow-up; gamma (full mesh simultaneous) is rejected.
- **Section 2.8 NEW**: dynamic role assignment. Caller is whoever
  opened the session (resolved per call via `args.caller` >
  `clientInfo.name` mapping; the legacy `CROSS_REVIEW_CALLER` env-var
  fallback was retired in v1.2.12 — see §6.20); peers are computed as
  all canonical ids except caller. No hardcoded default initiator.
- **Section 5.1 NEW sub-block**: display names vs canonical ids.
  External-facing identity prose SHOULD use display names ("Claude
  Code", "ChatGPT Codex", "Gemini") where naming an agent as a
  conversational participant; internal fields MUST use canonical ids
  (claude, codex, gemini). Canonical ids remain valid in prompts when
  discussing config values or code literals.
- **Section 6.3 UPDATED**: convergence generalizes to N-ary unanimity
  (`caller_status === READY && peers.every(p => p.status === READY)`).
  No partial-convergence option. Per-peer failure (rate limit, CLI
  error, timeout) is recorded independently; unanimity is not achieved;
  successful peer responses are not discarded.
- **Section 6.9.2 UPDATED**: add Gemini top-tier ID pin
  `gemini-3.1-pro-preview` (preview state per Google docs as of
  2026-04-22; aligns with section 6.9.2 precedent of pinning full IDs,
  not aliases; future GA rename to `gemini-3.1-pro` will trigger a
  spec micro-bump). Codex continues at `gpt-5.5` with `xhigh` reasoning;
  Claude continues at `claude-opus-4-7`. Both `ask_peer` (legacy
  bilateral) and `ask_peers` (N-ary) invoke peers with explicit model
  flags.

All v4.7 changes are policy/documentation. No programmatic contract
was altered in this session; code will continue in v0.4.0-alpha until
a separate session (F2) delivers v0.5.0-alpha.

---

## 0f. Delta v4.5 -> v4.6 (executive summary)

- **Section 6.10 NEW**: language policy for peer exchange and internal
  artifacts. All cross-review peer exchange and non-user-facing project
  artifacts MUST be en-US from v4.6 onward; user-facing content
  (assistant chat to user + historically sealed section 8 entries
  v4-v4.5) MAY remain pt-BR. Clause authorizes bulk translation of
  existing pt-BR non-user-facing content without per-artifact
  cross-review.
- **Section 7 row "Encoding" updated**: references section 6.10.
- **Section 8 entry added**: v4.6 sealed bilaterally in session b1700438
  (5 rounds).

All v4.6 changes are policy/documentation. No programmatic contract was
altered.

---

## 0e. Delta v4.4 -> v4.5 (executive summary)

- **Section 8 preamble added (editorial normative rule)**: formalizes
  the "em revalidacao bilateral during session; aprovada bilateral
  only post-READY bilateral" pattern previously applied de facto in
  v4.1, v4.2, v4.3 but skipped in v4.4. Non-retroactive rule.
- **Section 8 entry for v4.5 written self-demonstratively**: initially
  "em revalidacao bilateral" during the session, promoted to "aprovada
  bilateralmente" in a separate post-sealing edit; both edits composed
  in the commit that introduces the rule.

All v4.5 changes are policy/documentation.

---

## 0d. Delta v4.3 -> v4.4 (executive summary)

- **Section 8 follow-up rewritten**: the original follow-up "Section
  2.3.1: reconsideration of caller_requests/follow_ups as arrays of
  objects" is replaced with explicit YAGNI suspension + objective
  reopening criterion (a v4-era peer must name ONE concrete
  caller_request that FAILED due to string limitation). Test coverage
  for current drop behavior already exists via
  STRUCTURED_V4_NON_STRING_ITEM smoke case.

All v4.4 changes are policy/documentation.

---

## 0c. Delta v4.2 -> v4.3 (executive summary)

- **Section 6.9.2.1 NEW (normative)**: model drift audit as an
  advisory-only mechanism. Companion tooling (docs/top-models.json +
  scripts/audit-model-drift.js + npm script `check-models`) added as a
  fourth layer of auditability on top of the three existing layers
  (pinned IDs in peer-spawn.js + peer_model persisted per round +
  section 6.9.2 bump-forced change process). Clause does NOT authorize
  silent fallback, config/env override, automatic selection, or
  bump-less ID change.
- **Section 7 row "Model" updated**: references the drift-audit script.

Runtime unchanged: `peer-spawn.js` immutable. v4.3 introduces tooling
without modifying the MCP server itself.

---

## 0b. Delta v4.1 -> v4.2 (executive summary)

- **Section 6.7 PROMOTED FROM FOLLOW-UP TO NORMATIVE**: minimal
  evidence matrix per artifact class in tabular form, covering classes
  empirically observed in historical sessions (JS, TS, JSON, Markdown,
  cross-review-mcp itself). Normative link with section 3: peers use
  the matrix as a baseline when deciding NEEDS_EVIDENCE. "Class not
  listed" rule as documented fallback. `wrangler deploy --dry-run`
  removed (see `feedback_no_wrangler_deploy`: deploy verification is a
  CI/GHA responsibility, not a pre-ask_peer gate).
- **Section 8 adjusted**: records bilateral approval of session
  f1fdbee4.

All v4.2 changes are policy/documentation. No programmatic contract was
altered.

---

## 0a. Delta v4 -> v4.1 (executive summary)

- **Section 6.5 SOFTENED**: ledger wording moves from mandatory
  ("maintain") to optional ("may maintain"; "When adopted...") to match
  empirical non-adoption (audit 2026-04-24: no `ledger.md` in
  `~/.cross-review/`).
- **Section 6.6 PROMOTED FROM FOLLOW-UP TO NORMATIVE**: normative
  contract with concrete thresholds and mandatory compression order,
  split into 4 subsections: 6.6.1 Transcript, 6.6.2 Ledger,
  6.6.3 meta.json, 6.6.4 Non-destructive compression.
- **Section 7 adjusted**: ledger line softened for coherence with
  section 6.5; new "Overflow" line with pointers to section 6.6.
- **Section 8 adjusted**: acceptance criteria record bilateral approval
  of session a847f897.

All v4.1 changes are policy/documentation. No programmatic contract
(MCP tools, block format, payload schema, on-disk session-store layout)
was altered. Any reader inferring a need to bump the server due to v4.1
is mistaken.

---

## 0. Delta v3 -> v4 (executive summary)

- **Section 2.3.1 NEW**: expanded JSON schema for the structured block.
  Optional fields `uncertainty`, `caller_requests`, `follow_ups`
  per-field validated; invalid fields are DROPPED with a warning
  without failing the block; fields outside the whitelist are dropped
  with a warning. Normative rule `omit-unless-signal`. Limits: <=20
  items per array, <=500 chars per item.
- **Section 5 UPDATED**: the set consumed by the caller expanded with
  `parser_warnings` and `peer_model`.
- **Section 6.8 REWRITTEN**: previously a FOLLOW-UP, now IMPLEMENTED in
  v0.4.0-alpha (section 2.3.1).
- **Section 6.9 NEW (operational normative)**: 6.9.1 Mandatory tri-tool
  (cross-review + ultrathink + code-reasoning) and 6.9.2 Top-level
  model (peer invoked with specific IDs at each release; audited via
  `peer_model`).

---

## 0-legacy. Delta v2 -> v3 (executive summary, preserved for traceability)

- **Section 2.1 rewritten**: STATUS contract anchored exclusively on
  the response tail / last non-empty line. Removed global regex scan.
  Added `NEEDS_EVIDENCE` to the enum.
- **Section 2.2 NEW**: positional anchor ("whatever is at the end
  wins"); replaces the implicit "structured wins over regex" rule from
  v2.
- **Section 2.3 PROMOTED from FOLLOW-UP to IMPLEMENTED**: STATUS in
  structured field `<cross_review_status>{...}</cross_review_status>`
  as the preferred form. Implemented in v0.3.0-alpha.
- **Section 2.4 NEW**: failure contract for the structured block --
  malformed JSON or status outside the enum returns `null` without
  falling through to the regex fallback.
- **Section 2.6 NEW**: interaction with an orchestrator in mixed
  version during the upgrade window.
- **Section 3.3 ADJUSTED**: CALLER_REQUEST must accompany status
  `NEEDS_EVIDENCE` (not `NOT_READY`).
- **Section 3.5 NEW**: operational acknowledgement of peer sandbox with
  blocked hash/node exec (validation via direct reading).
- **Section 5 UPDATED**: the set consumed by the caller expanded to
  include `peer_structured` and `status_source` in addition to
  `content` and `peer_status`.
- **Section 6.3 rewritten**: `NEEDS_EVIDENCE` promoted from FOLLOW-UP
  to canonical peer-only state. Caller remains restricted to
  `READY|NOT_READY`.
- **Section 6.4 ADJUSTED**: made explicit that the ASCII-only rule
  also applies to pre-existing files promoted to review artifact.
- **Section 6.6 (overflow) no change** (non-blocking FOLLOW-UP).
- **Section 6.7 UPDATED**: minimal evidence matrix now cites
  `vitest/test script` generic (instead of `vitest` specific) and adds
  an entry for `cross-review-mcp` itself (= `npm test`).
- **Section 6.8 NEW**: FOLLOW-UP for the expanded JSON schema of the
  structured block (v0.4.0+).

---

## 1. Session-opening contracts

### 1.1 Mandatory artifacts in session_init
- Files under review: absolute paths.
- Transcript (when there is relevant caller-user context): single file at
  a temp path, ASCII-only.

### 1.2 Transcript - agreed hybrid format
The transcript should NOT be pure verbatim nor pure synthesis. Hybrid
format:

- Structured opening (short): goal of this session, scope, question of
  this round, caller's current status.
- User directives that change behavior: verbatim, only the normative
  ones (coaching feedback, priority shifts, operational constraints).
  Transliterate accents if any; preserve meaning.
- Per-round summarized timeline from prior sessions: 1-3 lines per
  round with finding, response, state reason.
- Artifact table: path, fingerprint (SHA-256), whether it changed
  since the prior round.
- Evidence block: commands run by the caller, relevant outputs,
  validity flag (if the artifact changed since the command, the output
  is stale).
- "Open questions / request to peer" block with expected answers.
- Verbatim appendix: only for contentious or semantically sensitive
  excerpts, always ASCII-only.

Optimal size: dense main body of 1-3 thousand words, optional verbatim
appendix. Full verbatim only on the first handoff of a complex session
or when there is a semantic dispute.

### 1.3 Mandatory scope clause
The first prompt must contain a "Scope contract" section enumerating:
- Session target (what is being reviewed/decided).
- What is INSIDE scope.
- What stays OUTSIDE scope (migrates to FOLLOW-UP without blocking
  READY).

---

## 2. STATUS protocol

### 2.1 Peer format contract (REWRITTEN in v3)

The parser inspects ONLY the response tail. Mentions of `STATUS: X` or
`</cross_review_status>` inside prior prose do NOT trigger detection.

In order of attempt:

1. **Structured block (preferred)**: if the tail (ignoring trailing
   whitespace) ends with the literal sequence
   `</cross_review_status>`, the parser locates the
   `<cross_review_status>` immediately to the left, extracts the
   intermediate content, applies `trim()` and `JSON.parse()`. The
   payload MUST be a JSON object with field `status` whose value is in
   `{READY, NOT_READY, NEEDS_EVIDENCE}`. The payload accepts multi-line
   and pretty-printing as long as the closing tag is the last non-blank
   sequence of the text.

2. **Legacy fallback (backwards-compat)**: only when path (1) does not
   fire, the parser isolates the LAST NON-EMPTY LINE of the text,
   applies `trim()`, and requires the EXACT case-sensitive regex
   `^STATUS: (READY|NOT_READY|NEEDS_EVIDENCE)$`.

3. **No match**: returns `{status: null, structured: null, source: null}`.
   Caller treats as `protocol_violation` and may invoke a
   "FORMAT-ONLY" round requesting re-emission.

Output exposed to caller: `status` (string | null), `structured` (parsed
JSON object when path 1 won, else null), `source` (`'structured'` |
`'regex'` | `null`).

### 2.2 Positional anchor (NEW in v3)

Precedence between the two formats is **by position, not by format**. If
the peer emits a structured block mid-body but ends with a legacy
`STATUS: X` line, path (2) wins because the legacy line is the last
non-empty line. Conversely, if the peer emits `STATUS: X` mid-body but
ends with a valid structured block, path (1) wins because the tail ends
with the closing tag.

Motivation: removes the previous "structured wins over regex" rule that
was ambiguous in mixed texts. Both paths are position-anchored; the
contract is "whatever is at the END wins".

### 2.3 Structured STATUS -- IMPLEMENTED in v0.3.0-alpha

This section is no longer a FOLLOW-UP. The MCP now accepts the
structured block as the preferred form, per section 2.1 path (1).
Implementation reference: `src/lib/status-parser.js`.

Since v0.3.0-alpha, the JSON payload accepted only `status`. In
v0.4.0-alpha (section 2.3.1), the payload was expanded with validated
optional fields.

### 2.3.1 Expanded payload schema (NEW in v4, implemented in v0.4.0-alpha)

The JSON payload of the structured block now accepts three OPTIONAL
fields in addition to `status`:

```
{
  "status": "READY" | "NOT_READY" | "NEEDS_EVIDENCE",          // required
  "uncertainty": "low" | "medium" | "high",                    // optional
  "caller_requests": ["string", ...],                          // optional
  "follow_ups": ["string", ...]                                // optional
}
```

Size limits (parser invariants):
- `caller_requests` and `follow_ups`: ARRAYS of strings, maximum 20
  items, each item at most 500 chars.
- `uncertainty`: string in enum `{low, medium, high}`.

Deterministic per-field validation (check order):
1. shape (array vs non-array; string vs non-string).
2. count (array items).
3. item type (string vs non-string).
4. item length (chars per string).

If any rule fails, the entire field is DROPPED from `peer_structured`
and ONE warning per rejected field is added to `parser_warnings` (a
human-readable string identifying the field and the violated rule, with
index/size when applicable). An invalid optional field does NOT
invalidate the entire block -- `peer_status` preserves the `status`
value when it is valid.

An empty array (`[]`) is normalized to ABSENCE of the field in
`peer_structured`, without a warning. Explicit semantic equivalence:
absent field === empty array.

Fields outside the whitelist (`status`, `uncertainty`, `caller_requests`,
`follow_ups`) are DROPPED from `peer_structured` and each occurrence
generates a warning `unknown field 'X' ignored`. Future schema extension
requires an explicit release + spec bump (silent field addition is a
contract violation).

Normative rule `omit-unless-signal`: peers MUST omit optional fields by
default; emit only when the value actually changes the reading of the
parecer. Default-padding (e.g. `uncertainty: "medium"` without real
meaning) is an operational contract violation. Validated by textual
coherence of the response body, not automatically by the parser.

Semantics by `status x optional field` pairing:
- `caller_requests` with `NEEDS_EVIDENCE`: primary expected use.
  Structured list of requests to the caller.
- `caller_requests` with `READY` or `NOT_READY`: allowed but
  interpreted as non-blocking nice-to-have. Caller may act or ignore.
- `follow_ups` with `READY`: primary expected use. Items agreed for a
  future session; explicit "closed with agreed debt" signal.
- `follow_ups` with `NOT_READY` or `NEEDS_EVIDENCE`: allowed, does not
  block this session's flow.
- `uncertainty` with any status: informative; does NOT affect
  convergence nor `peer_status`.

Backwards compatibility: pure v3 block `{"status":"X"}` remains valid in
v4. Passes through the same codepath with `parser_warnings: []` and
`peer_structured = {status: "X"}`.

### 2.4 Silent failure of the structured block (NEW in v3)

If the tail ends with `</cross_review_status>` but:
- the opening tag `<cross_review_status>` is absent, OR
- the payload is not valid JSON, OR
- the JSON parses but is not an object, OR
- the `status` field does not exist / is not a string / is outside the
  enum,

then the parser returns `{status: null, structured: null, source: null}`.
**There is NO fallback to the regex** in this case, because the last
non-empty line is the closing tag, which does not match `^STATUS: X$`.
This is intentional: a structured block emitted by the peer is an
explicit declaration of use of the new contract; silently failing it
would fall through to the regex and mask a protocol error. A fallback
on that path would reopen the ambiguity that motivated the rewrite of
section 2.1.

### 2.5 Fallback on format violation

If `status: null` (either path 1 or 2 failed):
- Caller sends a minimalist "FORMAT-ONLY" round requesting re-emission
  of the status.
- Keeps the previous round's technical content valid -- does not repeat
  the analysis.

### 2.6 Interaction with mixed-version orchestrator

If the running orchestrator has not been restarted after a server
upgrade and runs the old parser version (v0.2.0-alpha: only the
`STATUS: X` regex), a peer that emits ONLY the structured block will
have `peer_status: null` + `protocol_violation: true` recorded in
meta.json, even though the content is correct. Mitigation during
transition windows: the peer emits **both** formats (structured block
in an earlier position + legacy `STATUS: X` line as TAIL). This
satisfies the old parser (via path 2) and the new parser (via path 2
too -- because the TAIL is the legacy line). After the orchestrator
reload, the peer may return to emitting only the structured block.

### 2.7 Triangular topology (NEW in v4.7)

The cross-review orchestrator extends from bilateral (Claude Code <->
ChatGPT Codex, two agents) to triangular (Claude Code + ChatGPT Codex
+ Gemini, three agents). The extension is ADDITIVE:

- Tool `ask_peer` (singular) remains in the server surface as the
  bilateral contract. It preserves the v0.4.0-alpha bilateral contract
  and legacy schema behavior: caller selects one peer derived from
  the resolved per-session `meta.caller` (set at session_init via the
  precedence chain in §6.20); one peer is spawned; one round is
  recorded per call with fields `peer`, `peer_status`, etc.
- Tool `ask_peers` (plural) is new as of v0.5.0-alpha. Caller
  broadcasts the same prompt to all other canonical agents. Each
  peer's response is parsed independently. The round records a
  `peers` array with one entry per peer.

Topologies (definitions):

- **Alpha (NORMATIVE)**: caller broadcasts to peers; peers respond to
  caller only. Peers do not see each other's responses within a round.
  "All communicate in all directions" is satisfied by caller rotation
  across sessions (in session A Claude Code is caller; in session B
  ChatGPT Codex is caller; in session C Gemini is caller; over time
  every directed edge of K3 is exercised).
- **Beta (DEFERRED follow-up)**: alpha + within-round peer-to-peer
  cross-talk (peer A can read peer B's response before finalizing its
  own status). Reopening criterion: a concrete case where a peer's
  analysis materially depends on another peer's response and the
  alpha workflow cannot express it.
- **Gamma (REJECTED)**: full mesh simultaneous (any agent can invoke
  any other at any time, no round structure). Rejected because it
  loses the disciplined round-based convergence that makes
  cross-review rigorous.

Alpha is the only topology authorized by v4.7.

### 2.8 Dynamic role assignment (NEW in v4.7, simplified in v1.2.12)

Role assignment in any cross-review session is strictly dynamic:

- **Caller** is resolved per call at `session_init` time via the
  precedence chain defined in §6.20: `args.caller` (explicit override)
  > `clientInfo.name` from the MCP `initialize` handshake
  (substring-mapped to a canonical id). The caller is the AI model
  that actually invoked the tool, declared dynamically by that model
  per call — never via operator-configured global state.
- **Valid canonical ids** are `claude`, `codex`, `gemini`. If
  resolution fails (no `args.caller` and no recognizable
  `clientInfo.name`), `session_init` throws a per-call error naming
  the exhausted resolution sources; the server keeps running so other
  valid sessions can proceed.
- **Peers** are computed deterministically as all canonical ids
  except caller (`peersForCaller(meta.caller)`). For the v4.7
  triangle, peers is an array of two. The `ask_peers` tool broadcasts
  to this computed array, which is persisted in `meta.peers` at
  session_init.

**Pre-v1.2.12 contract — retired.** Pre-v1.2.12 the caller was
selected by the `CROSS_REVIEW_CALLER` env var, set by each MCP client
when launching the server. That contract was retired in v1.2.12 for
two reasons: (1) operator-configured fallback defeated the
dynamic-caller principle and produced "lying logs" (server affirmed
`caller=X` while the actual session was driven by agent Y); (2) the
runtime hard-failed at startup with exit code 1 if the env var was
unset, contradicting the env var's documented "fallback" status. See
§6.20 for the full rationale and migration path. Hosts with stale
env-var configs continue to work — the variable is read only to emit
a one-shot startup deprecation notice and is otherwise ignored.

Cross-reference: section 2.7 (topology) defines the vertex graph and
broadcast semantics; section 2.8 (this section) defines how a runtime
caller occupies one vertex and how the peer set is computed from the
remaining canonical ids. The two sections are complementary. §6.20
defines the normative resolution precedence in detail.

---

## 3. Tooling parity -- hybrid protocol (KEPT from v2)

### 3.1 Hard rule
Any factual assertion about DYNAMIC BEHAVIOR (parseable syntax, tests
passing, build compiling, type-checking, lint clean, runtime producing
output X) WITHOUT ATTACHED EVIDENCE must be treated by the peer as
UNVERIFIED.

### 3.2 Default caller behavior
Before each ask_peer, the caller runs the relevant validation matrix
and attaches the results to the prompt.

### 3.3 CALLER_REQUEST operational valve

If the peer identifies that it needs dynamic evidence not attached, it
responds with an explicit block:

```
CALLER_REQUEST:
- command: <exact cmd>
- purpose: <why I need it>
- acceptance criterion: <which output/exit_code/pattern I expect>
```

The caller, on the next round, executes as FIRST ACTION and attaches
raw output + verdict against the acceptance criterion.

**In v3**, the peer that emits `CALLER_REQUEST` MUST accompany the block
with status `NEEDS_EVIDENCE` (not `NOT_READY`), per section 6.3. The
semantics signal to the caller that the blockage is pending evidence,
not a technical disagreement.

### 3.4 Stale evidence

Every attached evidence includes the ARTIFACT FINGERPRINT at the command
moment. If the artifact changed since then (edit, overwrite), the
evidence is marked STALE and does not count as verified -- the caller
must rerun.

### 3.5 Peer sandbox limitation (OPERATIONAL OBSERVATION, NEW in v3)

In session 0e427278 round 4 the peer Codex reported:

> "Operational limitation: the sandbox blocked local recomputation of
>  SHA-256 (Get-FileHash, sha256sum, certutil and Node crypto), so I
>  validated via direct reading of the content and of the saved smoke
>  output."

It is normal for the peer to be unable to run hashes / node / git in
its own sandbox (read-only sandbox covers read but blocks exec of some
binaries). In that case, peer validation is via DIRECT READING of
artifact content. The caller must: (a) attach pre-computed dynamic
evidence (output + hash); (b) include absolute paths outside the peer's
cwd in the prompt if the code lives outside the workspace; (c) accept
READY based on content reading when the peer explicitly declares the
hash limitation, rather than requiring impossible recomputation.

---

## 4. FOLLOW-UP vs. blocker (KEPT from v2)

### 4.1 General rule
Out-of-scope finding becomes a FOLLOW-UP: in the response. Does NOT
block READY.

### 4.2 Exceptions (out-of-scope finding that DOES block)
- Invalidates the central conclusion of the current scope.
- Shows that the evidence used is obsolete or incorrect.
- Touches a security/compliance hard gate defined by the user.

### 4.3 FOLLOW-UP form

```
FOLLOW-UP: <short description>
- why: <reason>
- appropriate scope: <next session / isolated patch / documentation>
- urgency: <blocking by deadline | desirable | nice-to-have>
```

### 4.4 Honest non-convergence signaling

If the peer insists on NOT_READY over a residual that the caller
considers out-of-scope and incompatible:
- Caller opens an explicit scope-negotiation round.
- If no agreement is reached, session_finalize(outcome='aborted') --
  signals non-convergence instead of a false READY.

---

## 5. Noise (UPDATED in v4)

Caller consumes only `content`, `peer_status`, `peer_structured`,
`status_source`, `parser_warnings`, and `peer_model`. In v2, the set was
only `content` + `peer_status`; `peer_structured` and `status_source`
entered in v0.3.0-alpha; `parser_warnings` and `peer_model` entered in
v0.4.0-alpha.

Semantics of each field:
- `status_source === 'structured'` confirms that the peer honored the
  preferred contract (tail-anchored structured block).
- `peer_structured` is the validated JSON payload (v4: `status` +
  whitelist optional fields that passed validation); direct access
  without prose parsing.
- `parser_warnings` lists per-field parser rejections. The caller MUST
  inspect: warnings signal peer drift or schema violation -- ignoring
  turns `parser_warnings` into dead telemetry.
- `peer_model` audits which top-level model was actually invoked in the
  round. Session reviews check adherence to section 6.9.2.

`stderr_tail` remains transport telemetry, kept only for diagnostics of
the mechanism itself. No technical or formal decision is based on
stderr_tail.

#### 5.1 Display names vs canonical ids (NEW in v4.7)

External-facing identity prose (stderr logs emitted by the server;
`reason` strings returned by `session_check_convergence`; section 8
entries; CHANGELOG entries; report files under `docs/reports/`;
prompts that the caller addresses to peers within a round) SHOULD
use display names for agent identity where the text names the agent
as a conversational participant:

| Canonical id | Display name    |
|--------------|-----------------|
| claude       | Claude Code     |
| codex        | ChatGPT Codex   |
| gemini       | Gemini          |

Internal fields (values of `meta.caller` and `meta.peers[]`;
filename suffixes like `round-NN-peer-<id>.md`; meta.json schema
keys; variable names such as `peers[]`, `peer_model`, `peer_file`;
the `peer.name` field in round records; the `args.caller` parameter
of `session_init`) MUST use canonical ids (lowercase, no spaces).

Canonical ids may appear verbatim in prompts and external prose when
the text is discussing configuration values, schema fields, or code
literals (for example, `meta.caller === "gemini"` or
`args.caller: "claude"`). Display names apply to identity prose;
canonical ids apply to code/config literals; both may coexist in the
same document.

Rationale: in the triangular protocol, referring to a peer as "peer"
without qualification is ambiguous (two peers exist). Display names
disambiguate external identity prose; canonical ids preserve the
stable machine-readable schema. The convention changes no
programmatic contract.

---

## 6. Identified weak points

### 6.1 Artifact drift between rounds (KEPT from v2)

Problem: if a file changes between rounds and the peer is not notified,
it responds about an obsolete version.

Solution: the caller includes an ARTIFACTS block in each round's prompt:

```
ARTIFACTS:
- C:\Scripts\ai-sync.js | sha256:<hash> | changed_since_last_round: <yes|no>
```

The peer must re-read the artifact if `changed_since_last_round: yes`.

### 6.2 Stale evidence (subitem of 3.4) (KEPT from v2)

Absorbed in protocol P1 -- every evidence has a fingerprint + stale flag.

### 6.3 NEEDS_EVIDENCE state -- IMPLEMENTED in v0.3.0-alpha

**Canonical peer-only state.** Separates "I cannot conclude without
evidence" from "I technically disagree". The caller remains restricted
to `READY|NOT_READY` (the asymmetry is intentional: a caller without
evidence emits `NOT_READY` with `CALLER_REQUEST` for the peer --
symmetry would be redundant).

When the peer emits `NEEDS_EVIDENCE`:
- `session_check_convergence.converged` returns `false`.
- `reason` explicitly guides: "attach the requested evidence next round
  instead of re-arguing merits".
- The caller, in the next round, runs the commands from `CALLER_REQUEST`
  (section 3.3) and attaches raw output + fingerprint.

Implementation: `src/lib/status-parser.js` accepts in the enum;
`src/lib/session-store.js` has a dedicated branch in `checkConvergence`.

Textual `UNCERTAINTY` convention from v2 6.3 remains valid as
supplementary (non-normative) information:

```
UNCERTAINTY:
- cannot conclude without: <X>
- likely verdict given X: <conditional prediction>
```

**v4.7 addition -- N-ary convergence (ask_peers):**

Convergence is bilateral in `ask_peer` sessions and N-ary in
`ask_peers` sessions. The unanimity rule generalizes:

```
converged = (caller_status === 'READY')
         && peers.every(p => p.status === 'READY')
```

For `ask_peer` (bilateral), the rule reduces to `caller_status READY
&& peer_status READY` via read-time normalization of the legacy
schema (legacy scalar `peer` / `peer_status` fields are treated as a
1-element peers array). For `ask_peers` (N-ary), the rule applies to
the array of all non-caller agents computed per section 2.8.

PER-PEER FAILURE: if a peer fails within a round (rate limit, CLI
spawn error, timeout, protocol violation), its failure is recorded
in the round record alongside any other peers' responses. The round
is not converged; a retry is a caller decision per section 3.3
CALLER_REQUEST valve. Successful peer responses in the same round
are NOT discarded. F2 implementation MUST capture per-peer results
independently (Promise.allSettled pattern or equivalent).

NO PARTIAL CONVERGENCE: 2/3 READY with one dissenting peer is not
convergence. `outcome=aborted` is the correct close on persistent
impasse. An escape valve ("partial-convergence") is intentionally
NOT available (feedback_cross_review_priorities: rigor > economy).

LEGACY COMPATIBILITY: `ask_peer` sessions recorded under
v0.4.0-alpha remain readable. `checkConvergence` in v0.5.0-alpha+
normalizes legacy scalar fields into the new peers-array shape at
read time; no on-disk migration is required.

### 6.4 Transcript encoding fidelity -- CANONICAL OPERATIONAL RULE
(KEPT from v2)

All artifacts written for peer consumption must be ASCII-only with
transliteration of Portuguese accents. Standard substitution table
preserved from v2.

`ask_peer` prompts may have accents (transmitted via JSON-over-stdio
API, not via file read). Only files on disk need ASCII-only.

**New in v3**: the rule also applies to PRE-EXISTING files in the repo
that are promoted to review session artifact. In session 0e427278 round
1 the peer flagged the `README.md` of cross-review-mcp itself as
non-ASCII; the correction was to rewrite the entire README with
transliteration before READY.

### 6.5 Cross-session continuity ledger (SOFTENED in v4.1)

The caller **may** maintain a ledger in a persistent file (e.g.
`C:\Users\leona\.cross-review\ledger.md`). When adopted, the ledger
contains:
- Prior sessions (id, date, outcome, scope).
- Closed findings.
- Accepted residual findings + architectural boundary.
- Pending follow-ups.

Ledger in ASCII-only. When the ledger is adopted, new session_init
attaches it as artifact whenever the target relates to prior sessions.

Empirical note (audit 2026-04-24): up to the v4.1 date no
`~/.cross-review/ledger.md` was produced in real use. Section 6.5
remains an optional convention; the ledger-compaction policy takes
effect if/when it is adopted (section 6.6.2).

### 6.6 Overflow / truncation (NORMATIVE in v4.1)

Promoted from FOLLOW-UP to normative contract via session a847f897
(2026-04-24, bilateral-approved). Policy-only -- no code change in
cross-review-mcp was made, and none is justified by the empirical data
collected so far.

#### 6.6.1 Transcript (artifact assembled by the caller)

The transcript (temp artifact produced by the caller and delivered as
an artifact in `session_init`) has operational size limits:

- **Yellow line**: 50000 chars (~12-15k tokens in ASCII). Above this,
  the caller MUST apply the compression order below.
- **Red line**: 100000 chars (~25k tokens). Above this, the caller
  MUST rebuild the transcript entirely or abort the session. Red line
  is a hard stop because the transcript starts dominating the peer's
  context budget.

The thresholds are **operational hygiene**, not model technical limits
(modern windows are much larger). The goal is to preserve peer
attention on live evidence, not accommodate as much as possible.

Preservation order (MANDATORY; compress/remove from BOTTOM UP upon
reaching the yellow line):

1. User verbatim directives (normative, coaching feedback, priority
   shifts) -- NEVER compress nor remove.
2. Open residual findings + follow-ups with deadline-blocking urgency
   -- preserve in full.
3. Valid evidence (fingerprint match, not stale) -- preserve.
4. Timeline of this session's rounds: last 2 rounds in full; prior
   rounds compressed to a 3-5 line summary per round (finding,
   response, state reason).
5. Stale evidence -- remove upon reaching yellow line (stale no longer
   counts for validation per section 3.4).
6. Verbatim appendices -- remove upon reaching yellow line.
7. Cross-session timeline (prior sessions): only 1 line per session
   (id, date, outcome, 1 significant finding). Additional detail only
   if explicitly required by the scope.

#### 6.6.2 Ledger (conditional on use; section 6.5)

Ledger as artifact is optional (see section 6.5). The policy below
applies when and if the ledger is adopted:

- Compaction is **manual** (explicit caller trigger), not automatic.
  No automatic compaction mechanism on session open is allowed --
  automating here risks a silent contract change between sessions.
- Sessions with outcome=converged and age over 90 days may be reduced
  to a 1-line summary (id, date, outcome, 1 significant finding).
- Sessions with outcome=aborted or outcome=max-rounds are preserved
  in full as operational debris for learning. Do not compact.
- The 90-day threshold is a prudential recommendation; the caller may
  adjust it in the manual tool that may eventually be built.

As of 2026-04-24 no ledger was produced in real use; this subsection
is a conditional contract, not a pending task.

#### 6.6.3 meta.json (MCP server artifact)

Empirical observation (audit 2026-04-24): across the 9 sessions present
in `~/.cross-review/`, `meta.json` sizes varied from ~1KB to ~3KB; the
largest historical session had 6 rounds. No real overflow pressure.

Current contract rule:
- `session_read` returns `meta.json` in full.
- No API change (e.g. `rounds_limit` parameter, `session_digest`
  endpoint) is justified by the available empirical data.
- If in the future a session with 20+ rounds + loaded peer_structured
  produces `meta.json` > 500KB and that generates measurable pressure
  on consumers, a future spec (v4.2+) may add an optional parameter to
  `session_read`. Until then, YAGNI -- building preemptively leads to
  picking the wrong shape.

Explicit motivation: respect the "do not design for hypothetical
requirements" principle. Evidence of real pressure is a necessary
condition for API change.

#### 6.6.4 Non-destructive compression (normative invariant)

When the caller, human or tool, assembles a compacted transcript or
ledger for delivery to the peer, the compacted artifact MUST explicitly
declare which excerpts were summarized, removed, or replaced by
reference, including the path of the immutable artifacts that preserve
the original detail.

Example of acceptable declaration inside the compacted transcript:

```
[SUMMARY rounds 1-3 of session X: 1 finding each; full detail at
 C:/Users/leona/.cross-review/<sid>/round-01-peer-codex.md (and 02, 03)]
[REMOVED verbatim appendix Y: 2300 chars; reconstructible from commit
 Z of repo W]
```

MCP runtime history is **immutable**. The files
`~/.cross-review/<sid>/meta.json`,
`~/.cross-review/<sid>/round-NN-prompt.md` and
`~/.cross-review/<sid>/round-NN-peer-<agent>.md` CANNOT be mutated
after being written by the server -- not by the caller, not by
auxiliary tooling, not as a side effect of transcript compaction.
Mutating history is a structural contract violation (loses
auditability, invalidates fingerprints, breaks cross-session
continuity).

Explicit exclusion: `~/.cross-review/<sid>/.lock/info.json` is the
internal concurrency-control mechanism of the session-store (see
section 6.5 of peer-spawn/session-store in code). The lock directory
is created and removed by the server within the `ask_peer` cycle; its
content is not part of the session's auditable record and is not
covered by the immutability invariant above. Callers/external tools
remain forbidden from mutating the lock (tampering with concurrency
control is another kind of structural violation), but the reason is
different from the history invariant.

Compaction/compression occurs EXCLUSIVELY in:
- Transcript assembled by the caller in a temp path, owned by the
  current session.
- Optional ledger, owned by the caller (section 6.5).

Both artifacts assembled by the caller, both outside the server-managed
`~/.cross-review/<sid>/` tree.

### 6.7 Minimal evidence matrix per artifact class (NORMATIVE in v4.2)

Promoted from FOLLOW-UP to normative contract via session f1fdbee4
(2026-04-24, bilateral-approved). Policy-only -- no code change in
cross-review-mcp was made, and none is justified by the empirical data
collected so far.

This matrix defines what the caller MUST execute as dynamic evidence
(cross-reference: section 3.1, section 3.2) before each ask_peer. Peers
use this matrix as a **normative baseline** when deciding
NEEDS_EVIDENCE: the absence of mandatory evidence for a listed class,
without declaration of operational limitation covered by section 3.5, is
an automatic block.

Empiricism: the classes listed below correspond to files actually
reviewed in historical sessions up to 2026-04-24 (session fa283f6c
contains `.tsx`; general sessions contain `.md`, `.js`, `.json`). Not
observed classes (YAML, Python, Rust, Go, shell, Cloudflare semantic
validation of `_headers`/`_routes.json`/`.dev.vars`) do NOT enter the
matrix until they emerge in real use -- same discipline as section 6.5
(ledger) and section 6.6.3 (meta.json).

#### Matrix

| Class | MANDATORY evidence | Canonical command | Optional evidence (active when applicable) |
|-------|--------------------|-------------------|--------------------------------------------|
| JavaScript (.js, .cjs, .mjs) | parse-sanity | `node --check <path>` | linter if `biome.json`/`.eslintrc*` present; test script if `package.json:scripts.test` defined |
| TypeScript (.ts, .tsx) | type-check | `tsc --noEmit` (using the nearest `tsconfig.json`) | linter; test script |
| JSON (.json) | parse-sanity | `node -e "JSON.parse(require('fs').readFileSync('<path>','utf8'))"` | schema validation if local schema available |
| Markdown (.md) | semantic review | N/A (direct reading) | N/A |
| cross-review-mcp itself (this spec + src/ + scripts/) | full smoke | `npm test` (alias of `node scripts/functional-smoke.js`) | direct inspection of parser/server. Step count is dynamic per release (v0.4.0: 60 steps); peer must confirm `all GREEN` independently of the exact count |

#### Notes

**wrangler.json and Cloudflare configs**: `wrangler.json` and files like
`_routes.json` are JSON and validate by the JSON rule above (parse-sanity
via `node -e`). Cloudflare semantic validation (proprietary schema,
binding impact, deploy dry-run) does **NOT** enter this matrix: it is a
CI/GitHub Actions responsibility per the workspace operational directive
`feedback_no_wrangler_deploy` (NEVER use `wrangler deploy` directly,
even `--dry-run`; deploy only via GHA). The peer must NOT require
`wrangler deploy --dry-run` or equivalent as mandatory evidence.

**Optional evidence activates conditionally**: the general rule is "the
optional command enters when the artifact class demands it OR when the
peer's conclusion depends on it". Example: `tsc --noEmit` is optional
for pure JS even if a `tsconfig.json` exists in the repo; it only
becomes mandatory when the artifact under review is TS/TSX, or when the
peer declares it needs the type graph to conclude (in which case it
emits NEEDS_EVIDENCE).

**Fingerprint**: every attached evidence includes SHA-256 of the
artifact at the command moment (section 3.4). Different artifact
fingerprint from the evidence moment = stale = rerun.

**Class not listed** (operational rule, not an entry in the matrix):
- The caller MUST declare the class in the prompt and justify the
  chosen evidence (or the absence of dynamic evidence with rationale).
- The peer may reject via NEEDS_EVIDENCE if the justification is
  insufficient.
- Undeclared class + unjustified evidence = section 3.1 violation
  (factual assertion without attached evidence).

**Matrix is empirical, not exhaustive**: new classes are promoted to
the normative table when they appear in real review sessions. Do not
add speculative classes by anticipation.

### 6.8 Expanded structured-block schema -- IMPLEMENTED in v0.4.0-alpha

Implementation bilaterally approved in session 08cd61e6 (2026-04-24).
Consensus on a stable JSON schema reached in 2 rounds. Normative
contract now in section 2.3.1. Canonical fields in release v0.4.0:
`uncertainty`, `caller_requests`, `follow_ups`. Strings in arrays (not
objects). Extension to objects reserved for v5 if strings prove
insufficient (FOLLOW-UP registered in the session, out of scope for
v0.4.0).

Downstream of this implementation:
- `parser_warnings` now composes the parser's return contract
  (section 5).
- The `omit-unless-signal` rule (section 2.3.1) is a normative
  operational clause: peers that emit optional fields without useful
  content commit an operational violation, even though the parser
  accepts.

### 6.9 Mandatory companion tooling (NEW in v4)

Two normative operational clauses whose violation constitutes a
process failure (distinct from "malformed block", which is a protocol
failure).

#### 6.9.1 Tri-tool

Caller and peer MUST use the three MCP servers together in non-trivial
decisions during any cross-review session:

- **cross-review**: bilateral orchestrator (this MCP).
- **ultrathink**: structured reasoning with quality validation.
- **code-reasoning**: iterative technical analysis with revision.

Specific applications:
- BEFORE `session_init`: the caller MUST have a visible thinking trace
  in ultrathink/code-reasoning justifying scope, plan, success
  criteria. Sessions opened "cold" (without pre-trace) are an
  operational violation.
- DURING `ask_peer`: the caller's prompts MUST explicitly ask the peer
  for the same rigor. Dense cross-review prompts presuppose structured
  peer reasoning, not superficial inspection.
- BETWEEN rounds: the caller MUST run ultrathink/code-reasoning on the
  peer's response before formulating the next prompt. Instantaneous
  reaction without analysis is a violation.
- Tool unavailability: when one of the three MCPs does not respond,
  the session MUST be declared explicitly blocked/suspended. Do NOT
  proceed as if nothing changed.

Motivation recorded (user directive 2026-04-24): "the three working
together are the most lethal weapon against the constant errors AI
agents commit, burning immense time and token cost to perform later
corrections." Cost/latency are NOT optimization targets (see also
6.9.2).

#### 6.9.2 Top-level model

Both caller and peer MUST operate under the most capable model available
in the user's subscription. Canonical normative IDs for v0.4.0:

- **Codex (peer when caller=claude)**: `gpt-5.5` with
  `model_reasoning_effort=xhigh`. Explicit model flag in
  `src/lib/peer-spawn.js:buildCodexArgs`.
- **Claude (peer when caller=codex)**: `claude-opus-4-7` (full ID, not
  alias). Explicit flag in `src/lib/peer-spawn.js:buildClaudeArgs`.

Operational clauses:
- NO silent fallback: if the top-level model fails (rate limit, 401/
  429/5xx error, unavailability), the session MUST be aborted with an
  explicit error. Downgrading to a smaller variant is a violation.
- Model change requires a release bump (v0.4.x -> v0.5.0+) + explicit
  edit of this section. Silent ID update in `peer-spawn.js` without a
  spec bump is a violation.
- Auditability: each round persisted in `meta.json.rounds[i]` contains
  `peer_model` reflecting the ID actually passed. Periodic review
  (at every release) MUST confirm that the IDs remain top-level -- if
  a listed ID was superseded by a new top-level, a dedicated
  cross-review session decides the promotion.
- Test stubs record `peer_model: 'stub'`, distinguishing synthetic
  execution from real.

Motivation recorded (user directive 2026-04-24): "always always always
must call the most current, most capable, most powerful, most top-level
model available in the subscription". The user is subscribed to the
most expensive tier of OpenAI and Anthropic; there is no plan gating
for top models.

**v4.7 addition -- Gemini top-level (triangular extension):**

- **Gemini (peer when caller=claude or caller=codex; or caller when a
  Gemini CLI client opens the session)**: `gemini-3.1-pro-preview`.
  Explicit `--model` flag passed to the `gemini` CLI. The ID is the
  top-tier Gemini model on the user's Google AI Ultra tier as of
  2026-04-24; Google's documentation marks this model as Preview state
  (ref: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview
  and https://ai.google.dev/gemini-api/docs/models as of 2026-04-22).
  A future General Availability rename to `gemini-3.1-pro` will
  trigger a spec micro-bump per this section's auditability clause.

F2 empirical validation item: the F2 impl session will verify via a
CLI ping (`gemini --prompt 'ping' --model gemini-3.1-pro-preview
--approval-mode plan --output-format text`) that the pinned ID is
accepted by the installed CLI. If rejected, v4.7 receives a
micro-edit before the v0.5.0-alpha code commit.

Interaction with section 6.9.2.1: `docs/top-models.json` will gain an
entry for Gemini in F2 with id, validated_at, ref_url, notes. The
`scripts/audit-model-drift.js` loops over entries dynamically; no
structural change to the advisory mechanism is required.

**Clarification (added in v4.8).** The "NO silent fallback" rule in
this section specifically addresses MID-ROUND behavior. Pre-session
deliberate capability probing and adaptation to the operator's
currently reachable models are governed by section 6.9.3 and are
NOT silent: they are audited in `meta.capability_snapshot` and
reported to the caller at `session_init` time. Mid-round silent
downgrade remains prohibited. If an active peer fails during a round
(not at session_init), the round aborts per this section; the server
does NOT silently try the next fallback-chain entry -- that decision
is reserved to a new explicit session with a fresh probe (section
6.9.3.1). Same-model retry-once-with-backoff for transient provider
failures (rate limit / 5xx / outage) is permitted per section
6.9.3.6 and is explicitly distinct from silent model switching.

#### 6.9.2.1 Model drift audit (NEW in v4.3)

STATUS: bilateral-approved (session 9c56005b, 2026-04-24, 4 rounds,
outcome=converged).

Complements section 6.9.2 with an ADVISORY-ONLY drift-detection
mechanism, without altering runtime behavior or the model change
process (which still requires bump + spec edit per section 6.9.2).

Curated documentary source: `docs/top-models.json` contains per-provider
entries with `id`, `reasoning_effort` (optional), `validated_at` (ISO
YYYY-MM-DD), `ref_url`, `notes`, plus a global
`staleness_threshold_days` (default 30). The user is the source of
truth; the JSON merely materializes the human curation for mechanical
inspection.

Advisory tool: `scripts/audit-model-drift.js`, invoked via
`npm run check-models`. Compares the constants pinned in
`src/lib/peer-spawn.js` (via textual read + regex) against the entries
of `top-models.json` and emits:
- Exit 0: IDs match and validated_at within window.
- Exit 1: ID drift (ERROR). Message states that the fix requires
  (a) bump + spec edit per section 6.9.2 in `peer-spawn.js`, AND (b)
  update of `top-models.json`. The script does NOT autofix.
- Exit 2: staleness (WARN). Expired `validated_at` forces manual
  re-verification; if the model is still top-tier, update
  `validated_at`; if superseded, open a dedicated cross-review session
  for the promotion (section 6.9.2).
- Exit 3: structural error (regex did not match, invalid JSON, missing
  file). Indicates a refactor that broke the advisory channel; action
  is to review both `peer-spawn.js` and the script deliberately.

Explicit prohibitions (what this mechanism does NOT authorize):
- Does NOT authorize silent fallback (keeps section 6.9.2 clause
  "NO silent fallback").
- Does NOT authorize runtime config/env override -- the advisor does
  not inject anything into `spawnPeer`.
- Does NOT authorize automatic model selection -- the choice remains
  pinned in `peer-spawn.js`.
- Does NOT authorize ID change without bump + explicit edit of section
  6.9.2 -- the script's exit 1 states this literally in the error
  message.

Operational cadence: `npm run check-models` MUST be run at least once
per release and whenever the user notices the release of a new
top-tier model from any provider. It is not a mandatory CI gate in
this release; it may be promoted to a gate in a future release if
needed.

Interaction with tri-tool (section 6.9.1): the advisory does NOT
replace ultrathink + code-reasoning pre-session_init for a real model
change. Detected drift still requires opening a dedicated cross-review
session applying the full tri-tool before bumping the release.

Motivation: the user recorded on 2026-04-24 (session 08cd61e6) the
follow-up "controlled auto-discovery of top-level model with preserved
auditability". Empirical research on 2026-04-24 demonstrated that
neither CLI (codex, claude) exposes model listing at runtime,
eliminating dynamic CLI auto-discovery. Interpreting "controlled
auto-discovery" as "auditable drift detection", the follow-up is
satisfied by section 6.9.2.1 without touching runtime behavior.

#### 6.9.3 Subscription tier resilience and transient failure handling (NEW in v4.8)

The operator's available model set may change between sessions (for
example, changes to the subscription plan of any provider). The top
model pinned in section 6.9.2 for a given provider may become
unreachable at any future `session_init`. Additionally, providers may
experience transient mid-round failures (content moderation flags,
rate limits, outages) that interrupt a request without representing
a permanent change. A session cannot productively run if it aborts
every time any of these happen; v4.8 introduces a pre-session
deliberate adaptation path (6.9.3.1 through 6.9.3.5) and a mid-round
transient failure handling regime (6.9.3.6) that together keep
section 6.9.2 "NO silent fallback" intact while satisfying the
invariant that cross-review-mcp MUST NOT stop due to provider-side
conditions it can reasonably handle.

##### 6.9.3.1 Pre-session capability probe

At `session_init`, before the first round can be requested, the
server probes each canonical agent for the ability to invoke the
pinned model (plus any fallbacks in the provider's ordered chain).
The probe is a minimal CLI invocation per agent using the canonical
spawn path and read-only flags identical to real peer spawn, with a
short prompt (e.g., "ping") and a per-provider total time budget
(default: 30 seconds, covering all fallback-chain attempts for that
provider).

- Probes run in parallel across the three providers
  (`Promise.allSettled` pattern in the F2 impl).
- Within a single provider, the walk over `fallback_chain` is
  sequential: try the top id first; on deterministic failure, try
  the next entry; repeat until success or the chain is exhausted.
- The 30-second budget is the total per-provider allotment covering
  ALL sequential attempts within that provider's chain.

Deterministic failure classes recognized by the probe:

- `unreachable_with_pinned_id`: provider explicitly responds that
  the model is not available (not-found or equivalent).
- `response_timeout`: no response within the per-provider budget.
- `spawn_error_or_cli_missing`: CLI not installed or fails to start.
- `auth_or_permission_denied`: provider rejects authentication.
- `other`: unspecified failure not matching the above.

Capability notes (informational, do not cause exclusion):

- `tool_use_not_verified`: probe response arrived as text but the
  probe did not verify tool invocation ability. Recorded as a
  capability note. Caller-side obligations under section 6.9.1
  (tri-tool availability of ultrathink + code-reasoning MCPs) are
  unrelated to this probe note and remain hard gates in their own
  right.

##### 6.9.3.2 Fallback chain in top-models.json

Each entry in `docs/top-models.json:entries.<provider>` gains a
`fallback_chain` field: an ordered array of model id strings,
most-capable-first, representing the operator's curated preference
order.

Invariants:

- `fallback_chain[0] === id` (structural invariant; the F2 impl
  adds a gate in `scripts/audit-model-drift.js`).
- Minimum length: 1. A provider without a documented lower fallback
  is represented as `fallback_chain: [id]`; this is the correct
  representation, not a defect.
- Ordering is semantic (most-capable-first) and relies on operator
  curation, same precedent as the `id` field in section 6.9.2.1.

`fallback_chain` is `session_init` probe input (NEW runtime role for
top-models.json since v4.3). The file's description text is updated
in the F2 impl to reflect this dual role; prior language implying
"advisory-only" is qualified.

top-models.json `schema_version` bumps from 1 to 2 in F2 to signal
the shape change.

##### 6.9.3.3 Graceful degradation rules

Let N be the number of viable peers after the `session_init` probe
(viable = probe succeeded with at least one entry in the provider's
`fallback_chain`). N does NOT include the caller.

- `N >= 2`: session proceeds at full triangular capacity (or N-ary
  for N > 2; current triangle implies N in {0, 1, 2}).
- `N == 1`: session proceeds as BILATERAL (caller + single active
  peer). Functionally equivalent to a v0.4.0-alpha `ask_peer`
  session.
- `N == 0`: session ABORTS at `session_init` with an explicit error
  naming the excluded providers and their failure classes.
  Cross-review requires at least two participants by definition.

Notes:

- Degradation is deterministic from the snapshot; the caller sees
  the degradation via `session_read` or the response of the first
  `ask_peer` / `ask_peers` call after init.
- Mid-session failure of an active peer does NOT trigger a
  fallback-chain walk. Per section 6.9.2 mid-round rule, the round
  aborts; transient failure treatment per section 6.9.3.6 allows
  same-model retry only.

##### 6.9.3.4 Session-level capability snapshot

`meta.json` gains a new top-level field `capability_snapshot`
written once at `session_init`:

```
"capability_snapshot": {
  "probed_at": "<ISO timestamp>",
  "active_peers": ["<canonical id>", ...],
  "excluded_peers": ["<canonical id>", ...],
  "per_provider": {
    "<canonical id>": {
      "selected_model": "<id or null>",
      "tier": "top" | "fallback" | "excluded",
      "capability_notes": ["<note>", ...],
      "probe_duration_ms": <int>,
      "attempted_chain": ["<id>", ...],
      "excluded_reason": "<failure class>"
    }
  }
}
```

`active_peers` and `excluded_peers` are disjoint subsets of the
canonical id set minus the caller. `attempted_chain` is present
whenever the selected model is not `fallback_chain[0]` OR the
provider is excluded (documents the walk). `excluded_reason` is
present only when `tier` is `excluded`.

`rounds[i].peers[]` contains only active peers; their records gain
a `peer_capability_tier` field with value `"top"` or `"fallback"`,
mirroring the snapshot for self-contained audit of a round record.
Excluded providers never appear in `rounds[i].peers[]`; the
unanimity rule in section 6.3 applies over the array of active
peers, unchanged.

Tier enum (normative): `top` | `fallback` | `excluded`. Only `top`
and `fallback` may appear in `rounds[i].peers[j].peer_capability_tier`;
`excluded` is exclusively a snapshot-level classification.

##### 6.9.3.5 Interaction with section 6.9.2.1 advisory drift audit

`docs/top-models.json` now serves two distinct roles:

- `entries.<provider>.id` remains an ADVISORY-only documentary pin,
  gated by `scripts/audit-model-drift.js` against the constant pinned
  in `src/lib/peer-spawn.js` per section 6.9.2.1 (v4.3 role,
  preserved).
- `entries.<provider>.fallback_chain` is RUNTIME input to the
  `session_init` probe per section 6.9.3.1 (v4.8 NEW role). It is
  NOT gated by the drift audit (the script continues gating only
  `id`).

The drift-audit F2 update must:

- Add Gemini entry recognition (prior to F2 the script gates only
  Codex and Claude IDs).
- Add `schema_version: 2` validation.
- Verify the invariant `fallback_chain[0] === id` per provider.

These are F2 impl tasks, not spec-level. The spec only states the
invariants and the separation of roles.

##### 6.9.3.6 Resilience to transient provider failures (NEW scope D4/D5)

Beyond persistent tier changes handled at session_init (6.9.3.1
through 6.9.3.5), providers may experience mid-round transient
conditions that interrupt a request without representing a
permanent change. Observed classes (some confirmed empirically in
session 5fce39ce round 1 before the agreed session prompt landed):

- `prompt_flagged_by_provider`: provider content moderation flagged
  the prompt.
- `rate_limit_exceeded`: provider rate-limit temporarily exceeded
  (typically HTTP 429 or the equivalent CLI signal).
- `provider_error_transient`: provider-side HTTP 5xx, outage,
  incident, or server overload.

The invariant "cross-review-mcp must not stop due to transient
provider-side conditions" applies. Treatment:

- Server MAY retry the SAME prompt to the SAME model once with a
  short back-off (default 10 seconds; respect `Retry-After` when
  the provider supplies it) for `rate_limit_exceeded` and
  `provider_error_transient` classes.
- Server MUST NOT auto-rephrase a `prompt_flagged_by_provider`
  prompt. The server lacks safe rephrasing context; risk of
  distorting caller intent is too high. Flagged prompts are
  surfaced to the caller along with the flagged response text for
  caller judgment and manual rephrase.
- Server MUST NOT silently switch to a fallback model mid-round
  (section 6.9.2 rule preserved; section 6.9.3 pre-session path is
  distinct).

When treatment fails or is not attempted:

- The round completes with `peer_status: null`,
  `protocol_violation: false`, and a new response field
  `transient_failure` set to the applicable class enum.
- Session state is preserved. The caller may issue a new `ask_peer`
  / `ask_peers` call (re-using the same round number when providing
  a rephrased prompt for the same attempt, or opening a new round
  at caller discretion).
- An active peer is NOT excluded from `active_peers` due to a
  transient mid-round failure. Exclusion is only a session_init
  decision (section 6.9.3.3). Persistent mid-round transient
  failures across multiple caller retries converge to
  `outcome=aborted` at caller discretion, not server auto-exclusion.

Clients MUST distinguish parse-null (protocol violation) from
transient-null (transient failure) by checking the value of the
new `transient_failure` field: non-null means transient failure;
null combined with `protocol_violation: true` means parse failure
per section 2.4.

Audit trail in `rounds[i].peers[j]`:

- `attempts`: array of objects
  `{attempt_number, outcome, class, duration_ms, started_at,
  signal_or_error_message, retry_after_ms}`. `signal_or_error_message`
  carries the provider-reported reason string when available;
  `retry_after_ms` carries the `Retry-After` value (or equivalent)
  when the provider supplies it.
- `retry_count`: integer summary. Redundant with `attempts.length`
  but useful for dashboards and quick audit queries.
- `transient_failure`: enum string or null.
- Failed attempt bodies are saved in sibling files
  `round-NN-peer-<id>-attempt-<N>.md`. The main `peer_file`
  contains the first successful attempt; it is empty or absent if
  all attempts failed transiently.

Cross-reference: this subsection covers peer-provider request
failures. Equivalent non-stop handling for mandatory LOCAL
reasoning dependencies (ultrathink / code-reasoning MCP servers per
section 6.9.1) is specified in section 6.9.1 and MUST NOT be
silently conflated with peer-provider fallback logic. The two
failure domains are normatively distinct.

### 6.10 Language policy for peer exchange and internal artifacts (NEW in v4.6)

STATUS: bilateral-approved (session b1700438, 2026-04-24, 5 rounds,
outcome=converged).

Rule. All cross-review peer exchange (prompts sent via `ask_peer`, peer
responses, session transcripts persisted under `~/.cross-review/`) and
all non-user-facing project artifacts (this spec body, tooling scripts
and their inline comments, JSON description/notes fields, project memory
files, reports authored for peer consumption) MUST be in en-US.

Exceptions. User-facing content MAY remain in the user's native language
(pt-BR for this project). The scope of "user-facing" is restricted to:
(a) assistant chat output produced for direct consumption by the end
user; (b) historically sealed entries in section 8 (v4, v4.1, v4.2,
v4.3, v4.4, v4.5) authored in pt-BR before this clause --
non-retroactive; (c) documents explicitly authored for direct user
consumption (e.g. a PR description written to be read by the user, or a
CHANGELOG entry surfaced in release notes).

Rationale. (i) Peer models (Codex, Claude) tokenize English more
densely, reducing round cost per cross-review session; (ii) non-ASCII
Latin-1 accent codepoints (U+00E7, U+00E3, U+00E9, U+00F3, and similar)
have repeatedly required silent transliteration under section 6.4 and
in some sessions triggered protocol violations when the peer emitted
pt-BR text in structured blocks across v4.x sessions (9c56005b,
bd8c3cfb, 42130c72, bb38cd79, 843d57eb all observed the pattern in
varying degrees); (iii) en-US
trivially satisfies the ASCII-only requirement of section 6.4 with no
transliteration step; (iv) MCP ecosystem conventions and SDK interfaces
are predominantly English; (v) source code identifiers and JSON schema
keys are already en-US -- this clause extends consistency to prose,
comments, docs, and memory.

Bulk translation authorization. Translation of existing pt-BR
non-user-facing content to en-US as a direct consequence of this clause
does NOT require a separate cross-review session per artifact. A single
bulk commit (or a small set of related commits) referencing this clause
(v4.6 section 6.10) as authority is sufficient. Gates
(`npm run smoke`, `npm run check-models`) must remain green across the
translation. Historical already-sealed section 8 entries remain in
their authored language (non-retroactive).

Forward discipline. Starting from v4.6, every new `ask_peer` prompt
composed by the caller MUST be in en-US; peer responses are expected
in en-US; every newly authored non-user-facing artifact (memory,
reports, spec additions, code comments) MUST be in en-US. Mixed-language
drift is treated the same as ASCII-only drift under section 6.4: a soft
violation that should be corrected on the next edit touching the file.

Motivation recorded (user directive 2026-04-24): "so e importante que
seja em pt-BR o que vier para eu ler; se nao for para eu ler, que seja
TUDO em en-US." User explicitly chose full-scope migration (all phases
now, no deferral).

#### 6.10.1 Caller responsibility — operator chat language MUST NOT propagate to peer exchange (clarification, v1.2.2 / v4.14)

Field evidence 2026-04-26: a Gemini-initiated session opened `ask_peers`
with a pt-BR prompt mirroring the operator's chat language. The
operator's chat with the caller LLM was correctly in pt-BR per
exception (a) above, but the caller propagated pt-BR into the
peer-exchange surface, violating the §6.10 default.

Normative clarification. The caller (assistant LLM driving cross-review
sessions) is responsible for translating peer-exchange content to en-US
before submission. The operator-facing chat language and the
peer-exchange language are CONCEPTUALLY INDEPENDENT artifacts under
§6.10 — exception (a) for chat output does NOT extend to the prompts
the caller sends through `session_init.task`, `ask_peer.prompt`, or
`ask_peers.prompt`. Those are peer-exchange surfaces and bind to the
en-US default unconditionally.

Runtime enforcement (v1.2.2, advisory). The MCP runtime now detects
likely non-en-US content in `task` and `prompt` fields using two
conservative signals (diacritic count and a pt-BR-specific lexeme
list). When detected, a non-blocking advisory `task_language_warning` /
`prompt_language_warning` field is attached to the response, carrying:

```
{
  "suspected_language": "non-en-us",
  "confidence": "low" | "medium" | "high",
  "signals": { "diacritics_count": N, "lexemes_matched": [...] },
  "spec_reference": "spec v4.14 §6.10",
  "recovery_hint": "reformulate_in_en_us",
  "recovery_advice": "<concrete instruction>"
}
```

Current behavior: warn-only — the call proceeds. The operator may
observe false-positive rate and tighten to hard-reject in a future
version once the signal calibration is field-validated.

Caller obligation when warning is emitted. The caller SHOULD
reformulate the next round's prompt in en-US even if the current call
proceeded. Repeated `prompt_language_warning` entries in a session
are an audit signal that the caller is propagating chat-language drift.

---

### 6.11 Transport-aware model-check discipline (NEW in v4.9)

STATUS: trilateral-approved (session c9508617, 2026-04-24, 3 rounds,
caller=claude + peers=codex+gemini, outcome=converged).

**Problem.** The v0.5.0-alpha silent-downgrade defense
(`classifyModelMatch`) compares the peer's text self-report model id
against the pinned `-m` flag. Empirical evidence from session
c9508617's capability probe (2026-04-24): BOTH Codex
(`gpt-5.5 → "gpt-5"`) and Gemini (`→ "Pro"`) flagged
`silent_model_downgrade` as false-positives. The Codex CLI stderr
banner confirmed `model: gpt-5.5` was correctly honored at the CLI
layer; the mismatch is in the model's own unreliable text self-report,
not a real downgrade. Under any cli-subscription / oauth-personal
transport the response does NOT expose an authoritative
`response.modelVersion` field (that is an api-key-only SDK affordance);
text self-identification by LLMs is known-unreliable.

**Rule.** `parsePeerOutputs(stdout, peerModel, transportDescriptor)`
gates the model-check on
`authoritativeModelAttestationAvailable(descriptor) === true`
(equivalently `descriptor.auth === 'api-key'`). When the gate is
false, `classifyModelMatch` is SKIPPED; the round record carries:

```
model_check_skipped: {
  reason: 'unreliable_text_self_report_on_cli',
  auth: <descriptor.auth>,
  endpoint_class: <descriptor.endpoint_class>
}
```

`model_failure_class` stays `null` for bypass rounds; `failure_class`
is reserved for real failures (spawn errors per 6.9.3.6, rate-limits
per 6.13). `protocol_violation` stays `false` for the skipped cause
(still `true` if `status_missing` trips, which is orthogonal).

**Transport descriptor.** `spawnPeer` and `probeAgent` return:

```
transport_descriptor: { agent, auth, endpoint_class }
```

Canonical values:

| agent  | auth              | endpoint_class                  |
|--------|-------------------|---------------------------------|
| codex  | cli-subscription  | chatgpt-pro-backend             |
| claude | cli-subscription  | claude-pro-backend              |
| gemini | oauth-personal    | v1internal                      |
| gemini | api-key           | generativelanguage-v1beta       |

Gemini `auth` is detected by precedence: `GEMINI_API_KEY` env →
`api-key`; `~/.gemini/oauth_creds.json` present → `oauth-personal`;
fallback → `oauth-personal` (matches CLI default).

**Invariants.**
- Defense is NOT removed; opt-in by transport. Future api-key transports
  (post billing-veto lift) reinstate the check automatically.
- Skip is AUDITABLE via `model_check_skipped`. Silent bypass is
  rejected — a round carrying the skip WITHOUT the audit record is a
  protocol violation itself (enforced at the `parsePeerOutputs` level).
- Probe parity (6.9.3.4 update): `probeAgent` applies the same gate.
  Under bypass a responded cli-subscription/oauth-personal peer is
  `tier: 'ok'` with `model_check_skipped` set. `tier: 'fallback'` is
  retired as ambiguous.

**Forensic-only capture.** `cli_attested_model_raw` extracts the
Codex CLI stderr banner line `model: <id>` via regex. Unparsed beyond
trim; non-authoritative; record-only for audit trail. Promotion of
the CLI banner to authoritative attestation (hard-gate comparison
against `peer_model`) is DEFERRED to v4.10 / v0.7+ due to brittleness
under ANSI codes + CLI version drift.

**Rationale.** The v0.5.0-alpha defense was load-bearing against a
real threat (a CLI silently accepting an invalid `-m` flag and
serving a smaller model). Empirically, CLI banners now honor pins
correctly across all three peers; the residual detection gap is the
LLM's text self-report hallucinating. Bypassing the check for
CLI-subscription transports replaces a noisy false-positive with an
auditable skip reason, preserving the defense where it remains useful
(api-key SDK transports with authoritative `modelVersion`).

---

### 6.12 Strict-only convergence with persisted snapshot (NEW in v4.9)

STATUS: trilateral-approved (session c9508617, 2026-04-24, 3 rounds,
outcome=converged).

**Problem.** Informal memory and docs referenced "strict vs loose"
convergence. The v0.5.0-alpha code is implicitly strict but the
ambiguity is a latent footgun. `checkConvergence` recomputes the
predicate on read, which creates a risk that future predicate
changes rewrite historical session meaning.

**Rule.** Convergence predicate normativo:

```
converged iff caller_status === 'READY'
  AND every p in round.peers has p.peer_status === 'READY'
```

`status_missing` counts AGAINST convergence. No "loose-mode"
toggle — the strict denominator is the only semantics. Peers
excluded at probe time live in `meta.capability_snapshot` (NOT in
denominator — the probe excluded them before round dispatch, so
they are not "missing" in the §6.12 sense). Peers failed at
runtime in this round (recorded in `meta.failed_attempts` and
counted in `round.quorum.rejected`) DO count against convergence
under strict semantics: the predicate requires
`round.quorum.rejected === 0` in addition to all responded peers
being READY. Pre-v1.2.3 the snapshot computation incorrectly
ignored `rejected`, allowing 2-of-3 unanimity to be reported as
converged when 1 peer was spawn-rejected; aligned in v1.2.3 per
external audit round-2 closure.

**Persistence.** `appendRound` computes AND persists
`round.convergence_snapshot` at append time:

```
{
  round_index: <N>,
  spec_version: 'v4.9',
  denominator_mode: 'strict',
  caller_status,
  responded_peers: [agent],
  excluded_probe: [agent from capability_snapshot with tier in {offline,excluded}],
  excluded_runtime: [agent from failed_attempts with round === N],
  ready_peers: [agent],
  blocking_peers: [{ agent, reason: 'NOT_READY' | 'NEEDS_EVIDENCE' | 'status_missing' }],
  converged: boolean
}
```

`checkConvergence` PREFERS the persisted snapshot; recomputes only
for legacy (pre-v4.9) rounds that lack the field. Future predicate
evolution does NOT rewrite old rounds — new rounds carry the new
`spec_version`.

**Invariant.** `protocol_violation` stays OUT of the convergence
predicate. v0.5.0-alpha behavior preserved: a round where peers
declared READY but tripped `silent_model_downgrade` false-positives
(pre-v4.9) still converged on `peer_status`; with §6.11 applied
those false-positives no longer fire at the source.

---

### 6.13 Rate-limit class distinct from silent-downgrade (NEW in v4.9)

STATUS: trilateral-approved (session c9508617, 2026-04-24, 3 rounds,
outcome=converged).

**Problem.** v0.5.0-alpha classifies a rate-limited peer either as
spawn failure (`failed_attempts` with undifferentiated reason) or as
`status_missing → protocol_violation` with no retry signal. Operator
has no way to distinguish "retry after backoff" from "abort the round".

**Rule.** New `failure_class: 'rate_limit_induced_response'`,
orthogonal to `silent_model_downgrade`, `probe_no_model_report`, and
`unreliable_text_self_report_on_cli`. Two detection layers:

**Spawn-level (preferred).** On non-zero exit, scan stderr (post-R14
redaction) for a provider-shaped lexeme:

```
{ '429', 'rate limit', 'usage limit', 'quota exceeded',
  'insufficient_quota', 'RESOURCE_EXHAUSTED', 'Retry-After' }
```

Generic `{rate, quota, limit}` are EXPLICITLY excluded to prevent
false-positives on legitimate meta-discussion. Match → the rejection
error carries `err.spawn_rate_limit = { retry_after_seconds,
lexeme_matched, detection_source: 'spawn' }`; the `ask_peers` handler
routes via `saveFailedAttempt(agent, 'rate_limit_induced_response', …)`.

**Response-level (composed guardrail).** On zero exit with a
truncated body, require ALL THREE:
1. `</cross_review_status>` is ABSENT from stdout.
2. stdout body is `< 200 chars`.
3. Body matches at least one provider-shaped lexeme.

Match → the per-peer round entry gets `response_class:
'rate_limit_induced_response'` + `retry_after_seconds`; `peer_status`
stays `null` (counts AGAINST strict convergence per §6.12).

**`retry_after_seconds`.** Parsed from `Retry-After: N` in stderr or
body when present. `null` when absent. NEVER fabricated.

**Caller-facing surface.** `ask_peers` and `ask_peer` response
envelopes include:

```
rate_limited_peers: [{ agent, retry_after_seconds,
                       detection_source: 'spawn' | 'response',
                       lexeme_matched }]
```

The caller decides retry-after-wait vs abort based on this surface.
cross-review-mcp itself does NOT auto-retry (the retry semantic is
orchestrated by the caller to preserve the billing/cost contract).

**Ordering in parsePeerOutputs.** Rate-limit detection runs BEFORE
the model-check gate — a rate-limited truncated body does not also
trip a spurious model-mismatch signal.

**Invariant.** Rate-limit + silent_model_downgrade are orthogonal.
Both CAN fire on the same round (a legitimate degraded-fallback
under rate-pressure on a future api-key transport). Under §6.11,
model-check is skipped for CLI transports so the "both fire" case
only manifests on api-key transports.

---

### 6.14 Anti-hallucination / epistemic discipline (NEW in v4.10)

STATUS: implementation-ratified (Item D of session c9508617's approved
v4.9 deferred-to-v4.10 scope, 2026-04-24; coded in v0.7.0-alpha).

**Principle.** Three top-tier AIs converging via cross-review is the
canonical defense against confabulation (one model hallucinates, the
peers catch it). The protocol MUST codify this defense rather than
rely on emergent behavior. When an agent (caller or peer) lacks
information required to answer a question or complete a step:

1. **Do not invent.** No plausible-sounding fabrication, no "most
   likely" guesses presented as fact, no hallucinated function
   signatures / CLI flags / model IDs / file contents / commit SHAs.
2. **Exhaustively search first.** Re-read artifacts, re-query tools,
   consult primary sources (official docs, CLI `--help`, live
   probes), and emit `NEEDS_EVIDENCE` with specific `caller_requests`
   when a peer exchange can resolve it.
3. **Escalate to operator last.** If after exhaustive search the gap
   remains, invoke `escalate_to_operator` and mark
   `status='NEEDS_EVIDENCE'` with a `caller_requests` item
   explicitly requesting operator clarification.

**Tail-directive additions (composed into every `ask_peer` /
`ask_peers` prompt via `attachPromptTailDirective`):** the peer is
told explicitly that fabrication violates protocol and that
`NEEDS_EVIDENCE` is the canonical response when verified information
is unavailable.

**Structured status block — two new optional fields.**

- `confidence: 'verified' | 'inferred' | 'unknown'` — the peer
  self-declares the epistemic state of its response. `verified` =
  sourced from primary evidence (files read, tools invoked, CLI
  output, URLs fetched). `inferred` = derived from related evidence
  via reasoning; not directly sourced. `unknown` = cannot answer
  with confidence; MUST pair with `status='NEEDS_EVIDENCE'`.
- `evidence_sources: [string]` — concrete sources consulted, same
  validation shape as `caller_requests` (array of strings, max 20
  entries, max 500 chars each). Recommended prefixes: `file:`,
  `tool:`, `cli:`, `url:`, `memory:`.

**Cross-field rules (parser-enforced):**

- `confidence='unknown' AND status !== 'NEEDS_EVIDENCE'` → parser
  warning. The pairing is hard; violating it is a protocol-discipline
  signal the caller should address next round.
- `confidence='verified' AND evidence_sources is empty or absent` →
  advisory parser warning. Verified claims without concrete source
  citations are a hallucination-risk signal.

**New MCP tool `escalate_to_operator(session_id, question, context)`.**
Persists an escalation record under `meta.escalations[]` with
`escalation_id` (UUIDv4), `from_agent`, `question`, `context`,
`round_index`, `timestamp`. The tool does NOT auto-dispatch to the
operator — the caller orchestrator (Claude Code in current deployments)
is responsible for surfacing the question via chat. Empty/whitespace
question strings are rejected with a validation error.

**Invariants.**

- `confidence` and `evidence_sources` are OPTIONAL. Peers predating
  v4.10 that omit both fields remain fully compliant; the pre-v4.10
  structured block shape is preserved.
- Parser warnings (hard-pair, advisory) DO NOT block convergence —
  they surface discipline signals for the caller. Convergence still
  tracks `peer_status` per §6.12.
- `escalate_to_operator` is optional. A session that never escalates
  has an empty `meta.escalations[]` array (added on first call).

### 6.11 amendment: CLI banner as authoritative attestation (NEW in v4.10)

STATUS: implementation-ratified (Item E of session c9508617's
approved v4.9 deferred-to-v4.10 scope, 2026-04-24).

**Problem.** v4.9 captures the Codex CLI stderr banner
`model: <id>` as forensic-only (`cli_attested_model_raw`) without
using it to gate protocol compliance. Empirical evidence from session
c9508617: the banner reflects the model the CLI actually negotiated
— if Codex CLI were to silently reject an invalid `-m` and switch
to a fallback model, the banner would show the real one. The banner
is therefore a STRONGER attestation than the model's own text
self-report (which is known-unreliable across all three CLI peers).

**Rule.** For transports with `auth === 'cli-subscription'` when
`parsePeerOutputs` is called with a non-null `cliAttestedModel`
argument (sourced from `spawnPeer`'s `cli_attested_model_raw`):

- Banner MATCHES pinned `peer_model` → elevate the audit record.
  `cli_banner_attested: true` on the per-peer round entry;
  `model_check_skipped.cli_banner_attested: true`. The text-level
  self-report check remains SKIPPED per §6.11 (the CLI banner is
  what attests; text self-report is a separate, unreliable signal).
- Banner MISMATCHES pinned `peer_model` → hard gate.
  `model_check_applicable: true`, `model_match: false`,
  `model_failure_class: 'cli_banner_attestation_mismatch'`,
  `protocol_violation: true`. Not retried (same discipline as
  `silent_model_downgrade` under §6.11 api-key path).
- Banner ABSENT/UNPARSEABLE → fall through to §6.11 unchanged
  `model_check_skipped` path.

**Scope.**

- v0.7.0-alpha implements banner parsing for Codex CLI only.
- **Claude CLI empirical survey (2026-04-24, v4.11 resolution):** CLI
  version 2.1.119 was probed with three invocation variants using
  the production flag tree (`-p --output-format text --model
  claude-opus-4-7 --permission-mode default --strict-mcp-config
  --mcp-config <reviewer-minimal.mcp.json> --disallowed-tools
  Write,Edit,NotebookEdit`): (1) valid pin with short prompt; (2)
  valid pin with `--verbose`; (3) invalid pin
  (`claude-non-existent-99`) forcing an error path. In ALL three
  cases, Claude CLI emitted exactly 0 bytes to stderr — model-identity
  signals (valid self-report, invalid-pin error message) appear only
  on stdout, not on a banner-like stderr channel. Conclusion:
  Claude CLI offers NO banner-equivalent attestation in this CLI
  generation. Claude falls through to §6.11 `model_check_skipped`
  discipline — the same path it took under v0.6.0-alpha (§6.11
  original) and v0.7.0-alpha (§6.11 amendment without Claude banner
  support). The "deferred to v0.8+" follow-up is CLOSED as negative
  result; no future release needs to revisit it unless a future
  Claude CLI version introduces a banner channel, in which case the
  same Codex-style extraction pattern can be copied into a
  `extractClaudeAttestedModelRaw` sibling.
- oauth-personal transports (Gemini via v1internal) have no banner
  equivalent and remain on §6.11 skip discipline regardless of what
  `cliAttestedModel` arg is passed.

**Invariant.** Item E STRENGTHENS the v4.9 defense without replacing
it. A cli-subscription peer with an unparseable banner is no worse
off than under v4.9; a peer with a parseable and matching banner is
AUDITED more precisely; a peer with a parseable but mismatching
banner is caught by a hard gate that v4.9 could not catch (because
v4.9 skipped the check entirely for cli-subscription).

---

### 6.16 Prompt-flag recovery contract (NEW in v4.12)

**Trigger.** OpenAI Codex on reasoning models (o-series, gpt-5 family) runs
its prompts through a moderation classifier. On rejection, the CLI exits
non-zero and stderr contains `your prompt was flagged as potentially
violating our usage policy. Please try again with a different prompt:
https://platform.openai.com/docs/guides/reasoning#advice-on-prompting`.

**Field evidence (sessions `6cf09af3`, `70d1d349`, `fca13b80`, all in
2026-04-24).** Three triangular sessions had the codex peer flagged on
prompts that discussed `silent_model_downgrade`, `protocol_violation`,
`adversarial peer spawn`, model self-report mismatches, and
rate-limit-induced fallbacks. The technical content was benign engineering
prose; the moderation classifier flagged the combination of
"adversarial" + model-introspection language as a possible
jailbreak/circumvention pattern. False positive, but the runtime treated
each as a hard abort (`outcome: aborted`), losing the codex contribution
for the round.

**Distinction from rate-limit (§6.13).** Rate-limit recovery is
"wait-and-retry" — the prompt is fine, the provider is busy. Moderation
recovery is "reformulate-and-retry" — the prompt content itself triggered
the classifier and resubmitting it verbatim will fail again. The two
classes therefore need separate `failure_class` values and separate
`recovery_hint` semantics.

**Contract.** Implementations MUST:

1. **Detect.** When a peer spawn exits non-zero AND stderr matches any of
   the lexemes in `PROMPT_FLAG_LEXEMES` (`peer-spawn.js`), attach
   `err.prompt_flagged = { detection_source: 'spawn', lexeme_matched,
   docs_url }` to the rejection error.
2. **Classify.** The handler (`server.js`) maps the rejection to
   `failure_class: 'prompt_flagged_by_moderation'` (NOT
   `spawn_rejected`). The classification takes precedence over
   `rate_limit_induced_response` when both are detected.
3. **Surface recovery hint.** The rejection envelope in the tool response
   carries:
   - `recovery_hint: 'reformulate_and_retry'`
   - `reformulation_advice` — concrete textual guidance (avoid charged
     words, prefer neutral technical phrasing, etc.)
   - `docs_url` — the OpenAI advice-on-prompting link from stderr.
4. **Persist.** `meta.failed_attempts[]` records the same fields plus
   `recovery_hint` and `docs_url` so post-hoc audits can spot the pattern.

**Caller obligation.** The caller (assistant LLM or human operator using
the MCP) MUST honor the recovery hint:

- On `recovery_hint='reformulate_and_retry'`: rewrite the prompt
  following the `reformulation_advice` and call `ask_peers` (or
  `ask_peer`) again in a NEW round. **Do NOT abort the session.** The
  session continues; only the codex contribution is missing from the
  flagged round, and reformulation recovers it. Repeat up to **5
  reformulation attempts** before escalating to the operator with a
  human-readable summary of what was tried.
- On `recovery_hint='wait_and_retry'`: observe `retry_after_seconds` and
  resubmit unchanged after the cooldown.
- On `recovery_hint=null` (`failure_class='spawn_rejected'`): unclassified
  peer-side error; surface to the operator.

**Reformulation guidance (canonical, also embedded in
`reformulation_advice`).** The classifier triggers most reliably on
combinations of:

- "adversarial", "exploit", "attack", "bypass", "circumvent",
  "jailbreak" — replace with "edge case", "leverage", "alternative
  path", "uncoordinated".
- Model-introspection prose ("the model silently downgrades to X",
  "the provider lies about its model id") — replace with neutral
  observation ("the response declared a different canonical id than
  the requested pin").
- Discussion of moderation/safety classifiers as systems to be
  reverse-engineered or worked around — replace with descriptive
  observations of the failure mode.

**Anti-pattern.** Aborting the session on a moderation flag (the
behavior observed in 2026-04-24 sessions) is **non-conforming** under
this contract. Codex contributing to N-1 of N rounds because rounds 2/3
reformulated successfully is the conformant outcome.

**Out of scope (deferred).**
- Auto-reformulation inside the MCP itself. Reformulation requires the
  caller's contextual judgment; pushing it into peer-spawn would either
  multiply cost (extra LLM call per spawn) or produce naive substitutions
  that lose the prompt's analytic intent.
- Statistical learning on the lexeme triggers. The current `PROMPT_FLAG_LEXEMES`
  list is conservative (literal stderr substrings); enhancing it is a
  v0.7+ concern.

**Observability.**
- `meta.failed_attempts[]` entries with
  `failure_class='prompt_flagged_by_moderation'` are countable per
  session and across sessions for `npm run check-models` analogs.
- A reformulation that succeeds in round N+1 leaves the flagged round
  in `failed_attempts` AND records the successful round normally;
  reconciliation is by `(session_id, agent)` aggregation, not by
  expecting `failed_attempts` to be cleared.

---

### 6.17 Spec-version persistence in meta.json (NEW in v4.13)

**Trigger.** The 2026-04-26 audit of all 60 sessions in `~/.cross-review/`
(see `docs/session-audit-2026-04-26.md` §2.4) found that NO session
carried `meta.spec_version`. Cross-version comparisons — for example,
"did v4.11's transport bypass reduce silent_model_downgrade rate?" —
required code archaeology of the git log instead of being a simple meta
query.

**Contract.** Implementations MUST persist the spec version active at
`session_init` time into `meta.spec_version` (e.g., `'v4.13'`).
The value is set once at session creation and is not mutated by
subsequent rounds. The constant is exposed in code as
`session-store.SESSION_SPEC_VERSION` for tests and audit consumers.

**Backwards compatibility.** Sessions created before v4.13 will not
carry the field. Audit consumers MUST tolerate the absence
(`meta.spec_version === undefined`) and treat it as "pre-v4.13". No
migration script is required.

**Distinction from convergence-snapshot spec_version.**
`round.convergence_snapshot.spec_version` (introduced in v4.9 §6.12)
records the spec version of the convergence semantic at append time;
`meta.spec_version` records the spec version of the session as a whole
at init time. They MAY drift across long sessions if a runtime
upgrades mid-flight, and that drift is itself audit-relevant.

---

### 6.18 Long-idle session reconciliation + structured outcome_reason (NEW in v4.13)

**Trigger.** Audit §2.2: 7 of 60 sessions in `~/.cross-review/`
remained without `outcome` set. Some were 0-round probes the operator
opened then closed without invoking `ask_peer`/`ask_peers`; others were
real sessions abandoned mid-flight. They accumulated, locks could
become stale, and the audit trail was unclear about whether the work
was abandoned or completed elsewhere.

**Contract — new tool.**

```
session_sweep({ stale_days = 7, dry_run = true, reason = 'stale' })
→ {
  ok: true,
  stale_days, dry_run, reason,
  candidates: [
    { session_id, last_activity_at, age_days, has_rounds, locked,
      would_finalize, skip_reason? },
    ...
  ],
  finalized: [
    { session_id, outcome: 'aborted', outcome_reason: <reason> },
    ...
  ]
}
```

**Normative requirements.**

1. **Last-activity staleness.** A session is stale iff
   `now - last_activity_at >= stale_days * 24h`, where
   `last_activity_at = max(meta.started_at, max(meta.rounds[].started_at),
   max(meta.rounds[].completed_at))`. Pure session age (`now - started_at`)
   is INCORRECT — a 30-round session whose last round completed an hour
   ago is not long-idle.

2. **24h hard floor (non-overridable).** Sessions younger than 24h from
   `last_activity_at` MUST never be candidates, regardless of
   `stale_days` argument. This is a footgun guard. `stale_days=0` does
   NOT bypass the floor.

3. **Already-finalized exclusion.** Sessions with
   `meta.outcome != null` MUST be excluded entirely from `candidates`
   (not even reported as skipped).

4. **Lock collision visibility.** If `~/.cross-review/<id>/.lock`
   exists, the candidate row MUST carry `locked: true`,
   `would_finalize: false`, and `skip_reason: 'locked'`. The session
   MUST NOT be finalized even when `dry_run=false`. Operator audits
   why a long-idle session is also locked.

5. **Read-only dry-run.** With `dry_run=true` (default), the call MUST
   NOT alter any `meta.json`, lock file, or filesystem mtime.
   `finalized` is `[]`. Only the response payload changes.

6. **Re-read-before-write.** When `dry_run=false`, finalize MUST
   re-read `meta.json` immediately before writing and skip if
   `meta.outcome != null` was set by a concurrent process between
   enumeration and write. Implementations MAY expose this as a
   `finalizeIfUnset(sessionId, outcome, reason)` helper.

7. **Malformed timestamps.** If `last_activity_at` cannot be computed
   (all timestamps unparseable), the row MUST appear with
   `skip_reason: 'malformed_timestamp'` and `would_finalize: false`.
   Auto-finalize MUST NOT proceed.

8. **Outcome value.** Swept sessions are finalized with
   `outcome: 'aborted'` (the v4 enum value); `'stale'` is NEVER an
   outcome. The structured "why" lives in `outcome_reason`.

**Contract — outcome_reason field.**

`session_finalize` accepts an optional `reason: string` argument that
is persisted to `meta.outcome_reason`. Free-form short string;
conventions documented here:

| reason value | meaning |
|---|---|
| `'stale'` | swept by `session_sweep` after long idle |
| `'peer_scope_creep'` | intentional rollback after peer pivoted to unauthorized implementation |
| `'moderation_flag_unresolved'` | §6.16 5-attempt cap exhausted; reformulation could not unblock |
| `'operator_abort'` | explicit human abort (CLI Ctrl-C, UI close) |

The list is open — implementations MAY introduce new conventions as
field-evidence demands. Audit consumers SHOULD treat unknown
`outcome_reason` values as opaque.

**Backwards compatibility.** Pre-v4.13 sessions lack
`meta.outcome_reason`. Audit consumers MUST tolerate the absence.

#### 6.18.1 Lifecycle invariants (NEW in v1.2.3, external audit round-2 closure)

The external audit round 2 (Gemini-orchestrated, Codex-authored, 2026-04-26)
identified that the session lifecycle had three writer paths with race or
clobber risks. Closed by binding implementations to these invariants:

**`session_finalize` lock + idempotency.** Implementations MUST acquire the
session lock for the entire read+write window (`store.acquireLock` at handler
entry, `store.releaseLock` in `finally`). Inside the lock, the handler MUST
read the current `meta.outcome` and:

- If `meta.outcome === args.outcome` AND `(meta.outcome_reason ?? null) ===
  (args.reason ?? null)` (after null-normalization that collapses empty/
  whitespace-only strings to null): no-op success. The handler MUST NOT call
  `store.finalize` on this branch — `meta.finalized_at` is preserved from
  the original call so audit trails reflect the canonical finalization time.
  Response payload includes `idempotent: true` and a `note` field documenting
  the no-op.
- Otherwise (different outcome OR different reason): MUST throw with both
  the existing state and the incoming state surfaced in the error message.
  The error MUST instruct the caller that "Identical re-finalize is allowed
  as a no-op; different outcome or reason is not."
- If `meta.outcome == null`: write via `store.finalize(sessionId, outcome,
  reason)`.

This contract enables safe retry-after-network-blip (callers re-issuing the
same request after timeouts succeed without state corruption) while
rejecting genuine conflicts (caller bug or operator error). Pre-v1.2.3
behavior was unconditional clobber, both racing with in-flight rounds and
silently overwriting prior finalization.

**`ask_peer` and `ask_peers` finalized-session refusal.** After acquiring
the lock and reading `meta`, both handlers MUST throw if `meta.outcome !=
null`. Appending a new round to a finalized session produces zombie state
(round entries after the supposed terminal point). The error MUST instruct
the caller to open a new session via `session_init` if the conversation
needs extending.

**`escalate_to_operator` post-finalize annotation policy.** This handler
MUST acquire the session lock for write-ordering (was unguarded pre-v1.2.3,
racing with concurrent ask_peers). It MUST NOT refuse on finalized sessions
— the operator may legitimately escalate something on a concluded session
during later review. This is a deliberate departure from the
ask_peer/ask_peers refusal policy, justified by the semantic difference:
escalation is an audit-trail annotation (writes to `meta.escalations[]`)
not a state extension. Implementations MAY relax to refusal in a future
release if the audit-annotation use case proves rare in field evidence.

**Backwards compatibility.** Pre-v1.2.3 sessions never hit these paths
(handlers didn't exist or had different semantics); existing finalized
sessions remain readable. The new contracts apply only to handler
invocations on a v1.2.3+ runtime. Test coverage:
`scripts/functional-smoke.js::driveV414SessionLifecycleGuardsUnit` asserts
the store-level invariants and anti-drift on the canonical handler text.

#### 6.18.2 Per-file persistence size cap (NEW in v1.2.4, external audit round-3 F8 closure)

Round-3 of the external audit flagged that `~/.cross-review/<id>/round-NN-prompt.md`
and `round-NN-peer-X.md` files persisted to disk had no size limit, allowing
an adversarial peer streaming a 100 MB response before timeout to fill the
session-store directory before `session_sweep` could reclaim it.

**Contract.** Implementations MUST cap per-file artifact writes at
`PERSISTENCE_MAX_BYTES` (canonical: 64 KiB) for `savePromptForRound` and
`savePeerResponse`. When the input exceeds the cap, the implementation MUST:

1. Truncate the content at the byte boundary (Node's UTF-8 default discards
   partial codepoints — acceptable; the marker documents that truncation
   occurred so audit consumers see it explicitly).
2. Append a marker of the form
   `[... truncated by spec v4.14 §6.18.2 size cap: original=<N> bytes,
   written=<MAX> bytes (label=<context>) ...]` so audit consumers can read
   the exact original size + the context of what was truncated.
3. Treat the truncation as expected behavior — NOT raise an error, NOT
   abort the round. The peer's status block (which is short) lives at the
   tail of the response and is preserved by parsing on the in-memory string
   BEFORE truncation; only the on-disk artifact is capped.

**Rationale.** 64 KiB covers >99% of observed peer responses in the
60-session audit corpus; the few exceptions were single rounds with
extreme prompt artifacts. The cap is preventive — it doesn't change
common-case behavior but bounds the worst case.

**Distinction from F6/F7 (deferred to v1.3+).** F8 caps the FINAL on-disk
write; F6 (per-stream byte cap during spawn) and F7 (transactional spawn
teardown) cap upstream resource use. F8 alone is sufficient to bound disk
usage; F6/F7 would additionally bound RAM usage and zombie processes.

**Test coverage.** `scripts/functional-smoke.js::driveV414PersistenceSizeCapUnit`
asserts the under-cap pass-through path, the over-cap truncation path with
audit marker, type-shape rejections, and the end-to-end behavior of
`savePromptForRound` + `savePeerResponse` on oversize input.

#### 6.18.3 Per-stream RAM cap with kill-on-overflow (NEW in v1.2.5, external audit round-4 §4.1 closure)

**Trigger.** Round-3 §F8 capped on-disk persistence; round-4 §4.1 noted F8
did not bound RAM. `proc.stdout.on('data', d => stdout += d)` accumulated
unbounded — an infinite peer output exhausts process memory before the
spawn timeout fires.

**Contract.** Implementations MUST cap per-stream RAM accumulation in
`spawnPeer` and `probeAgent`:

- `PEER_STREAM_MAX_BYTES = 4 * 1024 * 1024` (4 MiB) — `spawnPeer` stdout
  AND stderr each capped independently.
- `PROBE_STREAM_MAX_BYTES = 256 * 1024` (256 KiB) — `probeAgent` stdout
  AND stderr each capped independently. Probes are short by design.

On overflow detected at receive time, implementations MUST:
1. Kill the process tree (`killProcessTree(proc)`).
2. For `spawnPeer`: reject the promise with `err.stream_overflow =
   { stream, max_bytes, tail }` so the server.js handler can classify
   `failure_class: 'stream_overflow'` (volumetric — distinct from
   moderation/rate-limit).
3. For `probeAgent`: finish with `tier: 'offline'` +
   `failure_class: 'probe_stream_overflow'` + `stream_overflow` audit field.

**Recovery hint.** `stream_overflow` carries `recovery_hint: null`. The
failure is volumetric (depends on the peer's response shape this round),
not semantic — reformulating the prompt is not guaranteed to produce a
shorter response. Caller MAY retry as a transient; if persistent across
rounds, escalate to operator. This intentionally stays separate from the
§6.16 `reformulate_and_retry` and §6.13 `wait_and_retry` recovery hints.

**Test coverage.** `scripts/functional-smoke.js::driveV414StreamCapConstantsUnit`
provides STRUCTURAL anti-drift coverage: asserts `PEER_STREAM_MAX_BYTES`
and `PROBE_STREAM_MAX_BYTES` are exported with the correct ordering
(`0 < PROBE < PEER`) and that the `stream_overflow` failure-class
classification chain is wired in BOTH `ask_peer` and `ask_peers` server
handlers (source-inspection assertion that proves the wiring exists).
Behavioral end-to-end coverage (spawn a peer CLI emitting >cap and
assert the kill+reject path executes) requires a peer-emulator harness
not currently in the stdio fixture and is deferred to v1.3.x. The
runtime overflow code path is exercised in production via natural peer
output spikes; structural smoke + production exposure together provide
sufficient regression protection for v1.2.5.

**v1.2.7 amendment (external audit round-5 F3+F4).** Round-5 of the
external audit (Gemini-orchestrated, codex-corroborated against v1.2.6)
identified two real implementation gaps in the §6.18.3 RAM-cap enforcement
and the related §2 process-reaping path. Closed in v1.2.7:

1. **Listener detach before kill.** Pre-v1.2.7 implementations called
   `killProcessTree(proc)` on overflow/timeout but left the `proc.stdout`
   and `proc.stderr` `data` listeners attached. Because Windows `taskkill`
   is async (50-200ms typical) and POSIX `process.kill` returns before the
   child fully exits, in-flight `data` events kept growing the JS-side
   string buffers DURING the kill window — a hostile or pathological peer
   could push the soft cap from 4 MiB to 8-16+ MiB before the process
   actually died. Implementations MUST `removeAllListeners('data')` on
   BOTH stdout and stderr before invoking `killProcessTree`. Use
   `removeAllListeners` (pure JS-land) rather than `proc.stdout.destroy()`
   (which can race with `taskkill` and emit spurious `'error'` events on
   Windows). A single `data` event already in the microtask queue may
   still fire once after detach (single-chunk-bounded leak ≤64 KiB per
   event); acceptable. The pattern applies to BOTH `spawnPeer` and
   `probeAgent`, AND to BOTH the overflow handler AND the timeout handler
   in each (4 leak paths total).

2. **Windows taskkill nonzero-exit fallback.** Pre-v1.2.7 the
   `killer.on('close', code)` handler logged on `code !== 0` but had no
   recovery — `taskkill` failures (AV interference, permission inheritance
   bugs, race with normal exit) leaked the child process. The
   `killer.on('error', err)` path also only logged. Implementations MUST
   invoke `proc.kill('SIGKILL')` (in a try-catch that swallows ESRCH for
   already-dead processes) on BOTH the nonzero-`close` path AND the
   `error` path. This is a strict improvement over log-and-leak —
   harmless when the child already exited (catch absorbs the error) and
   a best-effort reap of the proc handle when it didn't. **Important
   caveat (v1.2.8 wording clarification, post-round-5 closure):** under
   `shell: true` (§6.21), `proc` references the immediate child
   `cmd.exe` shell on Windows, NOT the actual peer CLI. Killing
   `cmd.exe` does not walk the process tree; the peer CLI grandchild
   may orphan when `taskkill /T /F` (which DOES walk the tree) has
   already failed. The `proc.kill('SIGKILL')` fallback is therefore
   harm reduction over log-and-leak — it strictly improves the
   handle-level reap — but is NOT a guaranteed tree kill on Windows.
   Full tree-kill completeness when `taskkill` fails is a separate
   v1.3.x deferral item (see deferral list below) and is properly tied
   to the `shell: false` migration.

**Test coverage (v1.2.7).** New structural anti-drift driver
`driveV414StreamListenerDetachUnit` asserts both detach helpers
(`detachStreamListeners` for `spawnPeer`, `detachProbeListeners` for
`probeAgent`) exist with the canonical body, and that each is invoked at
least twice (once per leak path in its closure scope). New driver
`driveV414TaskkillFallbackUnit` asserts the close + error handlers each
contain the `proc.kill('SIGKILL')` fallback. Behavioral coverage
(exercising the kill window with a peer-emulator emitting >cap) remains
deferred to v1.3.x.

**Items deferred to v1.3.x (round-5 explicit deferral).** Gemini's
recommendations 3 and 4 plus the §2 TOCTOU residual are real but outside
v1.2.7 scope:
- **Recommendation 3: MCP request-boundary payload caps** for `task`,
  `prompt`, and `artifacts`. Currently the only enforcement is
  §6.18.2's per-file persistence cap (64 KiB) at the disk-write layer.
  An adversarial caller could ship a 100 MiB `prompt` that consumes RAM
  before any disk write. This is a normative spec change requiring
  threshold calibration (post-truncation behavior, response shape on
  oversized input) and is properly v1.3.x material.
- **Recommendation 4: behavioral peer-emulator harness** for stream
  overflow tests. Already deferred at v1.2.5 with same rationale; F3
  closure does NOT change that.
- **§2 TOCTOU realpath-vs-I/O race** (round-5 §2 residual, codex round-5
  R1 polish ask for spec-level parity with audit-doc + CHANGELOG). Window
  exists between `fs.realpathSync` validation in `sessionDir()` and the
  subsequent file I/O. Accepted under §6.21 single-user trusted-host
  threat model. Eliminating it would require POSIX `O_NOFOLLOW`-style
  per-operation gates not currently in Node's stable fs surface; not a
  v1.3.x ship target, filed as known limitation.
- **F4 fallback completeness under `shell: true`** (round-5 round-6
  follow-up; gemini's v1.2.7 re-audit + codex meta-eval both flagged this
  as the residual after F4 closure). When `taskkill /T /F` fails and the
  v1.2.7 fallback `proc.kill('SIGKILL')` fires, on Windows `proc`
  references the immediate `cmd.exe` shell child (because §6.21 spawns
  with `shell: true`), so the kill terminates `cmd.exe` but does NOT walk
  the tree to the actual peer CLI grandchild — orphan possible. The
  proper closure is the §6.21 `shell: false` migration (PATHEXT
  resolution + direct exe spawn → `proc` IS the peer CLI → handle-level
  kill closes the cmd.exe-shell-orphan layer specifically). Note: even
  under `shell: false`, handle-level kill is not a general descendant
  tree walk — if the peer CLI itself spawns sub-processes that do not
  inherit a kill signal, those may still orphan; full tree-kill in
  fallback paths would still require `taskkill /T /F` (the primary
  reaper that this fallback exists to back up) or an OS-level job
  object on Windows. The v1.2.8 caveat narrows the residual to
  the cmd.exe-shell layer specifically; broader peer-CLI-descendant
  containment is out of scope for the current threat model. Interim
  mitigations considered and rejected for v1.2.x: (a) retry `taskkill`
  once on first failure (likely re-fails same way); (b) `wmic`-based
  tree walker (same shell-out failure modes). Held as v1.3.x ship
  target alongside `shell: false` migration.

#### 6.18.4 Long-idle session purge (NEW in v1.2.5, external audit round-4 §4.2 closure)

**Trigger.** §6.18 `session_sweep` finalized stale sessions but did not
remove on-disk artifacts. Long-term cumulative disk exhaustion possible
even with §6.18.2 per-file cap (many sessions × 64 KiB = MB scale over
years).

**Contract.** `session_sweep` accepts an optional `delete_files: boolean`
argument (default `false`). When `delete_files === true` AND
`dry_run === false`, after `finalizeIfUnset` succeeds, the session
directory MUST be physically removed via
`fs.rmSync(sessionDir, { recursive: true, force: true })`. Successfully
purged sessions appear in a new `purged` array of the response payload
with `{ session_id, deleted_path }`.

**Failure semantics.** Purge failure (EBUSY on Windows AV scan, EACCES
under restricted permissions, etc.) MUST log to host stderr but MUST NOT
undo the finalize. Outcome=`'aborted'` is the canonical state; on-disk
artifacts are best-effort cleanup, not part of the outcome contract.

**Backwards compatibility.** Default `delete_files: false` preserves
pre-v1.2.5 audit-trail behavior. Operators who explicitly opt in accept
that purged sessions are no longer readable via `session_read`.

**Out of scope.** Granular `keep_meta: true` mode (delete round artifacts
but preserve meta.json) is deferred to a future minor release.

**Test coverage.** `scripts/functional-smoke.js::driveV414SessionSweepDeleteFilesUnit`
asserts the dry-run path leaves files alone, the wet-run-no-delete path
preserves files, the wet-run-with-delete path removes the directory and
populates `purged`, and that locked sessions are never purged.

---

---

### 6.19 Convergence-health hint per round (NEW in v4.13)

**Trigger.** Audit §2.3: 5 sessions exceeded 5 rounds (max: 10 in
`94b2855b`). All eventually converged; `outcome: 'max-rounds'` was
never hit (no hard cap exists). No telemetry differentiated "deep
convergence on a hard topic" from "high round count without progress".

**Contract.** Every `ask_peer` and `ask_peers` round response carries
a `convergence_health` field with one of three string values:

| value | semantics |
|---|---|
| `'normal'` | iteration is in the typical productive range |
| `'extended'` | round count is unusually high; caller may consider whether continued iteration is productive |
| `'concerning'` | round count is far past typical convergence; caller SHOULD reconsider approach |

The same value MUST be persisted into `meta.rounds[i].convergence_health`
so audit aggregators can compute distributions.

**Spec defines contract, implementation chooses algorithm.**
Implementations MAY use round-count thresholds, status-pattern
detection, or both. The v1.1.0 canonical implementation is round-count
only; thresholds are pinned in code (`server.js`):

- rounds 1-5 → `normal`
- rounds 6-7 → `extended`
- rounds 8+ → `concerning`

Tuning these thresholds or adding pattern detection (e.g.,
READY↔NOT_READY oscillation) is implementation choice and does NOT
require a spec bump. Out of scope for v1.1.0: pattern detection.

**Caller obligation: PURELY ADVISORY.**

The signal is informational. The caller SHOULD consider whether
continued iteration is productive when `concerning`, but a hard topic
legitimately needs many rounds (the field-evidence `94b2855b` did, and
converged successfully at round 10). Spec wording: "SHOULD consider",
NOT "MUST step back". No automatic status, outcome, or peer-behavior
change is triggered by `convergence_health`.

**Backwards compatibility.** Pre-v4.13 rounds lack
`convergence_health` in persisted meta. Audit consumers MUST tolerate
`undefined` for legacy rounds.

---

### 6.20 Dynamic caller resolution (NEW in v4.14)

**Trigger.** A field-evidence session in 2026-04-26 surfaced that the
runtime was treating `CROSS_REVIEW_CALLER` env var as the
authoritative caller identity, even when the actual MCP host calling
the tool was a different agent. Specifically: a cross-review-mcp
instance configured with `CROSS_REVIEW_CALLER=claude` recorded
`meta.caller: 'claude'` even on a session opened by Gemini. The
operator's earlier directive (embryonic phase) was that the caller
should be dynamic — reflect who is actually calling, not a default.

**Audit consequence.** The 60-session audit's caller distribution
(claude 78% / codex 20% / gemini 2%) was partially artificial. An
unknown fraction of those 47 "claude-caller" sessions were
gemini-initiated but mis-recorded.

**Contract — resolution precedence (v1.2.12 simplified to two tiers).**
`session_init` MUST resolve the caller per call with this strict precedence:

1. **`args.caller`** (explicit override). If provided, it MUST be a
   valid agent (one of `VALID_AGENTS`). Invalid values throw before
   the session is created.
2. **`clientInfo.name` mapping.** If no explicit arg is provided, the
   server inspects the MCP `clientInfo.name` (captured during the
   `initialize` request) and applies a conservative substring-match:
   - contains `claude` → `claude`
   - contains `gemini` → `gemini`
   - contains `codex` → `codex`
   Names that do not match cleanly cause a per-call throw.

If neither tier resolves to a valid agent, `session_init` MUST throw
a per-call error naming both exhausted resolution sources and
referencing this section. The throw is scoped to the offending call,
NOT a startup crash — the server stays running so other valid sessions
can proceed.

**`CROSS_REVIEW_CALLER` env-var fallback removed in v1.2.12.** Pre-v1.2.12
the spec defined a third tier (`CROSS_REVIEW_CALLER` env var) as
last-resort fallback. That tier defeated the dynamic-caller principle:
the AI model that calls the tool MUST declare its own identity per call,
never via operator-configured env state. Operator-configured fallback
also produced "lying logs" (server affirmed `caller=X` while the actual
session was driven by agent Y). Pre-v1.2.12 a stricter symptom emerged:
the server hard-failed at startup with exit code 1 if the env var was
unset, so the documented "fallback" was actually a startup hard
requirement, and the dynamic tiers above it could never run when the
operator removed the env var (the correct configuration). v1.2.12
removes the env-var tier entirely. Stale configs that still set
`CROSS_REVIEW_CALLER` trigger a one-shot startup deprecation notice on
stderr and are otherwise ignored — the server boots normally and
resolves caller via the two dynamic tiers above.

**Persisted audit field.** `meta.caller_resolution` MUST record:

```
{
  "source": "arg" | "client_info",
  "client_info_name": <the MCP clientInfo.name string, or null>
}
```

This lets audit consumers distinguish explicit-override sessions from
clientInfo-inferred sessions, and reconstruct WHY a given session was
attributed to a specific caller. The `"env_var"` source value was
retired in v1.2.12 along with the env-var tier.

**Per-session peers.** Peers MUST be computed dynamically from the
resolved caller via `peersForCaller(caller) = VALID_AGENTS - {caller}`
and stored in `meta.peers`. Probes (capability_snapshot) MUST run
against this dynamic peer set, not any env-var-derived global. Round
spawning (`ask_peer` / `ask_peers`) MUST read caller and peers from
`meta`. v1.2.12 removed the module-level `CALLER`/`PEERS`/`LEGACY_PEER`
constants and exports — handlers MUST validate `meta.caller` against
`VALID_AGENTS` and throw on missing/invalid (no silent fallback).

**`ask_peer` legacy bilateral.** `ask_peer` is a legacy bilateral
surface gated to caller=`claude` or `codex` (via `LEGACY_BILATERAL_PEER`
table). The gate is checked against `meta.caller`. A gemini-resolved
session calling `ask_peer` MUST be rejected with the existing error
message.

**Backwards compatibility.** Pre-v4.14 sessions lack
`meta.caller_resolution`; audit consumers MUST tolerate the absence.
Hosts with stale `CROSS_REVIEW_CALLER` env vars in their MCP config
continue to work in v1.2.12 — the env var is read only to emit a
one-shot deprecation notice and then ignored; identity is resolved
strictly via the two dynamic tiers.

**Anti-drift smoke (v1.2.0 release discipline).** A new functional
smoke step asserts README.md's `Current release: **vX.Y.Z**` line
matches `server.VERSION`, and that the spec banner version is
mentioned in README at least once. This prevents the v1.0.4/v1.0.5
recurrence (releases shipped while README stayed at v1.0.3). Future
releases that forget README sync fail the gate.

---

### 6.21 Shell-spawn architecture decision (NORMATIVE in v4.14, v1.2.5+)

The runtime spawns peer CLIs with `shell: true`. This is a deliberate
architectural decision recorded normatively to retire repeated audit
findings flagging it as a theoretical RCE risk (rounds 1–4 of the
external Gemini-orchestrated audit all re-flagged this).

**Rationale.**

1. **Windows path resolution.** Peer CLIs typically ship as `.cmd`
   shims on Windows (`gemini.cmd`, `codex.cmd`); spawning with
   `shell: false` would require manual PATHEXT iteration in
   `peer-spawn.js`.
2. **Cmd-line provenance.** The cmd string is built exclusively from
   pinned constants in `peer-spawn.js` (`CODEX_MODEL`, `CLAUDE_MODEL`,
   `GEMINI_MODEL`, `CODEX_REASONING_EFFORT`) plus configuration entries
   from `reviewer-configs/peer-exclusions.json` (a repo-tracked,
   operator-edited file — NOT request-surface and NOT caller-controllable).
   Caller-supplied content (the `prompt` field of `ask_peer` /
   `ask_peers`) flows via `proc.stdin.write(prompt)` and NEVER reaches
   the shell command line.
3. **Threat model.** This server runs LOCAL on a single operator's
   workstation. The runtime threat perimeter is defined by the host
   environment, NOT by the source's open-source distribution. Public
   GitHub does not change which user the MCP server runs as. Shell
   injection requires an attacker capable of either repo-write OR local
   filesystem write to `reviewer-configs/peer-exclusions.json` BEFORE
   a triggered spawn — at which point the attacker already has
   privileges that subsume shell injection.

**Out of scope (deferred to future major).** Migration to
`shell: false` with explicit arg arrays + Windows PATHEXT lookup logic.
Tracked but not field-evidence prioritized.

**Audit guidance.** Reports flagging `shell: true` SHOULD reference
this section and engage the rationale specifically (caller-input flow,
repo trust model, Windows path constraints). Repeating the finding
without engaging the rationale is non-yielding under the §6.14
evidence-rigor discipline.

---

### 6.22 Lock & session resilience (NEW in v1.2.15)

**Trigger.** Operator-reported incident on 2026-04-27: a cross-review-mcp
instance was killed by the host (Claude Code reload) mid-`ask_peers`,
leaving the session's `.lock` directory present on disk with no live
holder process. The next attempt to operate on that session_id was
refused with "session locked by another process (TTL 1h)" until either
manual `rm -rf .lock` or the 1h TTL passed. Two such locks accumulated
in `~/.cross-review/` over a single working session. Concurrently, the
peer-CLI subprocesses spawned for the killed session continued running
(orphans), consuming API tokens until the LLM call finished — the
per-peer 30min watchdog could not fire because the parent process that
held the watchdog timer was already dead.

**Contract — eight items (A–H).** v1.2.15 closes the resilience gap
with a layered defense; each item is independently verifiable and
backward-compatible.

**(A) Configurable lock TTL.** `LOCK_TTL_MS` is read from the
`CROSS_REVIEW_LOCK_TTL_MS` env var at module-load time. Default
reduced from 60min (pre-v1.2.15) to 5min, aligned with the typical
duration of a trilateral round (~3-5min). Invalid or absent env values
fall back to default. Operator override is permitted upward (extended
debug sessions) or downward (aggressive recovery), with positive
integer validation.

**(B) Startup lock sweep.** `sweepStaleLocksOnBoot()` walks every
`~/.cross-review/<uuid>/` whose name matches `UUID_RE`, reads each
present `.lock/info.json`, and removes the lock when the holder pid is
dead OR when `acquired_at` exceeds `LOCK_TTL_MS`. Idempotent + best
effort: errors are logged to stderr but never propagate. Wired in
`server.js main()` via `setImmediate` AFTER `server.connect(transport)`
so the MCP `initialize` handshake response is never delayed by the
sweep work. Returns `{ scanned, removed }` for telemetry. Test/CI
environments opt out via `CROSS_REVIEW_SKIP_BOOT_SWEEPS=1`.

**(C) PID liveness probe in acquireLock.** `isPidAlive(pid)` is a
cross-platform helper: Windows uses `tasklist /fi "PID eq <n>" /nh /fo
csv` parse; POSIX uses `process.kill(pid, 0)` (signal 0 is a
"is process alive" probe with no actual signal delivery). Conservative
on uncertainty: probe failure (permission denied, exec timeout) returns
`true` so the TTL still acts as backstop. Inside `acquireLock`, when an
existing `.lock/info.json` is found:
1. If holder pid is dead → release immediately, log audit line.
2. Else if `age > LOCK_TTL_MS` → release as stale, log audit line.
3. Else refuse — holder is alive and recent.

This makes the recovery time after host-kill bounded by the next
`acquireLock` call rather than the full TTL.

**(D) Pending-session discovery in session_init.**
`findPendingSessionsForCaller(caller, limit=5)` walks `~/.cross-review/`
for sessions where `meta.caller === caller`, `meta.outcome === null`,
and last activity timestamp older than `PENDING_THRESHOLD_MS` (default
10min, env override `CROSS_REVIEW_PENDING_THRESHOLD_MS`). Returns up
to `limit` rows oldest-first, each with: `session_id`, truncated
`task` (≤120 chars), `rounds_completed`, `last_activity` (ISO),
`idle_seconds`, and `locked` (boolean indicating if `.lock` is
present). The `session_init` response includes a `pending_sessions`
field when the array is non-empty (advisory; absent when empty). The
new session is fully usable regardless — caller decides whether to
finalize the pending sessions, resume them, or ignore.

**(E) Half-written round detection + archive.**
`findHalfWrittenRounds(sessionId, expectedPeers)` scans the session
directory for rounds where `round-NN-prompt.md` exists but no
`round-NN-peer-<agent>.md` for any expected peer. Such rounds were
written when `ask_peers` persisted the prompt as the first step but
the round never completed (parent killed mid-spawn). Returns
`[{ round, missing_peers }]`. `archiveOrphanedRoundPrompt(sessionId,
roundNum)` renames `round-NN-prompt.md` to
`round-NN-prompt.orphan-<iso-ts>.md`, preserving the audit trail while
allowing the active round numbering to advance cleanly. `ask_peers`
runs this scan + archive AFTER acquiring the lock and BEFORE
`savePromptForRound`, so each new round starts on a clean slate.
Partial rounds (at least one peer responded) are NOT archived — the
caller still has actionable state.

**(F) Round-level + per-peer timeouts.** `spawnPeer`'s per-peer
hard timeout is configurable via `CROSS_REVIEW_PEER_TIMEOUT_MS` (or
per-call `options.timeoutMs`); default reduced from 30min →
**8min**, aligned with observed real-world peer latency (3-9min
typical). New `spawnPeers` round-level timeout via
`CROSS_REVIEW_ROUND_TIMEOUT_MS` (default **12min**) wraps the entire
batch with a wall-clock cap. On round-timeout, unresolved peers are
force-resolved with `failure_class: 'round_timeout'`,
`recovery_hint: 'retry_round'`, `round_timeout_ms: <ms>`. Peers that
responded in time keep their results; the partial round survives the
timeout. The round-timeout watchdog uses `setTimeout(..., ms).unref()`
so it never holds the event loop alive past a successful all-resolved
case.

**(G) Configurable session_sweep min-age floor.** `SWEEP_MIN_AGE_MS`
is read from `CROSS_REVIEW_SWEEP_MIN_AGE_MS` env var at module-load
time. Default unchanged at 24h (the v4.13 footgun guard).
Override values below 60s are clamped up to 60s to keep some
footgun protection; override is logged at boot to make the
relaxation visible. Use case: aggressive cleanup of stuck sessions
immediately after a host-kill incident; reset the env var after
recovery.

**(H) Startup orphan peer-CLI sweep.** `sweepOrphanPeerProcesses()`
enumerates running processes via `Get-CimInstance Win32_Process`
(Windows) or `ps -eo pid,ppid,args` (POSIX), each via
`util.promisify(exec)` so the boot path stays responsive while OS
enumeration is in flight. For each process whose command-line argv
matches a peer-CLI signature (`codex exec`, `gemini -p`/`--prompt`,
`claude code`/`--print`/`-p`), the parent is looked up:
- If the process is a descendant of the current cross-review-mcp pid →
  skip (active management).
- Else if parent is a live Node process running
  `cross-review-mcp/src/server.js` → skip (sibling instance).
- Else (parent dead OR alive but unrelated) → classify as orphan and
  kill via `killProcessTree({ pid })` (Windows: `taskkill /T /F`;
  POSIX: best-effort `proc.kill('SIGKILL')`).

Conservative: ambiguous parent metadata is treated as legitimate
operator usage. The per-peer timeout still bounds future orphan
windows; this sweep cleans up the historical residue. Wired alongside
the lock sweep in `server.js main()` via `setImmediate`. Returns
`{ scanned, killed, candidates }` for telemetry. Opt-out via
`CROSS_REVIEW_SKIP_BOOT_SWEEPS=1`.

**Backwards compatibility.** All defaults are conservative and
strictly more permissive than pre-v1.2.15: shorter TTLs are released
auto-recovery faster, shorter timeouts surface failures faster, the
new helpers are pure additions. Pre-v1.2.15 sessions remain readable
without migration. The only externally-observable schema change is
the optional `pending_sessions` field on `session_init` response,
which is absent when the resolved caller has no pending sessions.

**Test coverage.** 8 unit-level smoke invariants in `functional-smoke.js`
(one per item), executed under `CROSS_REVIEW_SKIP_BOOT_SWEEPS=1` so
the orphan sweep doesn't scan the host process table during CI. Each
invariant validates structural presence + behavior on synthetic
fixtures; end-to-end behavioral coverage of the boot-sweep path is
deferred to a future v1.2.x release that adds a child-process harness
which spawns a parent-mcp + peer pair, kills the parent, and asserts
the next mcp boot cleans the orphan.

---

## 7. Summary of conventions for immediate use (UPDATED through v4.10)

| Convention | Caller action |
|------------|---------------|
| Session opening | ASCII-only transcript + scope clause + artifacts with fingerprint; mandatory ultrathink/code-reasoning trace pre-session_init (section 6.9.1) |
| STATUS contract | Reiterate template in every prompt; structured block preferred with optional v4 expanded schema (2.3.1), legacy fallback accepted; both tail-anchored |
| Optional fields | Omit-unless-signal: `uncertainty`/`caller_requests`/`follow_ups` only when the value changes the reading of the parecer |
| Dynamic validation | Proactive matrix; answer peer CALLER_REQUEST with NEEDS_EVIDENCE |
| Scope | FOLLOW-UP for out-of-scope; aborted for honest non-convergence |
| Noise | Consume content + peer_status + peer_structured + status_source + parser_warnings + peer_model |
| Warnings | `parser_warnings` is not dead telemetry: inspect and act (peer drift or schema violation) |
| Model | Peer always invoked with top-level (codex=gpt-5.5 xhigh, claude=claude-opus-4-7, gemini=gemini-3.1-pro-preview); no silent fallback; advisory drift audit via `npm run check-models` (section 6.9.2.1) |
| Encoding | ASCII-only on disk; peer exchange and internal artifacts in en-US (section 6.10 v4.6); only assistant-to-user chat and historically-sealed entries remain pt-BR |
| Continuity | Optional ledger (section 6.5); when adopted, keep ASCII-only and attach on subsequent sessions |
| Overflow | Yellow 50k / Red 100k chars in the transcript (section 6.6.1); non-destructive compression (section 6.6.4) with reference to the immutables; meta.json with no API change (section 6.6.3 YAGNI) |
| Transition window | During server upgrade, peer emits both formats until reload is confirmed |
| Triangular topology | `ask_peer` bilateral legacy remains; `ask_peers` N-ary introduced in F2 -- alpha normative (section 2.7); unanimity convergence (section 6.3); display names externally ("Claude Code" / "ChatGPT Codex" / "Gemini"); canonical ids internally (claude / codex / gemini); caller resolved dynamically per call via `args.caller > clientInfo.name` with no hardcoded default and no env-var fallback (section 2.8 / §6.20, simplified to two tiers in v1.2.12) |
| Tier + transient resilience | Pre-session capability probe per agent with per-provider `fallback_chain` walk (6.9.3.1, 6.9.3.2); graceful degrade triangular -> bilateral when exactly one peer is excluded, abort only when <2 peers viable (6.9.3.3); session-level `meta.capability_snapshot` + active-peer-only rounds (6.9.3.4; `tier: ok \| offline` canonical in v4.9, retiring `fallback`); dual runtime vs advisory role of top-models.json (6.9.3.5); mid-round transient provider failures (prompt flag / rate limit / 5xx) treated with same-model retry-once-with-backoff; server-side auto-rephrase prohibited; silent mid-round model switch remains prohibited (6.9.3.6); `transient_failure` enum in response distinguishes transient from protocol failure |
| Transport-aware model-check | `spawnPeer` / `probeAgent` return `transport_descriptor: { agent, auth, endpoint_class }` (6.11); `parsePeerOutputs` gate on `auth === 'api-key'` runs `classifyModelMatch`; otherwise SKIP with audit record `model_check_skipped: { reason: 'unreliable_text_self_report_on_cli', auth, endpoint_class }` (eliminates v0.5.0-alpha false-positive `silent_model_downgrade` on CLI-subscription / oauth-personal peers); forensic-only `cli_attested_model_raw` captures Codex stderr banner unparsed |
| Strict-only convergence + snapshot | `converged iff caller READY AND every responded peer READY` (6.12); `status_missing` counts AGAINST; no loose toggle; `appendRound` persists `round.convergence_snapshot` with `spec_version: 'v4.9'`; `checkConvergence` reads the persisted snapshot (audit immutability under future predicate evolution) |
| Rate-limit class | New `rate_limit_induced_response` orthogonal to `silent_model_downgrade` (6.13); provider-shaped lexeme set excludes generic `{rate, quota, limit}`; spawn-level via non-zero exit + stderr match -> `saveFailedAttempt` + `retry_after_seconds`; response-level requires ALL THREE (status block absent + body < 200 chars + lexeme match); `retry_after_seconds` parsed from `Retry-After: N` when present, `null` otherwise (NEVER fabricated); `ask_peers` + `ask_peer` surface `rate_limited_peers[]` |
| Anti-hallucination | Tail directive extended with NEEDS_EVIDENCE-first + exhaustive-search language (6.14); optional `confidence: 'verified' \| 'inferred' \| 'unknown'` and `evidence_sources: [string]` on structured status block; hard-pair rule `confidence='unknown'` MUST pair with `status='NEEDS_EVIDENCE'` (parser warning on violation); advisory warning when `confidence='verified'` has empty `evidence_sources`; new MCP tool `escalate_to_operator(session_id, question, context)` persists under `meta.escalations[]`; caller orchestrator surfaces to operator via chat |
| CLI banner as authoritative attestation | Codex CLI stderr banner `model: <id>` promoted from v4.9 forensic-only to AUTHORITATIVE for cli-subscription transports when parseable (6.11 amendment); banner MATCH -> `cli_banner_attested: true` audit elevation; banner MISMATCH -> `model_failure_class: 'cli_banner_attestation_mismatch'` + `protocol_violation: true` hard gate (NOT retried); absent/unparseable banner -> v4.9 `model_check_skipped` path unchanged; Claude CLI banner parsing deferred to v0.8+; oauth-personal has no banner equivalent, stays on §6.11 skip |

---

## 8. Criterios de aceitacao (atualizados em v4.11)

**Regra editorial normativa (NOVO em v4.5):** Entradas nesta secao que usem
linguagem de aprovacao bilateral, incluindo "Spec vX.Y foi aprovada
bilateralmente...", SO PODEM ser gravadas em disco apos READY bilateral
confirmado na sessao cross-review referenciada, com
`session_check_convergence` retornando `converged=true`. Durante a sessao
(pre-sealing), a entrada deve usar "em revalidacao bilateral (sessao XXX,
iniciada DATA)" ou equivalente. A promocao de "em revalidacao" para
"aprovada bilateralmente" exige edit separado pos-sealing. Esta regra nao
reescreve retroativamente entradas historicas ja seladas. Historico
empirico: aplicado de facto em v4.1 (a847f897), v4.2 (f1fdbee4), v4.3
(9c56005b); pulado em v4.4 (bd8c3cfb). Esta clausula remedia a
inconsistencia.

- Spec v4 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review 08cd61e6 (2026-04-24, 2 rodadas).
- Spec v4.1 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review a847f897 (2026-04-24). v4.1 eh revisao spec-only de v4 --
  nao toca em codigo.
- Spec v4.2 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review f1fdbee4 (2026-04-24). v4.2 eh revisao spec-only de v4.1
  promovendo §6.7 (matriz minima de evidencia) de FOLLOW-UP para
  normativa -- nao toca em codigo.
- Spec v4.3 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review 9c56005b (2026-04-24, 4 rodadas). v4.3 adiciona secao
  6.9.2.1 (auditoria de drift de modelo, advisory-only) e introduz
  tooling complementar (`docs/top-models.json` +
  `scripts/audit-model-drift.js` + npm script `check-models`) SEM
  alterar runtime de peer-spawn.js nem processo de troca de modelo
  definido em secao 6.9.2.
- Spec v4.4 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review bd8c3cfb (2026-04-24, 2 rodadas). v4.4 eh revisao
  spec-only de v4.3 formalizando a suspensao por YAGNI do follow-up
  "Schema v5 com objetos" de 08cd61e6 -- nao toca em codigo, nao muda
  o contrato do bloco estruturado, nao altera parser. Registra criterio
  de reabertura baseado em falha concreta v4-era.
- Spec v4.5 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review 843d57eb (2026-04-24, 3 rodadas). v4.5 eh revisao
  spec-only de v4.4 adicionando preambulo normativo no inicio desta
  secao formalizando o padrao "em revalidacao bilateral -> aprovada
  bilateral" registrado como follow-up na sessao f1fdbee4. SPEC-only
  -- nao toca em codigo, nao muda API, nao altera parser. A propria
  promocao desta entrada de "em revalidacao bilateral" para "aprovada
  bilateralmente" foi feita em edit separado pos-sealing, honrando
  auto-demonstrativamente a clausula que esta entrada estabelece.
- Spec v4.6 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review b1700438 (2026-04-24, 5 rodadas). v4.6 adds new section
  6.10 "Language policy for peer exchange and internal artifacts" and
  authorizes bulk translation of existing pt-BR non-user-facing content
  to en-US under this clause. SPEC-only plus subsequent bulk-translation
  commits that reference v4.6 section 6.10 as authority; core runtime
  (src/server.js, src/lib/*.js, scripts/functional-smoke.js) remains
  unchanged. This entry is written in pt-BR because it takes its place
  among the historically-sealed section 8 entries authored in pt-BR
  (v4-v4.5); from v4.7 onward, new section 8 entries MAY be authored
  in en-US per section 6.10.
- Spec v4.7 was **bilaterally approved** (Claude Code + ChatGPT Codex)
  in cross-review session 4b799098 (2026-04-24, 4 rounds,
  outcome=converged). v4.7 is a spec-only additive revision of v4.6
  that introduces the triangular topology extension (new section 2.7),
  dynamic role assignment (new section 2.8), display-names-vs-canonical-ids
  convention (new sub-section 5.1), N-ary convergence rule (update to
  section 6.3), and Gemini top-tier model pin
  `gemini-3.1-pro-preview` (update to section 6.9.2). Extension is
  ADDITIVE: `ask_peer` bilateral legacy stays fully functional;
  `ask_peers` N-ary is new and will ship in v0.5.0-alpha code via a
  separate follow-up session (F2 impl). The promotion of this entry
  from "em revalidacao bilateral" to "aprovada bilateralmente"
  happened in a separate post-sealing edit composed in the same
  commit, honoring the v4.5 preamble rule self-demonstratively. This
  entry is authored in en-US per section 6.10 authorization for
  section 8 entries from v4.7 onward.
- Spec v4.8 was **bilaterally approved** (Claude Code + ChatGPT Codex)
  in cross-review session 5fce39ce (2026-04-24, 5 rounds,
  outcome=converged). v4.8 is a spec-only additive revision of v4.7
  that introduces section 6.9.3 "Subscription tier resilience and
  transient failure handling" with six subsections (pre-session
  capability probe, fallback chain in top-models.json, graceful
  degradation rules, session-level capability snapshot, interaction
  with 6.9.2.1, mid-round transient failure handling), a clarification
  paragraph in section 6.9.2 scoping "NO silent fallback" to mid-round
  behavior, a new Section 7 resilience row, and a top-models.json
  `schema_version: 2` bump with per-provider `fallback_chain` (F2
  populates concrete model ids). Scope absorbs three operator
  directives captured mid-session 5fce39ce: D3 persistent tier
  downgrade (subscription plan changes), D4 provider moderation
  flagging and rate limiting, D5 outages/overload. All three share
  the invariant "cross-review-mcp must not stop due to provider-side
  conditions it can reasonably handle" while preserving section 6.9.2
  "NO silent fallback" for mid-round model switching. Code remains
  v0.4.0-alpha; the integrated F2 impl session delivers v0.5.0-alpha
  absorbing both v4.7 triangular extension and v4.8 probe + degrade
  + retry mechanisms, per operator's preference for a single reload.
  The promotion of this entry from "em revalidacao bilateral" to
  "aprovada bilateralmente" happened in a separate post-sealing edit
  composed in the same commit, honoring the v4.5 preamble rule
  self-demonstratively. Authored in en-US per section 6.10.
- Spec v4.9 was **trilaterally approved** (Claude Code + ChatGPT Codex
  + Gemini CLI) in cross-review session c9508617 (2026-04-24, 3 rounds,
  outcome=converged, 3/3 READY). v4.9 is a spec + code revision of
  v4.8 that introduces three normative sections (6.11 transport-aware
  model-check discipline, 6.12 strict-only convergence with persisted
  snapshot, 6.13 rate-limit class distinct from silent-downgrade) and
  retires the ambiguous probe `tier: 'fallback'` in favor of canonical
  `tier: 'ok' | 'offline'`. v4.9 ships integrated with code release
  v0.6.0-alpha in a single commit — the spec and the implementation
  pass trilateral gates together. Items deferred to v4.10 / v0.7+ by
  operator directive 2026-04-24: anti-hallucination safeguards,
  open-source readiness (LICENSE / README / SECURITY), CLI stderr
  banner promoted from forensic-only to authoritative attestation.
  This entry is authored in en-US per section 6.10. Session c9508617
  is also the first trilateral design session where the full tri-tool
  stack (ultrathink + code-reasoning + spawnPeer) operated end-to-end
  without any silent fallback under the billing-veto constraint of
  CLI-only peer transport (`feedback_subscription_over_api_billing`).
- Spec v4.11 is a **spec-only** revision of v4.10 shipped on
  2026-04-24 resolving the "Claude CLI stderr banner parsing"
  follow-up registered in v4.10 as deferred to v0.8+. Resolution is
  NEGATIVE: empirical survey against Claude CLI 2.1.119 across three
  probe variants (valid pin + `--verbose` diagnostic + invalid-pin
  error path) shows 0 bytes on stderr in every case. The §6.11
  `model_check_skipped` discipline is the correct handling and is
  already live in v0.7.0-alpha runtime without modification. v4.11
  touches NO code and NO test coverage; `parsePeerOutputs` in
  v0.7.0-alpha already falls through correctly when
  `cliAttestedModel` is null (Claude's case). No version bump.
  Authored in en-US per section 6.10. The "closed as negative
  result" status is explicit — future Claude CLI versions may
  introduce a banner channel, in which case a new spec revision and
  code addition can reopen the item. No need to revisit otherwise.
- Spec v4.10 is an **implementation-ratified** revision of v4.9,
  executing the two deferred scope items already approved in session
  c9508617's v4.9 design convergence: Item D (anti-hallucination /
  epistemic discipline, new section 6.14) and Item E (CLI banner as
  authoritative attestation, amendment to section 6.11). v4.10 ships
  integrated with code release v0.7.0-alpha in a single commit on
  2026-04-24. No new trilateral design session was opened — the
  scope was pre-ratified in c9508617, and the operator directive
  2026-04-24 explicitly requested landing the deferred items without
  delay ("implemente logo tudo o que esta faltando e que ja foi
  planejado"). This entry uses the "implementation-ratified" status
  label rather than "bilaterally/trilaterally approved" to preserve
  the v4.5 preamble rule's spec-session integrity: v4.10 has no new
  design session on disk, but its scope is contained entirely within
  the approved v4.9 deferral set. Future revisions that introduce
  NEW design decisions (not pre-ratified) MUST open a new trilateral
  or bilateral session per the v4.5 preamble. Open-source readiness
  (LICENSE, SECURITY) was also in the deferred set and is confirmed
  already-in-place at v0.7.0-alpha (AGPLv3 per workspace default,
  SECURITY.md present); no v4.10 code change needed. Authored in
  en-US per section 6.10.

Once accepted and published:
- Replaces the prior revision in-place.
- Referenced as the active spec in new sessions.
- Frozen until a new spec session is opened (no silent amend).

Follow-ups post-v4.7 (registered but out of scope for this release):
- **Topology beta (within-round peer-to-peer cross-talk, section 2.7)**:
  deferred. Reopening criterion: a concrete case where a peer's
  analysis materially depends on another peer's response and the
  alpha workflow cannot express it.
- **`--allowed-mcp-server-names` empty-array semantics for Gemini CLI
  spawn** (section 6.9.2 v4.7 addition): F2 empirical item. Test
  order during F2 impl: (1) omit flag first; (2) explicit known
  allowlist if omission fails; (3) empty-array fallback only if
  necessary. Result documented in the F2 commit message.
- **Legacy `meta.json` schema coexistence** (section 6.3 v4.7
  addition): F2 impl invariant. `checkConvergence` in v0.5.0-alpha
  MUST normalize legacy scalar `peer` / `peer_status` fields as a
  1-element peers array at read time; no on-disk migration required.
- **Subscription tier resilience and pre-session capability probe
  (DEDICATED v4.8 SCOPE)**: user directive 2026-04-24 (mid-session
  4b799098): "cross-review must be dynamic and smart enough to
  handle subscription tier changes without stopping operation; must
  have a smart mechanism to check the state of agents' subscriptions
  before each session, so it can operate at its maximum capacity".
  Reconciles the existing section 6.9.2 "NO silent fallback" rule
  (which addresses transient runtime failure) with a new persistent
  tier-downgrade class: the user might reduce an agent's plan
  (premium -> free or intermediate), losing access to top models,
  higher quotas, or agent-capable modes altogether. The system must
  anticipate these cases and continue operating. Recommended design
  sketch (non-normative, to be debated in the v4.8 session):
  pre-session model-availability probe via cheap CLI ping; ordered
  fallback chain per provider in `docs/top-models.json`;
  `meta.json.rounds[i]` records detected capability per peer;
  session proceeds with whatever agents remain viable (triangular
  degrades to bilateral if one provider becomes unavailable;
  session aborts only if fewer than 2 agents remain). Silent
  mid-round fallback remains prohibited; tier-induced degradation is
  explicitly detected, audited, and communicated at session_init
  time. v4.8 is the spec revision dedicated to this scope; a
  separate cross-review session will ratify the design before any
  code work.
- Defensive pre-spawn existence check (abort-only if the pinned model
  is deprecated by the provider): registered as a separate follow-up
  in session 9c56005b; out of scope for section 6.9.2.1 which is
  exclusively advisory. May be superseded by v4.8 subscription-tier
  resilience design.
- Normalize historical non-ASCII drift (U+00A7) in
  docs/workflow-spec.md -- effectively RESOLVED in commit ffee38d
  (Phase B3 bulk translation under v4.6 section 6.10). Pre-v4.6 count:
  24 occurrences; post-v4.6 count: 1 occurrence, located inside the
  v4.2 section 8 sealed entry ("promovendo section 6.7 (matriz..."),
  which is non-retroactive per section 6.10 exception (b). No further
  housekeeping is needed; the remaining occurrence is preserved by
  design.
- Schema v5 with objects for `caller_requests`/`follow_ups` instead of
  arrays of strings -- SUSPENDED by YAGNI in session bd8c3cfb
  (2026-04-24, outcome=converged in 2 rounds). Empirical evidence: v4
  parser in use since the VS Code reload on 2026-04-24; zero
  string-inadequacy signals emitted by the v4-era peer in session
  9c56005b (8 caller_requests/follow_ups, all actionable strings);
  peer Codex could not name ONE v4-era caller_request that failed due
  to string limitation. The literal precondition from the original
  follow-up registered in 08cd61e6 ("if strings prove insufficient in
  real use" + "not prioritized until a concrete use case emerges")
  remains unsatisfied. Reopening criterion: a v4-era peer naming one
  concrete caller_request that has FAILED due to string limitation
  (substance not transmitted, ambiguity causing an extra round,
  non-actionable guidance). "Could be better as an object" does NOT
  count. Existing test coverage: `STRUCTURED_V4_NON_STRING_ITEM` in
  functional-smoke documents drop + indexed warning for non-string
  items, confirming the current behavior is intentional.
