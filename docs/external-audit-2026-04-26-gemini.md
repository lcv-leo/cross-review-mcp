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
| F1 / F4 partial — UUID validation | P1 | **v1.2.1** | small (DONE) |
| F7 — log prefix clarity | P1 | **v1.2.1** | trivial (DONE) |
| F8 — description drift smoke | P1 | **v1.2.1** | small (DONE) |
| F3 — success-path redaction | P2 | v1.3.0 | medium |
| F4 — full Zod runtime validation | P2 | v1.3.0 | medium |
| F5 — per-stream byte cap | P2 | v1.3.0 | medium |
| F6 — lock token verification | P3 | v1.3+ | small |
| F2 — shell:false + arg arrays | P3 | v1.3+ if vector emerges | medium |

The v1.3+ items are tracked but not blocking. v1.2.1 closes the
high-signal subset.

---

# Audit round 2 — Gemini-orchestrated (Codex-authored), 2026-04-26

A second audit was commissioned the same day, after v1.2.1 + v1.2.2 had
shipped. The Gemini caller could not run in this round (CLI
trust-directory issue persisted), so Codex produced the findings via
the cross-review-mcp session `2d4ae3e4-7388-4938-bfc6-b6ec859e506d`.
This document records the validation matrix.

## Findings

| # | Finding | Verified against v1.2.2 source | Outcome |
|---|---|---|---|
| F1 | Caller bypass — no token binding to MCP client | Theoretical; threat model is single-user trusted host. MCP has no native auth primitives. | **Defer P3** — would only matter in multi-tenant deploy. |
| **F2** | Convergence snapshot ignores spawn-rejected peers | **REAL bug**: `computeConvergenceSnapshot` only counted `round.peers` (responded), ignored `round.quorum.rejected`. Inconsistency vs in-handler `allPeersReady` check. Violates spec §6.12 strict-only. | **SHIPPED in v1.2.3.** |
| F3 | Spawn `shell: true` injection risk | Same as round-1 F2. cmd built from constants only; no real attack surface. | **Defer P3** (already documented above). |
| F4 | Success-path output redaction | Same as round-1 F3. | **Defer P2** (already documented above). |
| **F5** | Session lifecycle: finalize without lock; idempotency clobber; ask_* on finalized; escalate_to_operator unguarded | **REAL** (4 sub-bugs). | **SHIPPED in v1.2.3.** |
| F6 | DoS via unbounded buffers | Same as round-1 F5. | **Defer P2** (already documented above). |

## Closure trail (v1.2.3)

The v1.2.3 release closes F2 and the four F5 sub-bugs. Implementation
contracts validated by trilateral cross-review session
`aa4770fc-aad5-446b-a93a-4d01564b16aa` (caller=claude, peers=codex+
gemini; **READY in R4** after R1 codex NOT_READY + R2 codex/gemini
NOT_READY + R3 codex NEEDS_EVIDENCE). The 4-round cadence is recorded
because each round caught a real residual:

- **R1** — codex flagged 4 gaps in the initial design: F2 readout drift
  (reason text), F2 docs drift (spec/tool descriptions still claiming
  loose semantics), F5b safe-idempotency missing (raw rejection on
  identical retry), F5c missing on `escalate_to_operator`.
- **R2** — codex flagged 2 residuals after R1 fixes landed: F2
  all-rejected path (peers=[] + quorum.rejected>0 fell into legacy
  bilateral path, lost rejected_count); §6.18 amendment text claimed
  but missing from spec doc. Gemini flagged 1: F5b empty-string
  normalization gap (whitespace/empty-string vs null comparison would
  falsely flag identical retry as conflict).
- **R3** — caller addressed all R2 blockers, declared READY. Codex
  NEEDS_EVIDENCE: static review saw no blocker but its CLI policy
  blocked `npm run smoke` and `npm run check-models` execution.
  Gemini READY.
- **R4** — caller attached fresh smoke + check-models transcripts
  (164 GREEN, no drift). Codex READY. Gemini READY. **Trilateral
  convergence.**

## v1.2.3 specific changes

### F2 closure (strict quorum)

- `src/lib/session-store.js::computeConvergenceSnapshot` N-ary path
  detection changed from `Array.isArray(peers) && peers.length > 0
  && !('peer_status' in round)` to `Array.isArray(peers) &&
  !('peer_status' in round)`, so all-rejected rounds enter the N-ary
  path instead of falling through.
- New `rejected_count` field in the snapshot, populated from
  `round.quorum.rejected` (defaults to 0 for legacy rounds).
- Convergence predicate now requires `rejectedCount === 0` in addition
  to all responded peers READY.
- `buildConvergenceReason` new branch: when `blocking_peers.length === 0
  && rejected_count > 0`, surfaces "${N} peer(s) failed at spawn
  (rejected_count=N); strict quorum requires all requested peers to
  respond and declare READY (spec v4.14 §6.12)".
- Tool descriptions for `session_check_convergence` and `ask_peers`
  updated to align with strict-quorum semantics. Spec §6.12 updated.
- 5 new smoke invariants in `driveV414StrictQuorumUnit`.

### F5 closure (lifecycle invariants)

- `session_finalize` handler acquires `store.acquireLock` for the
  entire read+write window. Inside the lock:
  - identical re-finalize (same outcome AND same null-normalized reason)
    → no-op success, returns `idempotent: true`. Crucially MUST NOT
    call `store.finalize`, preserving `meta.finalized_at`.
  - conflicting re-finalize → throws with both states surfaced.
  - reason normalization collapses null/undefined/empty/whitespace-only
    strings to null for comparison (gemini R2 ask).
- `ask_peer` and `ask_peers` handlers gain `if (meta.outcome != null)
  throw` guard immediately after `readMeta`, refusing to append a new
  round to a finalized session.
- `escalate_to_operator` handler acquires the session lock for
  write-ordering but DELIBERATELY does NOT refuse on finalized sessions
  (post-finalization annotation policy: operator may legitimately
  escalate concluded sessions during later review).
- Spec §6.18.1 (NEW) codifies all three contracts.
- 4 new smoke invariants in `driveV414SessionLifecycleGuardsUnit`.

## Auditor's misses (round 2)

The Gemini-orchestrated audit did not credit:
- v1.2.1 F1 path-traversal validation (sessionDir UUID guard + path.resolve containment)
- v1.2.2 §6.10 enforcement (B+C — tool description directive + runtime detector)
- v1.2.0 §6.20 dynamic caller resolution

The audit was operating on a snapshot that pre-dated these features,
or didn't surface them as relevant to the audit scope.

---

# Audit round 3 — Gemini-orchestrated (Codex-authored), 2026-04-26 (after v1.2.3)

A third audit was commissioned the same day, this time against v1.2.2 source
(the auditor's snapshot was pre-v1.2.3, missing all the round-2 fixes
that had just shipped). Findings repeat-rate is high.

## Findings

| # | Finding | Verified against v1.2.3 source | Outcome |
|---|---|---|---|
| F1 | Caller bypass — capability tokens | Repeat (round-1 + round-2). Theoretical in single-user threat model. v1.2.0 §6.20 dynamic resolution + meta.caller_resolution audit field provide partial mitigation auditor didn't credit. | **Defer P3** (already documented). |
| F2 | Quórum exclui silenciosamente | **ALREADY FIXED in v1.2.3** (shipped ~1h before this audit). `computeConvergenceSnapshot` requires `rejectedCount === 0`, exposes `rejected_count` field, `buildConvergenceReason` surfaces "${N} peer(s) failed at spawn". Auditor MISS — snapshot was pre-v1.2.3. | **Confirmed FIXED.** |
| F3 | shell:true | Repeat (round-1 + round-2). cmd from constants only. | **Defer P3** (already documented). |
| F4 | Lock concurrency | **PARTIALLY FIXED in v1.2.3.** session_finalize + escalate_to_operator now acquire lock; finalizeIfUnset has re-read-before-write. Lock-token verification (PID-bound release) was the deferred sub-finding. | **Partial closure recorded.** |
| F5 | StdioServerTransport unbounded | NEW. Real but resides in `@modelcontextprotocol/sdk` (upstream). Mitigation requires wrapper transport or SDK fork. Threat model is trusted local host. | **Defer (upstream issue).** |
| F6 | stdout/stderr accumulation | Repeat. | **Defer P2** (already documented). |
| F7 | Transactional spawn teardown | NEW. Real Windows edge case (taskkill zombie children). Bounded by 600s timeout + overlaps F6 mitigation. | **Defer P3.** |
| **F8** | Per-file persistence size cap | NEW. Real defense-in-depth. Adversarial peer streaming 100 MB before timeout could fill session-store before sweeper reclaims. Easy fix. | **SHIPPED in v1.2.4.** |

## v1.2.4 closure

v1.2.4 closes:
- **F8 per-file persistence cap**: `clipForPersistence(content, label)` helper
  + 64 KiB cap + truncation marker citing `spec v4.14 §6.18.2`. Wired into
  `savePromptForRound` + `savePeerResponse`. Spec §6.18.2 (NEW) codifies.
- **Stale runtime literal** (operator + Gemini caught): `recovery_advice`
  text "advisory mode, v1.2.2" was hardcoded in v1.2.3 source. Fix: template
  literal `\`v\${VERSION}\`` so future bumps auto-update. New anti-drift
  smoke binds `recovery_advice` to `server.VERSION`.
- **`server_info` tool** (operator request): 9th MCP tool. Returns
  `{ name, version, release_date, spec_version, tools, links }`. Resolves
  the runtime-vs-source ambiguity that arises because MCP servers don't
  auto-reload after package updates. New `RELEASE_DATE` constant + smoke
  step asserting the constant matches the CHANGELOG.md heading date for
  the current VERSION.

## Yield assessment

Round 3 had **lower yield** than rounds 1-2:
- 1 finding already fixed in source 1h before audit landed (F2 — auditor's snapshot was stale).
- 4 repeats (F1, F3, F4 partial, F6) — already in deferral matrix from rounds 1-2.
- 3 genuinely new findings (F5, F7, F8). Of these:
  - F5 deferred (upstream concern, requires SDK wrapper).
  - F7 deferred (overlaps F6 mitigation, bounded by timeout).
  - **F8 shipped** in v1.2.4.

The pattern suggests the auditor is operating against stale snapshots
and re-flagging items already triaged. To raise yield, future audits
should be commissioned against tagged releases (e.g., v1.2.4 specifically)
not against an undated source pull.

---

# Audit round 4 — Gemini-orchestrated (Codex panelist, fresh-en-US prompts), 2026-04-26 (after v1.2.4)

A fourth audit was commissioned the same day, this time WITH the operator
restarting Gemini's MCP host so it loaded v1.2.4 from disk. The auditor's
prompts were correctly in en-US (validating §6.10 enforcement from v1.2.2).
Yield was high — auditor engaged with current source and produced 4
shippable findings + 1 four-time repeat that v1.2.5 retires via spec note.

## Findings

| # | Finding | Verified against v1.2.4 source | Outcome |
|---|---|---|---|
| §1 | RCE via shell:true / config poisoning | Repeat 4th time. Same rationale: cmd from pinned constants + repo-tracked `reviewer-configs/peer-exclusions.json` (operator-edited, not request-surface), prompt via `proc.stdin.write` never reaches shell. | **Spec §6.21 NEW** in v1.2.5 — codifies the architectural decision and explicitly retires this finding from future audit yield. |
| **§2** | taskkill fire-and-forget (Windows process reaping) | NEW. Pre-v1.2.5 was no-error-handling, no-await; under sandboxing/contention zombie peer leaks. Refinement of round-3 F7. | **SHIPPED in v1.2.5** — telemetry on stderr_tail + non-zero exit + spawn-error path. R2 gemini caught a critical companion bug: my POSIX group-kill `process.kill(-pid)` always threw ESRCH on non-detached spawns, and my ESRCH-return short-circuited the fallback → guaranteed zombies on Linux/macOS. Fix simplified to direct PID kill. |
| §3.a | UUIDv4 strict validation | Cosmetic. v1.2.1 regex was 8-4-4-4-12 hex without version+variant bits. | **SHIPPED in v1.2.5** — strict v4 regex (gemini R1 ask). |
| **§3.b** | realpath vs path.resolve symlink escape | NEW. Local attacker plants UUID-named symlink under STATE_DIR pointing outside; lexical resolve doesn't catch it. | **SHIPPED in v1.2.5** — `fs.realpathSync` applied to both candidate dir AND STATE_DIR; `isPathContained(child, root)` helper using `path.relative` for Windows case-insensitivity; `ensureStateDir()` called before realpath comparison. |
| **§4.1** | stdout/stderr unbounded RAM accumulation | Repeat round-1+2+3 F6 with sharper framing — F8 (v1.2.4) only capped disk, not RAM. | **SHIPPED in v1.2.5** — `PEER_STREAM_MAX_BYTES = 4 MiB` on spawnPeer streams + `PROBE_STREAM_MAX_BYTES = 256 KiB` on probeAgent (codex R1 inferred ask). On overflow: kill process tree + reject with `failure_class: 'stream_overflow'` (recovery_hint=null — volumetric, not semantic). Spec §6.18.3 NEW. |
| **§4.2** | session_sweep doesn't delete files | NEW. Long-term cumulative disk exhaustion; pre-v1.2.5 was deliberate-by-design (preserve audit trail). | **SHIPPED in v1.2.5** — opt-in `delete_files: true` flag does `fs.rmSync(sessionDir, { recursive: true, force: true })` after finalize. Default false preserves audit trail. Spec §6.18.4 NEW. |

## v1.2.5 closure

Trilateral cross-review session `53d0d785-7b81-4674-ab49-272b7d100ba5`
(claude caller + codex + gemini) iterated R1 → R2 → R3 to address
peer-flagged residuals:

- **R1**: gemini NOT_READY with 4 concrete caller_requests (PID guard,
  strict UUIDv4, ensureStateDir before realpath, d.length optimization).
  Codex protocol_violation — response truncated mid-deliberation due to
  CLI session rollout error (`thread not found` after 195k tokens).
  Codex's leaked deliberation contained substantive signals (probeAgent
  stream gap, classification chain in BOTH handlers, path.relative
  helper, spec wording) that I treated as inferred caller_requests.
- **R2**: codex NOT_READY — caught caller-side gap: my "applied to
  working tree" framing was misleading; I had presented diffs in prompts
  but not actually edited files. Codex did `git status` + `git log`,
  found HEAD `12a50ad`/v1.2.4 clean, no R2 changes present. Valid
  blocker. Gemini NOT_READY — caught a critical regression in my R2
  POSIX kill design: `process.kill(-proc.pid, 'SIGKILL')` on
  non-detached spawns always throws ESRCH, and my
  `if (e.code === 'ESRCH') return;` short-circuited the fallback →
  guaranteed zombies on Linux/macOS.
- **R3** (this commit): all R1+R2 blockers addressed, all diffs applied
  to working tree, POSIX path simplified to direct PID kill (skipping
  the dead-code group-kill), all 8 new smoke step assertions GREEN (177 total).

## Auditor's misses (round 4)

- Auditor flagged §3.a (UUIDv4 strict bits) as "low value, marginal";
  combined with §3.b realpath fix it actually closes a meaningful
  attack surface and was worth shipping — credit due.
- Auditor's §1 framing (config poisoning via reviewer-configs) is
  technically correct but the threat scenario requires fs-write access
  that already subsumes shell injection. Spec §6.21 codifies this so
  future auditors can engage the rationale rather than re-flag.

## Yield assessment

Round 4 yield was **highest of the 4 rounds**:
- 1 finding retired via spec note (§1 — non-yielding repeat now closed)
- 4 findings shipped (§2, §3.a+b, §4.1, §4.2)
- 0 deferred (all real findings closable in v1.2.5 scope)

Pattern observation across rounds:
| Round | Yield (real shippable) | Repeats | Deferred-with-rationale |
|---|---|---|---|
| Round 1 | 3 (F1+F7+F8) | 0 (first audit) | 4 (F2-F6 various) |
| Round 2 | 2 (F2+F5) | 4 (F1/F3/F4/F6) | 0 |
| Round 3 | 1 (F8) | 4 (F1/F2/F3/F6) + 1 already-fixed | 3 (F4 partial, F5, F7) |
| Round 4 | 4 | 1 (§1 RCE/shell:true — spec note retires) | 0 |
| **Round 5** | **3** (F3 streams + F4 taskkill + codex comment) | 2 (RCE re-confirmed, traversal re-confirmed) | 3 (TOCTOU, MCP request caps, peer-emulator harness) |

## Round 5 closure (v1.2.7)

**Setup.** Gemini ran a full re-audit against v1.2.6. Codex independently
audited v1.2.6 in parallel and initially returned READY in cross-review
session `a02be3db` with only a single residual (a stale comment at
`session-store.js:498-500`). When the operator surfaced gemini's report
to codex, codex re-evaluated and CONCURRED on gemini's findings 3, 4,
and 5 — reversing the earlier READY.

**Codex miss-profile note (atypical).** This round inverts the usual
rigor pattern documented in `feedback_peer_review_rigor.md`. Across
rounds 1-4, codex was the more-rigorous holdout (caught the apply-to-tree
gap in R2 of v1.2.5; held line on §6.18.3 doc-drift through R4 of
v1.2.5). Round-5 audit: gemini caught 2 real runtime defects; codex
caught 0 real bugs + 1 stale comment + went READY. The codex re-eval
recovered (concurred fully when shown gemini's evidence). Recorded here
because pattern matters for how operator weights peer evidence in
future rounds: never treat single-peer READY as absence of bugs even
when that peer historically holds line.

### Items fixed in v1.2.7

**F3 — DoS by Memory (stream listener detach).** REAL bug. Pre-v1.2.7
implementations called `killProcessTree(proc)` on overflow/timeout but
left `proc.stdout` and `proc.stderr` `data` listeners attached. Windows
`taskkill` is async (50-200ms typical); POSIX `process.kill` returns
before child fully exits. In-flight `data` events kept growing JS-side
buffers DURING the kill window — soft cap (4 MiB) became 8-16+ MiB
under hostile/pathological peer load. Fix: introduced `detachStreamListeners`
(spawnPeer) + `detachProbeListeners` (probeAgent) helpers that
`removeAllListeners('data')` on stdout+stderr; invoked BEFORE
`killProcessTree(proc)` in BOTH overflow handler AND timeout handler in
each (4 leak paths total). Used `removeAllListeners` (pure JS-land) not
`destroy()` (which races with `taskkill` on Windows producing spurious
'error' events). Single `data` event already in microtask queue may
still fire once after detach (single-chunk-bounded leak ≤64 KiB);
acceptable. Spec §6.18.3 v1.2.7 amendment codifies. New structural
anti-drift smoke `driveV414StreamListenerDetachUnit`.

**F4 — Windows process reaping fallback.** REAL bug. Pre-v1.2.7 the
`killer.on('close', code)` handler logged on `code !== 0` but had no
recovery — `taskkill` failures (AV interference, permission inheritance
bugs, race with normal exit) leaked the child process. The
`killer.on('error', err)` path also only logged. Fix: both handlers now
invoke `proc.kill('SIGKILL')` in try-catch (swallows ESRCH for
already-dead processes) AFTER the log line. Strict improvement.
Anti-drift smoke `driveV414TaskkillFallbackUnit`.

**Codex comment fix.** Stale comment at `src/lib/session-store.js:498-500`
described the convergence predicate as "failed-spawn peers excluded
from denominator" — pre-v1.2.3 semantics. v1.2.3 §6.18.1 strict-quorum
closure changed it (failed-spawn peers ARE counted in `round.quorum.rejected`
and DO count AGAINST convergence; predicate requires `rejected_count === 0`).
Comment was 4 releases stale. Rewritten to match current spec §6.12 +
§6.18.1 contract.

### Items deferred to v1.3.x with explicit rationale

**Gemini R3 — MCP request-boundary payload caps.** REAL gap (codex
independently corroborated as #5 in re-eval). Currently §6.18.2's
64 KiB cap fires only at the disk-write layer; an adversarial caller
could ship a 100 MiB `prompt`/`task`/`artifacts` payload consuming RAM
in the handler before any write. v1.3.x material because it requires
threshold calibration (post-truncation behavior, response shape on
oversized input) and would be a normative request-boundary contract,
not just an implementation hardening.

**Gemini R4 — behavioral peer-emulator harness.** Already deferred at
v1.2.5; F3 closure does NOT change that. Behavioral end-to-end tests
that exercise the kill window (peer emitting >cap at high rate)
require a peer-CLI emulator not currently in the stdio fixture. The
v1.2.7 anti-drift smoke is structural (asserts wiring exists); behavioral
coverage is independent. Slated for v1.3.x.

**TOCTOU realpath-vs-I/O race.** Gemini's §2 residual ("ínfima margem
para um ataque do tipo TOCTOU"). Accepted under §6.21 single-user
trusted-host threat model. Eliminating it would require POSIX
`O_NOFOLLOW`-style per-operation gates not in Node's stable fs surface.
Filed as known limitation, not v1.3.x ship target.

### Round-5 cleanup of pre-existing biome diagnostics

Per workspace `feedback_fix_preexisting_errors.md` directive ("always
fix any issues found, pre-existing or not"), v1.2.7 also cleared all
pre-existing biome warnings on the modified files:

- `src/lib/peer-spawn.js:417` — `!proc || !proc.pid` → `!proc?.pid`
  (`useOptionalChain`).
- `src/server.js:463` — string-concatenation tool description in
  `session_init` switched to template literal (`useTemplate`).
- `scripts/functional-smoke.js:1537` — useless escape `'"\,'` → `'",'`
  (`noUselessEscapeInString`).
- `scripts/functional-smoke.js:1675` — `Object.prototype.hasOwnProperty.call(...)`
  → `Object.hasOwn(...)` (`noPrototypeBuiltins`; safe under Node 20+
  engine pin).
- Whole-file biome formatter pass on the 5 modified files; quote style
  standardized + tab indentation enforced. Anti-drift smoke regex
  updated to be formatter-agnostic on quote choice so future biome
  migrations don't break gates.

Round 4 had the operator restarting Gemini's MCP host so the audit ran
against actual v1.2.4 (not stale snapshot), AND the auditor used en-US
peer exchange per v1.2.2 §6.10 enforcement. Both factors increased the
yield meaningfully.

## Operator action item (still open from rounds 1-2)

Gemini CLI trust-directory issue persists in the audit environment:

```
Gemini CLI is not running in a trusted directory. To proceed, either
use --skip-trust, set the GEMINI_CLI_TRUST_WORKSPACE=true environment
variable, or trust this directory in interactive mode.
```

Same recommendation as round 1: run `gemini trust` in the workspace
or set `GEMINI_CLI_TRUST_WORKSPACE=true` in the MCP server env block.
The Gemini probe in this caller's session DID succeed (because Gemini's
own MCP host runs in a different environment), so the trust issue is
specific to the audit-host's Gemini CLI configuration.
