# Cross-Review MCP Workflow Specification v4.8

**Status**: v4.8 is a spec-only revision of v4.7 via session 5fce39ce
(2026-04-24, em revalidacao bilateral). v4.8 adds section 6.9.3
"Subscription tier resilience and transient failure handling" with
six subsections (absorbing operator directives D3 persistent tier
downgrade + D4 moderation flags and rate limits + D5 outages and
overload), a clarification paragraph to section 6.9.2 scoping
"NO silent fallback" to mid-round behavior, and a new Section 7
summary row. v4.8 touches NO code;
code remains v0.4.0-alpha until the integrated F2 impl session
delivers v0.5.0-alpha with both v4.7 triangular extension and v4.8
probe + degradation mechanisms. Predecessors: v2 (session 7d745f38);
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
  opened the session (selected by the client's `CROSS_REVIEW_CALLER`
  env var); peers are computed as all canonical ids except caller. No
  hardcoded default initiator.
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
  `CROSS_REVIEW_CALLER`; one peer is spawned; one round is recorded
  per call with fields `peer`, `peer_status`, etc.
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

### 2.8 Dynamic role assignment (NEW in v4.7)

Role assignment in any cross-review session is strictly dynamic:

- **Caller** is the agent whose `CROSS_REVIEW_CALLER` env var was set
  when the MCP server was launched by that client. The caller is the
  agent that initiated the conversation; no hardcoded default
  initiator exists in the server code. Each MCP client (Claude Code,
  ChatGPT Codex CLI, Gemini CLI) configures its own invocation with
  the corresponding value.
- **Valid canonical ids** for `CROSS_REVIEW_CALLER` are `claude`,
  `codex`, `gemini`. Any other value causes the server to fail to
  start with a fatal error listing the allowed set.
- **Peers** are computed deterministically as all canonical ids
  except caller. For the v4.7 triangle, peers is an array of two. The
  `ask_peers` tool broadcasts to this computed array.

Cross-reference: section 2.7 (topology) defines the vertex graph and
broadcast semantics; section 2.8 (this section) defines how a runtime
caller occupies one vertex and how the peer set is computed from the
remaining canonical ids. The two sections are complementary.

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

Internal fields (values of `CROSS_REVIEW_CALLER`; filename suffixes
like `round-NN-peer-<id>.md`; meta.json schema keys; variable names
such as `peers[]`, `peer_model`, `peer_file`; the `peer.name` field
in round records) MUST use canonical ids (lowercase, no spaces).

Canonical ids may appear verbatim in prompts and external prose when
the text is discussing configuration values, schema fields, or code
literals (for example, "set `CROSS_REVIEW_CALLER=gemini`"). Display
names apply to identity prose; canonical ids apply to code/config
literals; both may coexist in the same document.

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

---

## 7. Summary of conventions for immediate use (UPDATED through v4.8)

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
| Triangular topology | `ask_peer` bilateral legacy remains; `ask_peers` N-ary introduced in F2 -- alpha normative (section 2.7); unanimity convergence (section 6.3); display names externally ("Claude Code" / "ChatGPT Codex" / "Gemini"); canonical ids internally (claude / codex / gemini); caller selected dynamically via `CROSS_REVIEW_CALLER` with no hardcoded default (section 2.8) |
| Tier + transient resilience | Pre-session capability probe per agent with per-provider `fallback_chain` walk (6.9.3.1, 6.9.3.2); graceful degrade triangular -> bilateral when exactly one peer is excluded, abort only when <2 peers viable (6.9.3.3); session-level `meta.capability_snapshot` + active-peer-only rounds (6.9.3.4); dual runtime vs advisory role of top-models.json (6.9.3.5); mid-round transient provider failures (prompt flag / rate limit / 5xx) treated with same-model retry-once-with-backoff; server-side auto-rephrase prohibited; silent mid-round model switch remains prohibited (6.9.3.6); `transient_failure` enum in response distinguishes transient from protocol failure |

---

## 8. Criterios de aceitacao (atualizados em v4.8)

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
