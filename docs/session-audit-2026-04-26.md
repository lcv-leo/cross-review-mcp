# Cross-Review MCP Session Audit — 2026-04-26

**Scope.** All 60 sessions in `~/.cross-review/<session-id>/meta.json` as of
2026-04-26. Generated via `/tmp/audit-sessions.js` aggregator over the
canonical session-store layout described in `src/lib/session-store.js`.

**Methodology.** Walks each session's `meta.json`, extracts outcomes, round
counts, failure classes, transport descriptors, and protocol violations.
Aggregates across the corpus to find structural patterns. No prompt content
is read (privacy) — only the structural metadata.

**Companion artifact.** This document drives the v1.0.5 release: §6.16
prompt-flag recovery contract is the headline fix, and findings 2-7 below
are scoped as follow-ups for v1.1+ planning.

---

## 1. Headline numbers

| Metric | Value |
|--------|-------|
| Total sessions | 60 |
| Total rounds | 177 |
| Avg rounds/session | 2.95 |
| Outcome=converged | 48 (80.0%) |
| Outcome=aborted | 5 (8.3%) |
| Outcome=in_progress (orphan) | 7 (11.7%) |
| Outcome=max-rounds | 0 (0%) |
| Topology=triangular | 32 (53%) |
| Topology=bilateral | 28 (47%) |
| Fast-converge (1-round) | 3 (5%) |

**Read.** 80% convergence rate is healthy. The 8.3% abort rate is dominated
by intentional aborts (peer scope creep rollback, 0-round probes); only
1 of 5 aborts was a real system failure (the moderation-flag case that
v1.0.5 §6.16 fixes).

---

## 2. Findings — actionable

### 2.1 Prompt moderation flags (FIXED in v1.0.5 §6.16)

**Observation.** 3 sessions had a peer rejected by OpenAI's moderation
classifier on reasoning-model prompts:
`6cf09af3-163c-49c2-98ae-435e6c62a686`, `70d1d349-3ea2-45aa-a60a-303b9398e44a`,
`fca13b80-14c7-456d-bedf-4ede16646e24` (all 2026-04-24).

**Impact.** 1 session went to `outcome: aborted`; 2 recovered after the
operator manually reformulated and resubmitted (proof that the recovery
path works — now codified into the spec).

**Trigger pattern.** Technical engineering prose containing combinations of
"adversarial", "exploit", "silent_downgrade", "protocol_violation",
"jailbreak", or detailed model-introspection language reading as
circumvention to the classifier. Content was benign; trigger was vocabulary.

**Status.** v1.0.5 / spec v4.12 §6.16 adds:
- `failure_class: 'prompt_flagged_by_moderation'` (distinct from
  `spawn_rejected` and `rate_limit_induced_response`).
- `recovery_hint: 'reformulate_and_retry'`.
- Embedded `reformulation_advice` in tool response.
- Caller obligation: reformulate up to 5 times before escalating; **do
  NOT abort**.
- `detectPromptModerationFlag` exported + tested in functional smoke (step
  126).

### 2.2 Orphan `in_progress` sessions (workflow hygiene)

**Observation.** 7 sessions left without `session_finalize` call. 4 are
0-round probes (operator opened then closed without invoking ask_peer/s);
3 have actual rounds but were abandoned (`47c12ade`, `608824ca`,
`d425cd29`).

**Impact.** Locks may be stale; session_store directory grows; audit
trail unclear about whether work was abandoned or completed elsewhere.

**Recommendation (v1.1 candidate).** Add a `session_sweep` admin tool that
lists sessions older than N days without a finalized outcome and offers
batch finalization with `outcome: 'aborted'` + `outcome_reason: 'stale'`.
Alternatively, runtime auto-finalize on session-store load when last
round is >7 days old.

### 2.3 Long sessions (no soft cap)

**Observation.** 5 sessions exceeded 5 rounds (max: 10 rounds in
`94b2855b`). All converged eventually. `outcome: 'max-rounds'` was never
hit — the spec doesn't define a hard cap.

**Impact.** Round 7+ may indicate thrashing rather than productive
review. No telemetry differentiates "deep convergence" from "stuck loop".

**Recommendation (v1.1 candidate).** Add a soft-cap signal at round 6+: a
new optional field in the round response, `convergence_health: 'normal' |
'extended' | 'concerning'`, computed from delta between consecutive rounds'
status patterns. Caller can use it as a hint to step back and reformulate.

### 2.4 `spec_version` not recorded in `meta.json`

**Observation.** No session in the corpus has `meta.spec_version` set.
Audit reconstructions cannot determine which spec rules were active when
a given session ran.

**Impact.** Cross-version comparisons (e.g., "did v4.11's transport bypass
reduce silent_model_downgrade rate?") require code archaeology of the
git log instead of being a simple meta query.

**Recommendation (v1.1 candidate).** Persist `spec_version` (e.g., `'v4.12'`)
into `meta.json` at `session_init` time. Trivial change in
`session-store.js::createSession`.

### 2.5 `chatgpt-pro-backend` transport with `protocol_violation`

**Observation.** 1 protocol_violation recorded with
`transport_descriptor.endpoint_class = 'chatgpt-pro-backend'`. Under
spec §6.11 (v4.9), this transport class should have the strict
model-check **bypassed** (it's a cli-subscription endpoint without
authoritative model attestation), so a violation should not be raised.

**Impact.** Single-occurrence; could be a pre-bypass-fix session or a
real bypass leak. Needs forensic investigation.

**Recommendation (v1.1 candidate).** Add a smoke step that constructs a
synthetic chatgpt-pro-backend descriptor and asserts
`model_check_skipped` is set + `protocol_violation` is `false` regardless
of model_match outcome. If the test passes, the historical violation is
pre-bypass; if it fails, there's a leak in the bypass logic to fix.

---

## 3. Findings — observational

### 3.1 Caller distribution heavily skewed to claude

| Caller | Sessions | % |
|--------|----------|---|
| claude | 47 | 78% |
| codex | 12 | 20% |
| gemini | 1 | 2% |

The operator's primary IDE driver is Claude Code, so this is expected.
The single gemini-as-caller session indicates the gemini integration
works end-to-end, but the asymmetry means gemini-as-caller may have
undiscovered friction. **Not a recommendation** — just an observation
for future expansion.

### 3.2 NEEDS_EVIDENCE moderate use

19 NEEDS_EVIDENCE statuses across the corpus. The state exists and is
used, but appears underleveraged given that 32% of rounds had a peer
return NOT_READY without a structured CALLER_REQUEST. Future sessions may
benefit from peers being more willing to emit NEEDS_EVIDENCE when an
artifact is genuinely missing rather than degrading to NOT_READY.

### 3.3 Most sessions need 2-4 rounds

| Round count | Sessions |
|------------|----------|
| 0 | 7 (probes) |
| 1 | 5 |
| 2 | 15 |
| 3 | 13 |
| 4 | 9 |
| 5 | 6 |
| 6+ | 5 |

Distribution is right-skewed with mode at 2 rounds. Cross-review IS
doing review work — only 5% converge in one round, and most sessions
need 2-3 iterations.

### 3.4 Protocol violation breakdown by transport

Of 40 protocol violations with transport descriptor recorded:

| Transport endpoint_class | Violations |
|-------------------------|-----------:|
| (no descriptor — pre-v4.9) | 35 |
| `generativelanguage-v1beta` (Gemini api-key) | 4 |
| `chatgpt-pro-backend` (Codex cli-subscription) | 1 |

**Read.** 35 "no_descriptor" violations are legacy data from sessions
before v4.9 introduced the transport descriptor; they are mostly
false-positive `silent_model_downgrade` flags from runtime-only code that
hadn't yet been spec-codified. The 4 Gemini api-key violations are
expected (api-key transport correctly enforces strict check). The 1
Codex chatgpt-pro-backend violation is the §2.5 anomaly above.

---

## 4. Out of scope (future audits)

- **Round-content quality.** This audit only reads `meta.json` — it does
  not read prompt or response content. A content-aware audit could
  measure: (a) prompt-length distributions, (b) reformulation rate after
  a NEEDS_EVIDENCE response, (c) caller_status flip frequency
  (READY → NOT_READY → READY thrash patterns).
- **Time-to-converge in wall-clock.** `meta.json` records timestamps but
  this audit only counted rounds. A wall-clock cut could find sessions
  with many rounds but tight latency (productive) vs few rounds with long
  pauses (idle thrash).
- **Cross-session continuity.** `cross_review_continuity` references in
  meta could be aggregated to find which sessions chained from prior ones
  and whether the chain reduced re-discovery cost.

---

## 5. Roadmap synthesis

| Finding | Priority | Target release | Effort |
|---------|---------|----------------|-------:|
| §2.1 Prompt-flag recovery | P0 | **v1.0.5** | **done** |
| §2.4 spec_version in meta.json | P1 | **v1.1.0** | **done** (FU-1, spec §6.17) |
| §2.5 chatgpt-pro-backend smoke | P1 | **v1.1.0** | **done** (FU-2, smoke step) |
| §2.2 Orphan session sweep | P2 | **v1.1.0** | **done** (FU-3, spec §6.18 + `session_sweep` tool) |
| §2.3 Convergence-health hint | P2 | **v1.1.0** | **done** (FU-4, spec §6.19) |
| §3.1-3.4 observations | n/a | none | n/a |

## Closure note (2026-04-26, v1.1.0)

All four follow-ups (FU-1..FU-4) shipped in v1.1.0 alongside spec
v4.13. Implementation contracts validated by trilateral cross-review
session `483b2d1c-6e82-42a3-bbcc-1e9ea61289f7` (caller=claude,
peers=codex+gemini, READY in round 2). Smoke coverage: 14 new
invariants on top of the 127 existing steps (141 total). Both
`v1.0.4` and `v1.0.5` GitHub Releases were also recovered in this
release window — they had been missing because their commits were
never tagged; tags were created retroactively, the publish workflow
ran successfully, and `publish.yml` gained a `gh release create` step
to prevent recurrence. The audit corpus is now closed; subsequent
audits will run against the v1.1.0+ runtime baseline.
