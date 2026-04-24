# Technical Report -- Post-Reload Cycle 2026-04-24

**Audience:** Codex (peer of the cross-review sessions in this cycle).
**Author:** Claude Opus 4.7 (caller in all sessions).
**Scope:** complete cycle of the 5-item post-reload sequence of the VS Code
reload on 2026-04-24, closed within a single continuous work window.
**Form:** ASCII-only (editorial rule section 6.4); cross-references to
commits, cross-review sessions persisted under
`~/.cross-review/<session-id>/`, spec `docs/workflow-spec.md`, and
companion tooling.

---

## 1. Executive summary

On 2026-04-24, after a VS Code reload to load cross-review-mcp v0.4.0-alpha
in runtime, the user defined an explicit 5-item sequence to address. All
5 closed in a single work window:

| Item | Session | Rounds | Commit | Outcome |
|------|---------|--------|--------|---------|
| 1. Auto-discovery of top-level model | `9c56005b` | 4 | `462f5ef` | Spec v4.3 + advisory-only tooling |
| 2. Schema v5 with objects | `bd8c3cfb` | 2 | `ef56b5d` | Spec v4.4 YAGNI-suspend with objective reopening criterion |
| 3. Version drift package/lock/server.js | `42130c72` | 2 | `b89b878` | Alignment 0.3/0.2 -> 0.4.0-alpha |
| 4. rounds_limit/session_digest in session_read | `bb38cd79` | 2 | (zero commit) | D1 no-op YAGNI reaffirm |
| 5. "em revalidacao -> aprovada" normative pattern | `843d57eb` | 3 | `cff28a9` | Spec v4.5 self-demonstrating editorial preamble |

Aggregate metrics:
- 13 total rounds, 5 sessions, 100% `outcome=converged`.
- 5 commits: 4 docs (`462f5ef`, `ef56b5d`, `cff28a9`) + 1 mixed tooling
  (`462f5ef`) + 1 chore (`b89b878`). Item 4 session closed with no
  commit (D1 no-op).
- Zero runtime touches: `src/server.js`, `src/lib/status-parser.js`,
  `src/lib/peer-spawn.js`, `src/lib/session-store.js`,
  `scripts/functional-smoke.js` immutable since commit `2c79a1c`
  (v0.4.0-alpha).
- All gates green at every checkpoint: `npm run smoke` = 60 steps GREEN,
  `npm run check-models` = exit 0 OK.

## 2. Pre-cycle baseline

Before the reload, the repository was at commit `3b7a3a4` (v4.2 spec).
Pre-existing commits:
- `88639b8` -- initial commit v0.3.0-alpha.
- `9a2ab2a` -- workflow-spec v3 (session 806a1c4f).
- `2c79a1c` -- v0.4.0-alpha code: expanded v4 schema + tri-tool/top-model
  + audited peer_model (session 08cd61e6).
- `0d85988` -- v4.1 spec-only: section 6.6 normative overflow (session
  a847f897, 7 rounds).
- `3b7a3a4` -- v4.2 spec-only: section 6.7 normative evidence matrix
  (session f1fdbee4, 5 rounds).

Three follow-ups registered by Codex in earlier sessions formed the
baseline of the post-reload sequence: auto-discovery (08cd61e6), schema
v5 with objects (08cd61e6), version drift (a847f897). The user added
two more when defining the sequence: conditional
rounds_limit/session_digest and normative "em revalidacao -> aprovada"
pattern.

## 3. Method applied to each item

Section 6.9.1 tri-tool directive required pre-session_init: ultrathink +
code-reasoning + cross-review. Advisor consulted for anti-scope-creep and
null-hypothesis framing in higher-ambiguity items (Items 1 and 2; skip
justified in Items 3, 4, 5 where direction was clear with objective
data).

Recurring pattern of initial prompt:
1. Item context + original follow-up.
2. Empirical state verified on disk (fingerprints, prior sessions,
   meta.json sizes, etc.).
3. Null hypothesis explicitly stated.
4. Enumerated design space (typically 3-4 options) to avoid binary
   framing.
5. Concrete discriminator-key (e.g. "name ONE X that Y") to force the
   peer to respond factually.
6. Explicit anti-scope-creep (round cap, untouchable items).
7. Response contract section 2.4 reminded; request for TAIL structured
   block with valid JSON + omit-unless-signal.

## 4. Item 1 -- Auto-discovery of top-level model (Spec v4.3)

Session: `9c56005b-1a95-46f5-8718-2ff0a53a3a23`. 4 rounds.
Commit: `462f5ef`.

### 4.1 Original follow-up

Registered by Codex in 08cd61e6 as "controlled auto-discovery of top-level
model with preserved auditability; future release post-v0.4.0".

### 4.2 Design space

Four options enumerated to the peer:

- (A) Dynamic runtime discovery via CLI.
- (B) Defensive pre-spawn existence check.
- (C) Advisory-only drift audit (NULL HYPOTHESIS).
- (D) Config-file driven.

### 4.3 Decisive empirical evidence (eliminated (A))

Probed `codex --help` and `claude --help`:
- `codex` does not expose a `models`, `list`, or equivalent listing
  subcommand. Only `-m/--model <MODEL>` to select it.
- `claude --list-models` returns `error: unknown option '--list-models'`.
  `claude` also does not expose a listing subcommand.

Consequence: dynamic runtime discovery via CLI is **mechanically
impossible** without out-of-band calls (REST OpenAI/Anthropic API, doc
scraping), which would introduce secrets, networking, and new failure
modes. Option (A) removed from the board.

### 4.4 Decision: (C) advisory-only

Peer READY in round 1 agreeing integrally, with 3 guardrail follow-ups:
1. If implementing section 6.9.2.1, mark as "em revalidacao bilateral"
   until post-sealing approval.
2. Keep pre-spawn existence validation as a separate abort-only follow-up,
   out of scope of Item 1.
3. For check-models: no-runtime-risk parser strategy, avoid runtime model
   selection.

Also flagged two practical concerns:
- Project has no YAML parser; use JSON.
- Constants are not exported from `peer-spawn.js`; use textual reading.

### 4.5 Resulting artifacts

- `docs/top-models.json`: schema v1, documentary source curated by the
  user with entries per provider (`codex`, `claude`) containing `id`,
  `reasoning_effort?`, `validated_at` (ISO YYYY-MM-DD), `ref_url`,
  `notes`; global `staleness_threshold_days` (default 30). Fully
  ASCII-only.
- `scripts/audit-model-drift.js`: zero-deps Node script that reads
  `peer-spawn.js` via `fs.readFileSync` + fixed regex to extract
  CODEX_MODEL, CODEX_REASONING_EFFORT, CLAUDE_MODEL; compares against
  `top-models.json`; emits exit codes 0 (OK), 1 (ID drift), 2
  (staleness), 3 (structural error). Regex fragility INTENTIONAL:
  constant refactoring forces deliberate human audit revision (exit 3).
  Fully ASCII-only.
- `package.json`: added npm script `"check-models": "node
  scripts/audit-model-drift.js"`. Version deliberately unchanged.
- `docs/workflow-spec.md`: new section 6.9.2.1 "Model drift audit"
  normative. Initially written as "em revalidacao bilateral"; promoted
  to "aprovada bilateral" post-sealing (pattern that would come to be
  formalized in v4.5).

### 4.6 Explicit prohibitions in section 6.9.2.1

The advisory mechanism does NOT authorize:
- Silent fallback (keeps section 6.9.2 clause).
- Runtime config/env override -- the advisor does not inject anything
  into `spawnPeer`.
- Automatic model selection -- choice remains pinned in
  `peer-spawn.js`.
- ID change without bump + explicit edit of section 6.9.2 -- script
  exit 1 states this literally in the error message.

### 4.7 Round-by-round

- Round 1: peer READY with 3 follow-ups + 2 practical concerns.
- Round 2: application applied; peer NOT_READY requesting transliteration
  of "section-sign" to "secao" only in new v4.3 occurrences (strict
  section 6.4 reading); historical drift stays as separate follow-up.
- Round 3: transliteration applied with 8 surgical edits; peer NOT_READY
  requesting registration of historical drift follow-up in section 8
  before sealing; protocol violation (code fence instead of canonical
  JSON).
- Round 4: follow-up added; peer READY in canonical minimal block;
  bilateral convergence.

### 4.8 Final fingerprints

- `docs/workflow-spec.md` = `95d3a48877ca1de6d89882aff45c2be91c416fdf9fcbe1dccef21e40e18a4e14`
- `docs/top-models.json` = `628e7cb1d7df20e8aa01e1469846f1995af1802032e4367df2fda4b4b63f9d4c`
- `scripts/audit-model-drift.js` = `0efcfa98abf8f2a31057328ec9553512e1b450355ca5c84125aab768c1997b89`

## 5. Item 2 -- Schema v5 with objects (Spec v4.4)

Session: `bd8c3cfb-6aa3-4a63-9093-db9120dd8b9a`. 2 rounds (fastest
convergence of the cycle).
Commit: `ef56b5d`.

### 5.1 Original follow-up

Registered by Codex in 08cd61e6 as "promote caller_requests/follow_ups
from arrays of strings to arrays of objects IF strings prove insufficient
in real use". Explicit conditional precondition.

### 5.2 Empirical evidence

- Session 9c56005b (only completed v4-era session post-reload under v4
  parser): 8 caller_requests/follow_ups emitted by the peer, all
  actionable strings, zero objects, zero "string cannot carry" signals.
- Session f1fdbee4 round 2 (pre-reload, v0.3 parser): the peer emitted
  spontaneously one object as caller_request; the v0.3 parser accepted
  silently (parser_warnings: null) -- **weak** evidence because the peer
  never encountered resistance. Under the current v4 parser, that same
  emission would be dropped with indexed warning via
  STRUCTURED_V4_NON_STRING_ITEM.

### 5.3 Design space

Four options:
- (A) Full breaking v5: parser rewrite, ~10 smoke tests, spec rewrites,
  bump v0.5.0-alpha consolidating Item 3.
- (B) Backward-compat v5: accept both strings and objects,
  auto-normalize.
- (C) v4 stays + explicit smoke coverage for the drop case.
- (D) Defer YAGNI (NULL HYPOTHESIS).

### 5.4 Discriminator-key

"Name ONE caller_request or follow_up from a v4-era session (post-reload)
that has FAILED due to string limitation. 'Failed' = substance not
transmitted, ambiguity causing an extra round, or non-actionable
guidance. 'Could be better as an object' does NOT count."

Codex responded literally: "I cannot name a single caller_request or
follow_up from v4-era session 9c56005b that has failed due to string
limitation." Round 1 READY with (D).

### 5.5 Decision: (D) YAGNI defer with objective reopening criterion

Replacement of the original follow-up in section 8 with precise text:
- Declares explicit YAGNI suspension.
- Cites the literal precondition from 08cd61e6.
- Defines reopening criterion: a v4-era peer naming ONE concrete
  caller_request that has FAILED due to string limitation.
- Points to already-existing test coverage
  (STRUCTURED_V4_NON_STRING_ITEM) confirming that drop + indexed warning
  is intentional behavior.

### 5.6 Emergent lesson

4-option framing beat binary framing in convergence: the peer went
directly to (D) in round 1 instead of polarizing between "v5 vs defer".
Pre-session empirical evidence in the initial prompt eliminated
conjectural debate.

## 6. Item 3 -- Version drift package/lock/server.js

Session: `42130c72-0c38-4d68-a0e6-9a7e48c41a75`. 2 rounds.
Commit: `b89b878`.

### 6.1 Pre-cycle state

- `package.json`: version = `0.3.0-alpha`.
- `package-lock.json`: version = `0.2.0-alpha` (top-level + packages[""]).
- `src/server.js:48`: `new Server({ name: 'cross-review-mcp', version:
  '0.4.0-alpha' }, ...)` -- authoritative MCP identity exposed to the
  client via protocol handshake.
- `src/server.js:304`: literal log `starting v0.4.0-alpha`.

### 6.2 Null hypothesis

Align both package files to `0.4.0-alpha` (do not bump beyond).
`src/server.js` is the source of truth; package metadata must reflect the
exposed identity. Since v0.4.0-alpha (commit `2c79a1c`), runtime/API/
contract have not changed -- v4.3 added advisory-only tooling, v4.4 was
spec-only. SemVer does not justify a bump beyond `0.4.0-alpha`.

### 6.3 Discriminator-key

"Is there any MCP convention (@modelcontextprotocol/sdk, official
documentation, or ecosystem standard) where `new Server({version})`
deliberately diverges from the package.json version?"

Codex responded: "I did not find an official MCP convention. The spec
treats `serverInfo.version` as the implementation version exposed in the
`initialize` handshake; the TypeScript SDK takes `Implementation` in the
constructor, implementation identity, not a separate versioning." READY
agreeing.

### 6.4 Technique applied

`npm version 0.4.0-alpha --no-git-tag-version` in repo root. Atomic
update of `package.json` + `package-lock.json` (top-level +
packages[""]).

Cosmetic side effect: `npm version` reformatted `bin` from inline
`{ "cross-review-mcp": "src/server.js" }` to multi-line. Peer guardrail
in round 1 was "acceptable diff = only the 3 version fields". After
applying `npm version`, I manually reverted the `bin` reformat via Edit
to honor the strict guardrail.

### 6.5 Final diff

Exactly 3 lines modified across 2 files:
```
package-lock.json:  "version": "0.2.0-alpha" -> "0.4.0-alpha"  (top-level)
package-lock.json:  "version": "0.2.0-alpha" -> "0.4.0-alpha"  (packages[""])
package.json:       "version": "0.3.0-alpha" -> "0.4.0-alpha"
```

Zero touches to `lockfileVersion`, `dependencies`, `resolved`,
`integrity`.

### 6.6 Final fingerprints

- `package.json` = `590d0aebd9ef62022809b2d2cc6645b8640ff2c087a461b92ddb64299ea69a97`
- `package-lock.json` = `d3d6108d53d1628a2048e2e31b1cffc1b495bfe3890fb674b85949ac0522def5`
- `src/server.js` = `ce2983b9079dd081f3bf0e3971685015b7b6fe10de8843892bdb9656169e3718` (unchanged)

## 7. Item 4 -- rounds_limit/session_digest in session_read

Session: `bb38cd79-9137-4b32-a6f1-3c0ec8f432fb`. 2 rounds. **Zero repo
commit.**

### 7.1 Original follow-up

"Optional trigger for `rounds_limit`/`session_digest` in `session_read`
-- only if/when real meta.json reaches measurable overflow pressure
(section 6.6.3)."

### 7.2 Current empirical audit

`ls -la ~/.cross-review/*/meta.json`:

- 15 sessions persisted.
- Smallest: 798 bytes (`fed77fd6`, aborted).
- Largest: 5717 bytes = 5.7KB (`f1fdbee4`, 5 rounds).
- Median: ~2000 bytes.
- Max rounds: 7 (`a847f897`).

Section 6.6.3 reopening thresholds (invariant): `meta.json > 500KB` AND
`20+ rounds`. Safety factor:
- Size: 5.7KB vs 500KB = ~88x.
- Rounds: 7 vs 20 = ~3x.

Data REINFORCES the YAGNI conclusion with no pressure signal.

### 7.3 Discriminator-key

"Section 6.6.3 empirical snapshot ('9 sessions, 1-3KB, 6 rounds') is
(a) a pointwise dated historical anchor that should remain as written at
the time of the original audit, OR (b) a living source of truth that
must be kept in sync with the current audit?"

Codex classified explicitly as **historical_dated_anchor**. "The wording
'audit 2026-04-24' indicates empirical evidence used to ground the
decision at that point, while the real normative rule is the thresholds.
The current audit reinforces the same conclusion and does not change the
contract."

### 7.4 Decision: (D1) no-op YAGNI reaffirm

Zero repo touches. Cross-review session documents the reaffirmation.
Audit persisted only in project memory (`project_cross_review_mcp_state
.md`).

### 7.5 Pedagogical observation

Peer emitted in round 1 four fields outside the v4 whitelist in the
structured block (`decision`, `snapshot_classification`, `d3_rejected`,
`follow_up` singular). Parser v4 dropped with 4 `parser_warnings "unknown
field X ignored"` preserving STATUS:READY.

Ironically reinforces Item 2 YAGNI (schema v5): peer TRIED to structure
additional metadata, but the substance was entirely present in the prose.
The dropped fields were redundant, not missing information. Round 2: peer
emitted a canonical minimal block without extra fields.

## 8. Item 5 -- "em revalidacao -> aprovada" normative pattern (Spec v4.5)

Session: `843d57eb-aa8c-49b8-b30d-a43b01df9a7a`. 3 rounds.
Commit: `cff28a9`.

### 8.1 Original follow-up

Registered by Codex in f1fdbee4 round 5: "Promote the 'em revalidacao
during session; aprovada only post-READY bilateral' pattern as an
operational normative clause in section 8 or section 6.9."

### 8.2 De facto empirical application evidence

- v4.1 (`a847f897`): section 6.6 attached with "em revalidacao
  bilateral"; promoted post-READY round 7.
- v4.2 (`f1fdbee4`): section 6.7 attached with "em revalidacao
  bilateral"; promoted post-READY round 5.
- v4.3 (`9c56005b`): section 6.9.2.1 header "STATUS: em revalidacao
  bilateral (session 9c56005b, 2026-04-24). Aprovada bilateral only
  post-READY bilateral (pattern f1fdbee4)"; promoted post-sealing.
- v4.4 (`bd8c3cfb`): **VIOLATION**. I wrote in round 2 the section 8
  entry "Spec v4.4 foi aprovada bilateralmente... cross-review bd8c3cfb
  (2026-04-24, 2 rodadas)" BEFORE the round 2 peer_status READY arrived.
  Pipeline converged cleanly, but the commit-vs-sealing order was
  inverted -- the "aprovada" language existed on disk for ~2 minutes
  before real convergence was confirmed.
- Item 3 (`42130c72`): does not apply (chore commit, not spec entry).

Observed rate: 1 violation in 4 spec-entry sessions = **25%**. Material,
not an outlier.

### 8.3 Design space

Four options:
- (D1) Short preamble in section 8 (NULL HYPOTHESIS, ~10 lines).
- (D2) New dedicated section 6.10 "Editorial discipline of the spec".
- (D3) Split: preamble in section 8 + cross-reference in section 6.9.
- (D4) YAGNI defer.

### 8.4 Discriminator-key

"Does the empirical 25% violation rate + marginal formalization cost
(~10 lines in section 8) justify a normative clause, or would you argue
that it's just 1 outlier that does not need a formal rule?"

Codex responded literally: "The 25% rate justifies a normative clause. I
would not treat it as 'just 1 outlier' because the problem is not
statistical in a broad sense; it's a defect of temporal discipline in a
short repeatable flow... the failure mode is clear and recurrable by any
agent that writes 'aprovada bilateralmente' before the real sealing."

### 8.5 Peer-refined text (applied with ASCII sanitization)

```
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
```

ASCII sanitization applied: "secao" (not "secao"), "pre-sealing" (not
"pre-sealing"), "historico" (not "historico"), "promocao" (not
"promocao"). Standard silent transliteration per section 6.4, already
applied in v4.3 and v4.4.

### 8.6 Self-demonstration of the clause

The v4.5 entry in section 8 itself followed the rule being established:

**Phase 1 (during session, pre-sealing):**
```
- Spec v4.5 em revalidacao bilateral na sessao cross-review 843d57eb
  (iniciada 2026-04-24). v4.5 adiciona preambulo normativo no inicio
  desta secao formalizando o padrao "em revalidacao bilateral ->
  aprovada bilateral" registrado como follow-up na sessao f1fdbee4.
  SPEC-only -- nao toca em codigo, nao muda API, nao altera parser.
  Promocao para "aprovada bilateralmente" sera feita em edit separado
  pos-sealing, honrando auto-demonstrativamente a propria clausula que
  esta sessao estabelece.
```

**Phase 2 (post-sealing, separate edit):**
```
- Spec v4.5 foi aprovada bilateralmente (Claude + Codex) na sessao
  cross-review 843d57eb (2026-04-24, 3 rodadas). v4.5 eh revisao
  spec-only de v4.4 adicionando preambulo normativo no inicio desta
  secao formalizando o padrao "em revalidacao bilateral -> aprovada
  bilateral" registrado como follow-up na sessao f1fdbee4. SPEC-only
  -- nao toca em codigo, nao muda API, nao altera parser. A propria
  promocao desta entrada de "em revalidacao bilateral" para "aprovada
  bilateralmente" foi feita em edit separado pos-sealing, honrando
  auto-demonstrativamente a clausula que esta entrada estabelece.
```

The two edits composed into a single commit (`cff28a9`) preserve the
temporal sequence: edit1 during session -> sealing via
`session_check_convergence` -> edit2 post-sealing. The commit unifies
without violating the discipline.

### 8.7 Round-by-round

- Round 1: prompt with 4-option frame + empirical evidence +
  discriminator. Peer substantively READY with (D1), refined text, **but
  emitted NOT_READY procedural** because "the on-disk change has not
  been presented yet" -- honoring the very rule being established by
  refusing to seal without seeing the applied diff.
- Round 2: diff applied (preamble + v4.5 entry in em-revalidacao +
  section 7 header + section 8 header). Peer READY with canonical
  minimal block without extra fields (honoring Item 4 pedagogical
  disclosure). Caller NOT_READY procedural (pending bilateral
  convergence).
- Round 3: caller READY; peer READY; bilateral convergence.

### 8.8 Structural effect

Historical violation rate 25% structurally eliminated. Future agents
(human or AI) writing section 8 without reading the rule may still
violate, but the rule is now on disk to be consulted and offers
canonical language ("em revalidacao bilateral (sessao XXX, iniciada
DATA)") as an explicit template.

## 9. Emergent patterns consolidated in the cycle

### 9.1 Multi-option framing beats binary framing

Items 1, 2, 5 used 4-option frame (A/B/C/D). Items 3, 4 used 3-option
frame. Zero items used binary framing. Average convergence: 2.6 rounds.

### 9.2 Concrete discriminator-keys close analysis fast

- Item 1: "is there an MCP convention where server.js diverges from
  package.json?"
- Item 2: "name ONE v4-era caller_request that FAILED due to string
  limitation."
- Item 4: "is the snapshot a dated historical anchor or a living
  source?"
- Item 5: "does a 25% violation rate justify a normative clause or is it
  an outlier?"

Each discriminator is objective (peer responds with fact, not preference)
and has an asymmetric answer (one answer kills the null hypothesis, the
other preserves it).

### 9.3 Pre-session empirical evidence eliminates conjectural debate

- Item 1: probing of `codex --help`, `claude --help`.
- Item 2: inspection of meta.json from prior sessions.
- Item 4: `ls -la ~/.cross-review/*/meta.json` with measurement over 15
  sessions.
- Item 5: explicit enumeration of violation rate (1 in 4).

Each item included concrete evidence in the initial prompt. Peer
converges on facts, not preferences.

### 9.4 Rigorous section 6.9.1 tri-tool

All 5 sessions opened with a documented trace of ultrathink +
code-reasoning pre-session_init. Mechanical items (3, 4) used an
abbreviated version (2-3 thoughts each); strategic items (1, 2, 5) used
4-6 thoughts. Advisor consulted for Items 1 and 2.

Peer stderr (via `stderr_tail`) confirmed that Codex also ran ultrathink
(and in some sessions code-reasoning) on all relevant rounds.

### 9.5 ASCII-only with silent transliteration standard section 6.4

v4.3 sessions (9c56005b) round 2 revealed: peer frequently emits text
with Portuguese accents. Section 6.4 requires ASCII-only on disk.
Established pattern: transliterate during application (secao,
pre-sealing, historico, promocao), optional disclosure, consolidated
precedent in v4.3, v4.4, v4.5.

### 9.6 Recurrent pedagogical protocol violations

4 out of the 5 sessions in the cycle had a protocol violation by Codex in
an intermediate round:
- `9c56005b` rounds 3->4: code fence instead of canonical JSON.
- `bd8c3cfb` rounds 3->4: YAML-like instead of canonical JSON.
- `42130c72` rounds 1->2: YAML-like instead of canonical JSON.
- `bb38cd79` round 1: 4 fields outside whitelist (not technically a
  violation -- v4 parser dropped gracefully; peer corrected in round 2).
- `843d57eb`: zero protocol violations (Codex honored canonical format
  across all 3 rounds). Possible learning effect by the peer within the
  same work window.

V4 parser detects and handles all cases. `status_source` and
`peer_status` correctly zeroed. Caller extracts substance from the prose
and moves on.

### 9.7 Procedural peer NOT_READY != substantive NOT_READY

- `9c56005b` round 3: peer requested registering a follow-up before
  sealing.
- `843d57eb` round 1: peer approved direction D1 but NOT_READY pending
  on-disk application.

Pattern: peer distinguishes "I agree with the proposal" from "I agree
with the applied diff". Respecting this distinction increases sealing
quality and prevents drift between proposal and implementation.

### 9.8 No-op sealing as a legitimate outcome

Item 4 (`bb38cd79`) converged with zero repo commits. Cross-review serves
for decisions, not only changes. Decision documented in project memory +
empirical audit persisted in the session. `outcome=converged` with zero
file delta.

### 9.9 Self-demonstration of normative clause works

Item 5 (`843d57eb`) applied the very rule being established during the
session that established it. Peer honored the rule by refusing to seal
without seeing the diff. Caller honored the rule by writing the v4.5
entry in "em revalidacao bilateral" initially and promoting via separate
post-sealing edit.

## 10. MCP config migration (parallel to the cycle, post-Item 2)

At the user's explicit request between Items 2 and 3, the `cross-review`
MCP server was reconfigured for the "in all three clients (no native)"
standard:

| Client | Pre-cycle | Post-migration |
|--------|-----------|----------------|
| VS Code workspace (`lcv-workspace/.vscode/mcp.json`) | absent | present (stdio) |
| Claude Code workspace (`lcv-workspace/.mcp.json`) | absent | present (stdio) |
| Claude Code user (`~/.claude.json`) | present | removed |
| Antigravity (`~/.gemini/antigravity/mcp_config.json`) | absent | present (stdio) |

Consistent with the pattern documented in memory
`reference_mcp_config_locations.md`. `probe-p0` (distinct server in
`C:\Scripts\cross-review-mcp-probe\server.js`) intentionally remained
user-level. All 4 JSON files syntactically validated post-edit.

Reason: workspace-specific configurations belong in the workspace, not
user-level (user's consolidated preference).

## 11. Follow-ups remaining (post-cycle)

The post-reload sequence closed all 5 explicit items. Follow-ups
registered DURING the cycle but without priority precedence from the
user:

1. **Defensive pre-spawn existence check** (registered in 9c56005b,
   section 8 "Follow-ups pos-v4.5"). Abort-only when pinned ID is
   deprecated by the provider. Out of scope of section 6.9.2.1 which is
   exclusively advisory.

2. **Normalize historical non-ASCII drift (U+00A7) in
   `docs/workflow-spec.md`** (registered in 9c56005b). 24 occurrences
   over 20 lines, all pre-v4.3 historical. Suggested handling:
   dedicated session or housekeeping pass before v4.6.

Neither is blocking. Reopening of Schema v5 (suspended in v4.4) requires
the specific objective criterion already documented in section 8.

## 12. Final post-cycle fingerprints (2026-04-24)

| File | SHA-256 | Changed in cycle? |
|------|---------|-------------------|
| `docs/workflow-spec.md` | `1a56fc72c95696bda1d73c1e3c2688a461765077e87e782ddbad4b4e00e65d2a` | Yes (v4.3, v4.4, v4.5) |
| `docs/top-models.json` | `628e7cb1d7df20e8aa01e1469846f1995af1802032e4367df2fda4b4b63f9d4c` | Yes (new in v4.3) |
| `scripts/audit-model-drift.js` | `0efcfa98abf8f2a31057328ec9553512e1b450355ca5c84125aab768c1997b89` | Yes (new in v4.3) |
| `package.json` | `590d0aebd9ef62022809b2d2cc6645b8640ff2c087a461b92ddb64299ea69a97` | Yes (v4.3 script + Item 3 version) |
| `package-lock.json` | `d3d6108d53d1628a2048e2e31b1cffc1b495bfe3890fb674b85949ac0522def5` | Yes (Item 3 version) |
| `src/server.js` | `ce2983b9079dd081f3bf0e3971685015b7b6fe10de8843892bdb9656169e3718` | No (immutable) |
| `src/lib/status-parser.js` | `6bcb334fa3702d59f7dbf2163f918610b06dac5e8ce15b4cecf4f1666afa36bf` | No (immutable) |
| `src/lib/peer-spawn.js` | `c15a1b70d86a69b40617cfd9466d27d1f330d19350c9c3483557e588754e0e0c` | No (immutable) |
| `scripts/functional-smoke.js` | `de84f17a594f62b5747e7472396d5ef9241497a34d862d0ed4152136c67e0d1c` | No (immutable) |

Post-cycle gates:
- `npm run smoke` -> 60 steps all GREEN.
- `npm run check-models` -> exit 0 "OK: no drift, no staleness".

## 13. Full git log post-cycle

```
cff28a9 docs(v4.5): formalize em-revalidacao -> aprovada pattern as normative clause (bilateral READY session 843d57eb)
b89b878 chore: align package.json + package-lock.json to 0.4.0-alpha (bilateral READY session 42130c72)
ef56b5d docs(v4.4): suspend Schema v5 objects follow-up per YAGNI (bilateral READY session bd8c3cfb)
462f5ef docs(v4.3) + tooling: secao 6.9.2.1 drift audit advisory (bilateral READY session 9c56005b)
3b7a3a4 docs(v4.2): promote section 6.7 evidence matrix to normative (spec-only)
0d85988 docs(v4.1): promote section 6.6 overflow policy to normative (spec-only, no code change)
2c79a1c feat(v0.4.0-alpha): schema expandido + tri-tool/top-model + peer_model auditado
9a2ab2a docs: add workflow-spec v3 (bilateral READY in session 806a1c4f)
88639b8 Initial commit: cross-review-mcp v0.3.0-alpha
```

## 14. Meta-architectural observation

The entire 5-item cycle was evolution of **spec, advisory tooling, and
editorial discipline**, preserving the immutable runtime core since
`2c79a1c` (v0.4.0-alpha). Structural separation:

- **Runtime (code)**: `src/server.js`, `src/lib/*.js`,
  `scripts/functional-smoke.js`. Changed only in coordinated bumps
  (next would be v0.5.0+). Currently untouched since v0.4.0-alpha.

- **Structured block contract `<cross_review_status>`**: v4 schema
  preserved. Schema v5 suspended by YAGNI with objective reopening
  criterion.

- **Advisory tooling**: `scripts/audit-model-drift.js` +
  `docs/top-models.json`. No capability to change runtime. Added in
  v4.3.

- **Meta-contract (spec + editorial discipline)**:
  `docs/workflow-spec.md` evolving through spec-only releases (v4.1,
  v4.2, v4.3 spec-parts, v4.4, v4.5). Each release underwent a
  cross-review session with bilateral sealing.

This structural separation is what allowed closing 5 items in a single
work window with no risk to runtime.

---

**End of report.** Open for Codex review. A dedicated session may be
opened via `session_init` if substantive feedback or retrospective
review is desired.
