<p align="center">
  <img src=".github/assets/lcv-ideas-software-logo.svg" alt="LCV Ideas &amp; Software" width="220">
</p>

# cross-review-v1

> MCP server orchestrating CLI-only cross-review between Claude Code, ChatGPT Codex, Gemini CLI, and an embedded DeepSeek CLI.

[![status: stable](https://img.shields.io/badge/status-stable-brightgreen.svg)](#status)
[![npm](https://img.shields.io/npm/v/@lcv-ideas-software/cross-review-v1.svg)](https://www.npmjs.com/package/@lcv-ideas-software/cross-review-v1)
[![spec: v4.14](https://img.shields.io/badge/spec-v4.14-informational.svg)](./docs/workflow-spec.md)
[![MCP](https://img.shields.io/badge/MCP-stdio-blue.svg)](https://modelcontextprotocol.io/)
[![license: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

**Install.** `npm install -g @lcv-ideas-software/cross-review-v1` (npmjs.com) or `npm install -g @lcv-ideas-software/cross-review-v1 --registry=https://npm.pkg.github.com` (GitHub Packages mirror).

**Status.** Stable. Current release: **v1.6.1** runtime paired with **spec v4.14**. See [CHANGELOG.md](./CHANGELOG.md) for the release history. v1.x releases follow a frozen-public-surface contract (see [CONTRIBUTING.md](./CONTRIBUTING.md) for the v1.x semver policy: patch additive within frozen surface, minor additive only, major requires a new trilateral cross-review session). v1.0 was cut on 2026-04-25 after a 10-session field-use validation gate per operator directive 2026-04-24, ratified by trilateral final approval session `fca13b80`.

The version history at a glance:

| Release | Spec | Scope |
|---|---|---|
| **`v1.6.1`** | v4.14 | **Review focus tightening.** The existing provider-neutral `review_focus` block is now explicitly treated as a front-loaded scope anchor and tells reviewers to label unrelated findings as `OUT OF SCOPE` instead of turning them into blockers, unless the issue is a critical cross-cutting blocker that invalidates the result. |
| **`v1.6.0`** | v4.14 | **Provider-neutral review focus.** `session_init`, `ask_peer` and `ask_peers` accept optional `review_focus` so callers can anchor reviewers on a specific code area or decision surface without sending provider-specific slash commands. The value is persisted as `meta.review_focus`, bounded/redacted before prompt injection, and prepended as a plain `Review Focus` Markdown block for all CLI peers. This is a minor release because it adds optional public MCP tool parameters without breaking existing callers. |
| **`v1.5.1`** | v4.14 | **Release automation and CodeQL hardening.** `auto-tag.yml` now dispatches `publish.yml` explicitly after creating a tag because tag pushes made with `GITHUB_TOKEN` do not trigger a second workflow. `publish.yml` validates version-tag refs before checkout and uses Node.js 24 / npm 11+ for Trusted Publishing. The v1.5.0 CodeQL `js/insecure-temporary-file` alert in the smoke harness was closed by moving the DeepSeek MCP fixture config into a unique `fs.mkdtempSync(...)` directory. |
| **`v1.5.0`** | v4.14 (§6.26 NEW — embedded DeepSeek CLI + quadrilateral peer set) | **DeepSeek joins as a fourth peer while v1 remains CLI-only.** The server still spawns peers as subprocesses and sends prompts through stdin; DeepSeek is invoked through `cross-review-v1`'s own embedded CLI (`cross-review-v1-deepseek-cli`) instead of any Gemini-derived third-party CLI. The embedded CLI calls DeepSeek's OpenAI-compatible API with `deepseek-v4-pro`, `thinking=enabled`, `reasoning_effort=max`, supports stdio MCP servers through `--mcp-config` / `--allowed-mcp-server-names`, and deliberately contains no references to other provider profile directories. `VALID_AGENTS` remains `claude|codex|gemini` for caller resolution; `VALID_PEERS` is now `claude|codex|gemini|deepseek`, so `ask_peers` runs quadrilateral consensus when one of the three caller agents opens a session. |
| **`v1.4.1`** | v4.14 | **Public rename to cross-review-v1.** Package, bin, repository, Sponsors/Page URL, `server_info` links, active documentation, and publishing workflows now use `cross-review-v1`. No protocol behavior changed. |
| **`v1.4.0`** | v4.14 (§6.25 NEW — classifier hardening + Codex sandbox config + DeepSeek deferral) | **Classifier hardening + Codex Windows-sandbox workaround + `server_info` ownership; DeepSeek deferred to v1.5.0.** R1 of the v1.4.0 pre-commit cross-review (session `bf4ffea3`) revealed three problems: (i) `detectSpawnRateLimit`'s `429` matcher was a bare-substring check that tripped on grep line numbers (`299:`, `429:`, `1429`), misclassifying the upstream Codex CLI Windows sandbox bug (PowerShell `ConstrainedLanguage` — see `reference_codex_cli_sandbox_constrained_language.md`) as `rate_limit_induced_response`; (ii) the Codex peer is operationally unusable on Windows under the default `-a never -s read-only` because of that same upstream sandbox bug, with no opt-in workaround; (iii) integrating DeepSeek via `deepseek-cli` would have introduced a `cmd.exe` newline-truncation + command-injection vector because the CLI takes the prompt only as positional argv. **(A) `detectSpawnRateLimit` is now contextual:** `RATE_LIMIT_LEXEMES` is internally `RATE_LIMIT_PATTERNS` (regex-anchored); the `429` lexeme requires HTTP / status / error / parens / JSON context; phrase tokens (`Too Many Requests`, `rate limit`, `usage limit`, `quota exceeded`, `insufficient_quota`, `RESOURCE_EXHAUSTED`, `Retry-After`) match on word boundaries with phrase constraints. Backward-compat export shape preserved. **(B) `classifyStderr` new `codex_windows_sandbox` class** in `STDERR_CLASS_PATTERNS`, regex matching `InvalidOperation: Cannot set property. Property setting is supported only on core types`, `ConstrainedLanguage`, `PowerShell AST parser`, `blocked by sandbox (windows)`. Precedence ABOVE `rate_limit` so the v4.14 R1 misclassification cannot recur. The `rate_limit` regex was also tightened to mirror (A)'s contextual `429` shape. **(C) Codex sandbox/approval policy is configurable** via `CROSS_REVIEW_CODEX_SANDBOX={read-only\|workspace-write\|danger-full-access}` (default `read-only`), `CROSS_REVIEW_CODEX_APPROVAL={never\|on-request\|on-failure\|untrusted}` (default `never`), and `CROSS_REVIEW_CODEX_BYPASS={1\|true}` (emits `--dangerously-bypass-approvals-and-sandbox` and drops `-a`/`-s`). Invalid values throw at spawn time. Resolved policy logged once at startup via `logCodexSandboxPolicy()` (silent on default; one-line stderr notice on divergence). **(E) `server_info`** now returns `publisher: "LCV Ideas & Software"` + `sponsors_url: "http://cross-review-v1.lcv.app.br"` (mirrored under `links.sponsors`). **DeepSeek deferral:** integrating DeepSeek via `deepseek-cli` was empirically reproduced as unsafe on Windows (`shell: true` lets `cmd.exe` truncate argv at the first `\n` even inside double quotes — silent prompt truncation + command injection on subsequent lines). The `node.exe + shell:false` paliative was rejected (prompt still in argv / process list with command-line caps). DeepSeek is therefore deferred to v1.5.0 with an explicit secure-transport requirement (direct SDK/API or a CLI that accepts stdin/file). **(D) Regression smoke:** 4 new drive functions covering provider-shaped 429 positive cases, line-number/timestamp/path negative cases, Codex-sandbox-class precedence, env-var override combos, and `server_info` field anti-drift. |
| `v1.3.0` | v4.14 (§6.24 NEW — heartbeat in meta.in_flight + stderr classification + evidence attach tool) | **Closes the deferred half of Codex's handoff (Findings 4, 5, 8 from the Maestro v0.3.10 cross-review session 28343cdb).** Three additive features. **Minor bump** (vs v1.2.x patch series) because Finding 8 introduces a new MCP tool `session_attach_evidence` — that exceeds the "patch additive within frozen surface" contract per CONTRIBUTING.md. (1) **Heartbeat in `meta.in_flight`** (Finding 4): `markRoundInFlight` / `updateRoundHeartbeat` / `clearRoundInFlight` / `withRoundHeartbeat` helpers in session-store. ask_peer + ask_peers handlers wrap their spawn calls with `store.withRoundHeartbeat` so meta.in_flight is set before peer invocation, refreshed every `HEARTBEAT_INTERVAL_MS` (default 15s, configurable via `CROSS_REVIEW_HEARTBEAT_INTERVAL_MS` env var), and cleared on resolve OR reject. Audit consumers reading meta.json can distinguish in-progress vs hung-after-caller-crashed. (2) **`classifyStderr` + noise classes** (Finding 5): new helper classifies stderr text into one of 8 noise classes — `auth_expired`, `command_not_found`, `tool_unavailable`, `rate_limit`, `cloudflare_challenge`, `plugin_warning`, `analytics_warning`, `terminal_advisory`, plus `unknown` fallback. First-match-wins on primary class but ALL matched patterns appear in `signals[]`. `saveFailedAttempt` automatically adds `stderr_classification` to the audit entry when the tail matches a known class. Non-destructive: raw stderr_tail is preserved. (3) **`session_attach_evidence` MCP tool** (Finding 8): new tool writes evidence artifacts (Playwright traces, screenshots, metric dumps, diff bundles) under `~/.cross-review/<session-id>/evidence/<timestamp>-<sanitized-label>` and updates `meta.evidence[]` with manifest entries (filename, path, size, content_type, attached_at, label). Caller-supplied label is sanitized server-side; size cap 1 MiB per file. 3 new smoke functions, 19 invariants total → smoke 241 GREEN (was 222). |
| `v1.2.18` | v4.14 (§6.23 NEW — concurrence injection + diagnostic propagation + summary field + convergence_scope) | **Operator-driven improvements from Codex's technical handoff after Maestro Editorial AI v0.3.10 cross-review (session `28343cdb`).** Four additive fixes within the v1.x frozen surface: (1) **Concurrence auto-injection** (Findings 1+2): new opt-in `concurrence: boolean` parameter on `ask_peer` and `ask_peers`. When true, the server walks `meta.rounds` in reverse and finds the most recent round where each peer reported `peer_status='READY'`; the verbatim artifact content is auto-prepended to that peer's prompt as a self-describing block with anti-hallucination guidance (the peer is explicitly instructed NOT to rubber-stamp). Per-peer injection in `ask_peers` via `spawnPeers` `options.perAgentPrompts` — each peer sees only its own prior artifact, no cross-contamination. Response includes `concurrence_artifact_injected` (ask_peer) / `concurrence_artifacts_injected: { agent: peer_file or null }` (ask_peers) for caller audit. Closes the gap where stateless peer subprocesses returned NEEDS_EVIDENCE on concurrence rounds because they had no in-context proof of their prior verdict. (2) **`convergence_scope` field** (Finding 6): new field on convergence snapshots derived from responded/excluded peer counts. Values: `trilateral`, `bilateral`, `degraded_bilateral`, `degraded_none`. Lets callers distinguish triangular unanimity from bilateral fallback at a glance. (3) **`spawn_rejected` diagnostic propagation** (Finding 3): `ask_peer` and `ask_peers` handlers now propagate `exit_code`, `transport_descriptor`, `duration_ms`, and a separated `stderr_tail` (not just the stringified Error message) into both `saveFailedAttempt` audit and the response payload. spawnPeer was already attaching these fields to the rejection error since v1.2.5 — the wires were missing in server.js. (4) **`summary` accepted as structured field** (Finding 7): added to `OPTIONAL_FIELDS` in `status-parser.js`. Peer responses commonly emit a `"summary": "..."` block; pre-v1.2.18 the parser warned `unknown field 'summary' ignored` on every such response. Now the field round-trips cleanly into `peer_structured.summary` with no warning. 4 new smoke functions, 11 new invariants → smoke 220 GREEN (was 209). No breaking change. |
| `v1.2.17` | v4.14 (§6.22.1 v1.2.17 amendment — npm-shim recognition + findOrphans wiring anti-drift) | **Follow-up to v1.2.16 hotfix.** Surfaced by gemini in retro cross-review session `cb41f835` R1 (post-deploy validation of v1.2.16 under operator-authorized exception). Two findings shipped together: (1) **npm-shim false-negative**: `spawnPeer` runs with `shell: true` per spec §6.21; on Windows, an npm-installed peer CLI surfaces as a TWO-process tree — `cmd.exe /d /s /c "<peer> <args>"` shell wrapper + `node.exe "<path>\<peer>.js" <args>` worker. The strict v1.2.16 argv[0] basename check missed both, leaving npm-installed peers uncovered by the orphan sweep. v1.2.17 adds two argv-tail-recurse patterns to `isPeerCliCommand`: cmd.exe wrappers (basename token + peer-spawn flag) and node.exe workers (path containing `<peer>...\.(js\|cjs\|mjs)` + peer-spawn flag). The Bug #2 ancestor guard from v1.2.16 continues to protect the host independently of matcher verdict — defense in depth holds. (2) **findOrphans wiring anti-drift**: source-level smoke assertion locks the structural wiring of `findOrphans` inside `sweepOrphanPeerProcesses` and the `ancestorPidSet` + `ancestors.has(p.pid)` calls inside `findOrphans` itself. Mirrors the v1.2.16 wiring assertion for `killProcessTreeIsSuicide`-before-win32-branch. 2 new smoke functions, 5 invariants total → smoke 209 GREEN (was 204). No breaking change. |
| `v1.2.16` | v4.14 (§6.22.1 NEW — orphan-sweep self-suicide hotfix) | **Critical hotfix — boot orphan peer sweep was killing the host Claude Code process tree (which includes cross-review-v1 itself, producing coordinated suicide and Claude Code exit code 1).** Two independent bugs introduced in v1.2.15: (Bug #1) `isPeerCliCommand` regex `\bclaude(?:\.exe)?\b.*\b(code|--print|-p)\b` matched the literal substring `claude-code` inside every Claude Code installation path (`\anthropic.claude-code-X.Y.Z\claude.exe`) because `-` is a non-word-char that establishes a `\bcode\b` boundary; (Bug #2) `sweepOrphanPeerProcesses` only excluded DESCENDANTS of `ourPid` — Claude Code is an ANCESTOR (Claude Code → cross-review-v1 via stdio), so nothing protected the host. Mechanics: `setImmediate` after `server.connect()` runs the orphan sweep; `Get-CimInstance Win32_Process` lists all PIDs; the false-positive regex tags `claude.exe` (parent); descendant-check + sibling-parent-rescue both miss; `killProcessTree({ pid })` runs `taskkill /PID <claude.exe> /T /F`; `/T` reaps the entire tree (Claude Code + cross-review-v1 itself). v1.2.16 ships 3 layered fixes: (1) `parseArgv0AndRest` extracts argv[0] basename from the WMI `CommandLine` / `ps -eo args` (handles quoted/unquoted/bare argv[0]); `isPeerCliCommand` now requires exact basename match (`codex`/`codex.exe`, `claude`/`claude.exe`, `gemini`/`gemini.exe`) AND a peer-spawn-only flag in the argv tail (anchored `(?:^\|\s)flag(?:\s\|$)`); the `code` subcommand is removed from the claude pattern (peer claude uses `-p --output-format text ...`, not `code`). (2) New pure helper `findOrphans(procs, ourPid)` builds an `ancestorPidSet` walking up to 32 levels of parent chain inclusive of self, and refuses to classify any ancestor as orphan — defense in depth even if a future regex regression re-introduces a false-positive. (3) Belt-and-braces `killProcessTreeIsSuicide(pid)` at the kill primitive: `killProcessTree` returns immediately with stderr telemetry when `pid === process.pid \|\| pid === process.ppid` (cheap O(1) check, last line of defense for any future caller passing an ancestor PID). 3 anti-drift smoke invariants (`driveV1216ArgvBasenameMatchUnit`, `driveV1216FindOrphansAncestorSkipUnit`, `driveV1216KillProcessTreeRefusesSuicideUnit`) lock all three guards. **Workaround until v1.2.16 is deployed**: set `CROSS_REVIEW_SKIP_BOOT_SWEEPS=1` in each MCP host config to disable boot sweeps entirely — trade-off is that orphan locks/peers from previous runs aren't auto-cleaned. |
| `v1.2.15` | v4.14 (§6.22 NEW — Lock & Session Resilience) | **Self-healing lock + orphan-peer recovery (8 items, A–H).** Operator-reported bug: the cross-review-v1 could leave sessions wedged with stale `.lock` directories after host reload/SIGKILL, blocking re-use of those session_ids until the 1h TTL expired; orphaned peer-CLI subprocesses (codex/gemini/claude `exec`) continued consuming API tokens after the parent died. v1.2.15 adds 8 layered fixes: (A) `LOCK_TTL_MS` configurable via env, default reduced from 60min→5min; (B) startup lock sweep — at boot, removes `.lock` directories whose holder pid is dead OR whose `acquired_at` exceeds TTL; (C) PID liveness check inside `acquireLock` — dead-holder detection releases the lock immediately regardless of TTL (Windows: `tasklist /fi "PID eq <n>"`; POSIX: `process.kill(pid, 0)`); (D) `session_init` returns advisory `pending_sessions` field listing same-caller sessions with `outcome=null` and `last_updated_at > 10min` — caller decides finalize/resume; (E) half-written round detection — `ask_peers` archives orphaned `round-NN-prompt.md` files (no peer responses recorded, no active lock) to `round-NN-prompt.orphan-<ts>.md` so audit trail is preserved and round numbering advances cleanly; (F) round-level + per-peer timeouts — `CROSS_REVIEW_PEER_TIMEOUT_MS` (default 8min, was 30min) caps individual peers; new `CROSS_REVIEW_ROUND_TIMEOUT_MS` (default 12min) wraps `spawnPeers` so wedged peer machinery can't hang the entire round; (G) `CROSS_REVIEW_SWEEP_MIN_AGE_MS` env override (default 24h) for `session_sweep` hard floor — relaxes the footgun guard during operational recovery; (H) startup orphan peer-CLI sweep — at boot, enumerates running processes via `Get-CimInstance Win32_Process` (Windows) / `ps` (POSIX), matches argv signatures (`codex exec`, `gemini -p`, `claude code`), classifies as orphan when parent pid is dead or not a current cross-review-v1 instance, then `taskkill /T /F`. Sweeps run fire-and-forget AFTER `server.connect()` so initialize handshake stays responsive; opt-out via `CROSS_REVIEW_SKIP_BOOT_SWEEPS=1` for CI/test environments. No breaking changes — all defaults are conservative; existing callers see no behavior delta unless their session was wedged. |
| `v1.2.14` | v4.14 | **Package scope migration: npm/GitHub Packages publishing moves from `@lcv-leo/cross-review-v1` to `@lcv-ideas-software/cross-review-v1` after the GitHub repository transfer to `LCV-Ideas-Software`.** No runtime behavior change; package metadata, install instructions, publish workflow scopes, lockfile package name, and `server_info.links` now point at the organization-owned repository/package. The old scoped package cannot be transferred directly under npm rules because the scope is part of the package name; the publish workflow deprecates it after the org-scoped package is published successfully. |
| **`v1.2.13`** | v4.14 | **Packaging fix: `reviewer-configs/` was missing from npm tarball, breaking peer spawn for all `npm install -g` users.** The `package.json:files` manifest enumerated `src/` + license/docs but omitted `reviewer-configs/` — so `peer-exclusions.json` and `reviewer-minimal.mcp.json` (read at peer-spawn time by `src/lib/peer-spawn.js:78-80`) were never shipped to users who installed from the npm registry. Locally-cloned dev installs were unaffected (the source repo has the directory) but production hosts saw `ENOENT: no such file or directory, open '...reviewer-configs/peer-exclusions.json'` at every peer spawn, blocking codex and gemini transports entirely. The bug was discovered when an admin-app session run by Claude Code hit the failure path during a mandatory pre-commit cross-review (operator directive 2026-04-26 §`feedback_cross_review_mandatory_pre_commit.md`); the workaround was a manual file copy from the source repo into the installed location, but that does not fix it for any other host. v1.2.13 adds `"reviewer-configs/"` to the `files` manifest so the next `npm publish` includes the directory. No code change, no spec change. Discovered indirectly via cross-review session `050bb2be-e900-4329-b9ae-dbf9adb8f5f2` (the admin-app sanitizer fix unrelated to this packaging bug). |
| `v1.2.12` | v4.14 (§6.20 v1.2.12 simplification) | **Bugfix + spec tightening: remove `CROSS_REVIEW_CALLER` env-var fallback entirely; caller is now resolved dynamically per session via `args.caller > clientInfo.name` only.** Pre-v1.2.12 the server hard-failed at startup with exit code 1 if `CROSS_REVIEW_CALLER` was unset, contradicting §6.20's dynamic resolution chain (the env var was nominally the third-precedence fallback but was actually a startup hard requirement). Operator caught the contradiction after stripping the env var from all 4 host configs (Claude Code, VS Code, Antigravity, Codex CLI) per the dynamic-caller principle: the AI model that called the tool MUST declare its own identity, never via operator-configured env state. v1.2.12 changes: (a) startup no longer reads or requires `CROSS_REVIEW_CALLER`; if the var is set in a stale config, the server emits a one-shot deprecation notice to stderr and ignores it; (b) `resolveCallerForSession` precedence reduced from 3 tiers (args > clientInfo > env) to 2 tiers (args > clientInfo) — throws when both fail; (c) module-level `CALLER` / `PEERS` / `LEGACY_PEER` constants removed (handlers now read from session `meta.caller` set at session_init time, with explicit validation throwing on missing/invalid values); (d) `escalate_to_operator` now reads the `from_agent` actor from `sessionMeta.caller` instead of the global `CALLER` (pre-v1.2.12 it silently recorded the wrong actor when env mismatched session resolution); (e) startup banner trimmed to drop env-derived caller/peers fields. 9 new anti-drift smoke invariants split across three test functions: 3 child-process startup invariants in `driveV414StartupNoEnvVarIntegration` (server boots cleanly with env unset, deprecation notice fires when env set, session_init throws on unrecognized clientInfo + missing args.caller); 1 export-removal regression guard in `driveV414CallerResolutionUnit` (env-derived globals are not exported); 5 doc-drift guards in `driveV414CallerEnvDocDriftUnit` (session_init tool description + caller-arg description + spec §6.20 normative precedence list + README "Register with each peer" env-snippet rejection in CLI/TOML/JSON forms + spec-doc-wide present-tense framing scan). Spec doc rewritten in 6 places to reflect two-tier resolution (executive summary §0n + §2.8 dynamic role assignment + §3 changelog cross-references + §5.1 canonical-id naming examples + §6.20 normative precedence + §7 summary table); README "Register with each peer" section updated to remove env-var instructions in all 3 peer snippets. Smoke 188 GREEN (was 179 in v1.2.11). |
| `v1.2.11` | v4.14 | **Audit-doc narrative correction + pre-existing biome cleanup carry-over.** Primary motivation: the round-7 audit-doc closing paragraph said "no version bump / runtime remains v1.2.8 / commit-time gate, not version-bump-time gate" — accurate at round-7 commit time, but stale after v1.2.9 (bookkeeping bump retroactive to commit `11d95a0`) retired the "commit-time gate" framing in favor of strict workspace `.agents/workflows/version-control.md` §6 patch-bump-on-any-modification. v1.2.11 preserves the original paragraph as the historical record of round-7's decision and appends a `**v1.2.11 update**` clarification block stating: (a) v1.2.9 made the bump retroactive after operator catch; (b) the "commit-time gate" framing is retired; (c) workspace policy is patch-bump-on-any-modification, independent of whether bytes shipped to npm change; (d) v1.2.10 + v1.2.11 both bump under the same rule on doc-only edits. Single-source verified at audit time (pre-release source audit, before this README row + the CHANGELOG v1.2.11 entry were written) — only the audit-doc carried the stale narrative; CHANGELOG:284 + README:27 hits at that time were about v1.2.2's `§6.10.1 clarification` (a different, accurate historical record). The v1.2.11 release notes deliberately quote the stale phrases as contextualized correction text, so post-release the same grep also matches the v1.2.11 release-notes citations themselves — intentional, not unfixed. **Carry-over:** v1.2.11's own gate ran `biome check src scripts` (broader than v1.2.7's per-file scope) and surfaced 4 pre-existing errors in `scripts/probe-reviewer-isolation.js` (3 `useNodejsImportProtocol` + 1 `noAssignInExpressions`) and 2 format-only errors in `src/lib/{model-parser,status-parser}.js` (CRLF + single quotes + non-default line wrap). Per `feedback_fix_preexisting_errors.md` all were fixed in this ship. No semantic change to runtime — `useNodejsImportProtocol` is `require('fs')` → `require('node:fs')` (identical resolution), the `while`-loop refactor is byte-equivalent to the assign-in-expression form, and biome's default formatter pass on the parsers swaps quote style + wraps long lines (zero JS-value change in the regex/string constants). Smoke 179 GREEN re-verified post-reformat. |
| `v1.2.10` | v4.14 | **Cosmetic: README version-history table inverted to newest-first ordering.** Operator-requested. The table previously listed releases in chronological order (oldest at top, newest at bottom); reordered so readers see current state immediately and walk back through history. No content change to any row text. No code change, no spec change. Per workspace `version-control.md` §6, even cosmetic text reordering qualifies as "mudança de texto" and requires a patch bump. |
| `v1.2.9` | v4.14 | **Audit-trail bookkeeping bump.** Round-7 follow-up section was added to `docs/external-audit-2026-04-26-gemini.md` in commit `11d95a0` (caller-memory correction about CONVERGENCE_SPEC_VERSION being intentional two-constant design + neutral verdict-criterion adjudication of Gemini's NOT_READY vs Codex's READY-with-residuals + two precision-correction phrasings). That commit was initially pushed without a version bump per advisor guidance ("npm bytes unchanged → no need"). Operator caught the omission: workspace `.agents/workflows/version-control.md` §6 mandates patch bump for ANY modification including text changes ("mudanças de texto"). v1.2.9 closes the bookkeeping gap. No code change, no spec change, runtime identical to v1.2.8; only the version field differs. Lesson recorded in Claude Code memory `feedback_workspace_rules_supersede_advisor.md`. |
| `v1.2.8` | v4.14 (§6.18.3 v1.2.7 amendment + v1.2.8 wording clarification) | **Doc-only clarification: F4 fallback wording tightened from overstated "real reap" to honest "best-effort proc-handle reap" + new explicit deferral bullet for tree-kill completeness under `shell: true`.** Round-6 audit on v1.2.7 (Gemini-orchestrated, codex meta-eval) approved v1.2.7 as READY but both peers correctly observed in their own meta-eval that under §6.21 `shell: true`, on Windows the proc handle Node holds is `cmd.exe` — so the v1.2.7 fallback `proc.kill('SIGKILL')` reaps the shell but does NOT walk the tree to the actual peer-CLI grandchild. v1.2.8 keeps runtime semantics unchanged (kill code is identical) and: (1) tones the wording in 4 surfaces (spec amendment + CHANGELOG + this README row + peer-spawn comment); (2) enriches operator-visible log messages on the fallback path with the cmd.exe-orphan caveat; (3) adds a 4th deferral bullet to v1.3.x list ("F4 fallback completeness under shell:true") with explicit interim-mitigation rejection notes (retry-taskkill, wmic walker — both have same shell-out failure modes); proper closure tied to §6.21 `shell: false` migration. No semantic change, smoke still 179 GREEN. Cross-review session `a8e7be3e` ran 3 rounds (operator override of caller's initial "doc-only no cross-review" judgment proved correct: codex caught a missed 3rd fallback path in R1 and 3 doc-drift items in R2; R3 trilateral READY). |
| `v1.2.7` | v4.14 (§6.18.3 v1.2.7 amendment) | **External-audit round-5 closure (F3 stream listener detach + F4 Windows taskkill fallback + comment drift fix).** Gemini-orchestrated round-5 against v1.2.6, codex-corroborated. **F3 (DoS streams):** pre-v1.2.7 the §6.18.3 RAM cap was a soft cap — `data` listeners stayed attached after `overflow()`/timeout while `killProcessTree` async'd, so in-flight events kept growing buffers from 4 MiB to 8-16+ MiB during the kill window. v1.2.7 detaches `proc.stdout`/`proc.stderr` `data` listeners via `removeAllListeners('data')` (pure JS, no race with `taskkill`) BEFORE invoking the kill, in BOTH `spawnPeer` (overflow + timeout) AND `probeAgent` (overflow + timeout) — 4 leak paths closed. **F4 (Windows reaping):** `killer.on('close')` non-zero-exit path used to only log; v1.2.7 falls back to `proc.kill('SIGKILL')` (no-op on dead processes via ESRCH catch, best-effort proc-handle reap on still-live ones — see v1.2.8 caveat) on BOTH `close`-nonzero AND `error` events. **Comment drift (codex catch):** `session-store.js:498-500` claimed failed-spawn peers were "excluded from denominator" — stale since v1.2.3 §6.18.1 strict-quorum (`rejected_count` counts AGAINST). Comment rewritten to current spec §6.12 + §6.18.1 contract. **Recommendations deferred to v1.3.x with explicit rationale:** request-boundary caps for `task`/`prompt`/`artifacts` (R3), behavioral peer-emulator harness for overflow paths (R4). 2 new structural anti-drift smoke steps; 179 GREEN total. |
| `v1.2.6` | v4.14 | **CodeQL hardening (defensive escape).** GitHub Code Scanning surfaced `js/incomplete-sanitization` (high severity) on `scripts/functional-smoke.js:1121`: the regex builder for the CHANGELOG-heading anti-drift smoke escaped only `.` from `server.VERSION` instead of all regex meta-characters. Technically a false positive (input is validated against `/^\d+\.\d+\.\d+$/` 10 lines earlier, so backslashes are impossible), but fixed defensively per `feedback_fix_dont_remove.md` — escapes the full meta-character set `[.*+?^${}()|[\]\\]`. No behavioral change; smoke still 177 GREEN. |
| `v1.2.5` | v4.14 (§6.18.3 + §6.18.4 + §6.21 amendments) | **External-audit round-4 closure (4 fixes + 1 spec note retiring shell:true repeats).** Trilateral session `53d0d785` (caller + codex + gemini) iterated R1→R2→R3 to address peer-flagged residuals. **§2 taskkill telemetry** (Windows process reaping): pre-v1.2.5 was fire-and-forget; v1.2.5 captures stderr_tail + exit code, logs on non-zero exit + spawn-error path. POSIX path simplified to direct PID kill (the previous group-kill `-pid` always threw ESRCH on non-detached spawns, swallowing catch never reached fallback → guaranteed zombies, caught by gemini R2). **§3 strict UUIDv4 + symlink resistance**: regex now enforces version+variant bits; `isPathContained` helper uses `path.relative` (Windows case-insensitive); `fs.realpathSync` applied after `ensureStateDir()` to detect symlink-traversal attempts a UUID-named symlink could plant. **§4.1 per-stream RAM cap** (spec §6.18.3): `PEER_STREAM_MAX_BYTES`=4 MiB on `spawnPeer`, `PROBE_STREAM_MAX_BYTES`=256 KiB on `probeAgent`; on overflow, kill process tree + reject with `stream_overflow` audit field; new `failure_class: 'stream_overflow'` classified in BOTH `ask_peer` + `ask_peers` handlers (recovery_hint=null — volumetric, not semantic). **§4.2 session_sweep delete_files** (spec §6.18.4): opt-in `delete_files: true` flag physically removes session directory after finalize; default false preserves audit trail. **§6.21 (NEW spec note)**: shell:true architectural decision recorded normatively to retire 4 audit rounds of repeat findings — cmd from pinned constants + repo-tracked configs, prompt via stdin, threat model is single-user trusted host. |
| `v1.2.4` | v4.14 (§6.18.2 amendment) | **External-audit round-3 closure (F8 persistence cap) + stale-version-string fix + new `server_info` tool.** F8: `clipForPersistence` 64 KiB cap with truncation marker. Stale literal: Gemini caught `'(advisory mode, v1.2.2)'` in v1.2.3 source; fixed via template `\`v${VERSION}\``. `server_info` tool: 9th MCP tool, returns `{ name, version, release_date, spec_version, tools, links }` — resolves runtime-vs-source ambiguity. Spec §6.18.2 + `RELEASE_DATE` constant + smoke vs CHANGELOG heading. |
| `v1.2.3` | v4.14 (§6.18.1 amendment) | **External-audit round-2 closure (F2 strict quorum + F5 lifecycle invariants).** Trilateral session `aa4770fc` validated 4 rounds of peer iteration. F2 (strict quorum): snapshot now requires `rejected_count === 0`, exposes the field, reason builder surfaces "${N} peer(s) failed at spawn". F5 (lifecycle): session_finalize acquires lock + safe-idempotent on identical retry with null-normalization that collapses empty/whitespace strings to null + throws on conflicting; ask_peer/ask_peers refuse finalized sessions; escalate_to_operator gets lock but explicitly allows post-finalization annotation. Spec §6.18.1 codifies. 8 new smoke invariants. |
| `v1.2.2` | v4.14 (§6.10.1 clarification) | **Peer-exchange language enforcement (B+C).** Field-evidence from a Gemini-initiated session that submitted a pt-BR `ask_peers` prompt motivated formalization of §6.10's caller responsibility: operator-facing chat language does NOT propagate to peer exchange. (B) Tool descriptions for `session_init`/`ask_peer`/`ask_peers` now carry an explicit en-US directive block. (C) Runtime detects non-en-US in `task` and `prompt` fields via two conservative signals (≥4 diacritics OR ≥3 pt-BR-specific lexemes); emits non-blocking advisory `task_language_warning`/`prompt_language_warning` field on the response with `confidence: low|medium|high`. Warn-only currently — operator may tighten to hard-reject after observing false-positive rate. Spec §6.10.1 clarification (no version bump) records the caller obligation. |
| `v1.2.1` | v4.14 | **External-audit hardening (Gemini audit 2026-04-26).** F1: `session_id` UUID validation in `sessionDir()` + `path.resolve` containment check (path-traversal defense). F7: `log()` prefix renamed `env_caller=` so it's clear the prefix names the server-instance config, not the resolved per-round caller. F8: stale `gemini-2.5-pro` reference in `ask_peer` description swapped for pinned `gemini-3.1-pro-preview` + new smoke step asserts no stale model IDs in tool descriptions. Audit roadmap at `docs/external-audit-2026-04-26-gemini.md`. F2/F3/F5/F6 deferred to v1.3+ with rationale documented. |
| `v1.2.0` | v4.14 | **§6.20 dynamic caller resolution.** session_init now resolves the caller per call with precedence `args.caller` > MCP `clientInfo.name` mapping > `CROSS_REVIEW_CALLER` env var. Each session's peers are computed dynamically from the resolved caller. ask_peer / ask_peers read caller and peers from `meta.json` (not global constants). New `meta.caller_resolution = { source, client_info_name }` audit field. README/spec/CHANGELOG anti-drift smoke step prevents recurrence of v1.0.4/v1.0.5-style doc lag. |
| `v1.1.0` | **v4.13** | Audit closure (FU-1..FU-4). §6.17 `meta.spec_version`; §6.18 `session_sweep` long-idle reconciliation + structured `outcome_reason`; §6.19 advisory `convergence_health` per round (`normal`/`extended`/`concerning`). 8th MCP tool: `session_sweep`. Validated by trilateral cross-review `483b2d1c` (READY in R2). |
| `v1.0.5` | **v4.12** | **§6.16 prompt-flag recovery contract.** New `failure_class: 'prompt_flagged_by_moderation'` + `recovery_hint: 'reformulate_and_retry'` + embedded `reformulation_advice` text on rejected peers. Caller MUST reformulate (up to 5 attempts) and resubmit; aborting on a moderation flag is non-conforming. 60-session audit shipped at `docs/session-audit-2026-04-26.md`. |
| `v1.0.4` | v4.11 | Workspace parity sweep + Pages enablement. Added `THIRDPARTY.md` + `.github/CODEOWNERS`. `actions/configure-pages` declares `with: enablement: true` for idempotency on forks/clones. Zero behavioral change. |
| `v1.0.3` | v4.11 | **Security patch.** ReDoS hardening: replaced `/\s+$/` regex with `String.prototype.trimEnd()` in `model-parser.js` and `status-parser.js` (CodeQL `js/polynomial-redos` alerts #1 + #2 resolved). Zero observable change. |
| `v1.0.2` | v4.11 | First npm publish. Renamed package to `@lcv-leo/cross-review-v1`, published to both npmjs.com and GitHub Packages with provenance attestations. Added `files` whitelist (-58% tarball size, 13 files). Zero behavioral change. |
| `v1.0.1` | v4.11 | Doc-only patch: refresh user-visible MCP tool descriptions (`session_init` / `session_read` / `ask_peer` / `ask_peers` / `escalate_to_operator` / tail directive) to current spec head. Removed stale alpha labels (`v0.5.0-alpha` / `v0.7.0-alpha`) and outdated cites (`spec v4.7` / `v4.8` / `v4.10`). Zero behavioral change. |
| `v1.0.0` | v4.11 | Stable cut. Frozen public surface: 7 MCP tools, structured peer-block contracts, `meta.json` semantics, strict-only convergence predicate, transport descriptor + audit fields/enums. v1.x follows the semver policy in CONTRIBUTING.md. Cut ratified by 10-session field-use validation gate (PRAGMATIC counting rule, 2026-04-24/25) + trilateral final approval session `fca13b80` (2026-04-25). |
| `v0.9.0-alpha.1` | v4.11 | Fix: Gemini auth detection precedence (settings.json → env → oauth_creds → default); eliminates false-positive `silent_model_downgrade` when `GEMINI_API_KEY` env is present in MCP host with oauth-personal CLI |
| `v0.9.0-alpha` | v4.11 | Public-GitHub pre-cut: en-US README + CONTRIBUTING + CODE_OF_CONDUCT + NOTICE + Apache-2.0 LICENSE + full-history secrets scan |
| (spec-only) | v4.11 | Claude CLI banner parsing follow-up CLOSED as negative empirical result |
| `v0.7.0-alpha` | v4.10 | Anti-hallucination / epistemic discipline + CLI banner as authoritative attestation (Codex-specific) |
| `v0.6.0-alpha` | v4.9 | Transport-aware model-check bypass + strict-only convergence with persisted snapshot + rate-limit class |
| `v0.5.0-alpha.1` | v4.8 | Gemini pin bumped to `gemini-3.1-pro-preview` under Google One AI Ultra |
| `v0.5.0-alpha` | v4.7 + v4.8 | Triangular topology + tier resilience + transient failure handling |

---

## What it does

`cross-review-v1` is an **MCP stdio server** that orchestrates **structured review sessions** between four top-tier AI peers:

- **Claude Code** (Anthropic Claude Pro/Max subscription, model `claude-opus-4-7`)
- **ChatGPT Codex** (ChatGPT Pro subscription, model `gpt-5.5` + `reasoning_effort=xhigh`)
- **Gemini CLI** (Google One AI Ultra subscription, model `gemini-3.1-pro-preview` via oauth-personal)
- **DeepSeek** (embedded `cross-review-v1-deepseek-cli`, model `deepseek-v4-pro` with thinking enabled)

Claude, Codex, or Gemini can serve as the **caller**; DeepSeek is a peer-only participant in v1.5.0. The server spawns peers under contained CLI invocations, collects their structured responses, and reports convergence via a unanimity predicate:

> **converged iff caller_status === 'READY' AND every responded peer has peer_status === 'READY'**

This is the canonical defense against single-model hallucinations: if one peer confabulates, the others catch it. The protocol codifies the defense rather than rely on emergent behavior.

---

## Topology

The server supports two session shapes:

- **Bilateral** (`ask_peer`): legacy `claude<->codex` only. Gemini callers must use `ask_peers`.
- **Trilateral / quadrilateral / N-ary** (`ask_peers`): all complements spawn in parallel via `Promise.allSettled`. In v1.5.0, a Claude/Codex/Gemini caller gets three peers: the other two caller-capable agents plus DeepSeek. Per-peer identity is explicit (R12 invariant: never infer agent from array index). Failed spawns enter `meta.failed_attempts[]` (redacted per R14) and are counted in `round.quorum.rejected`. Under strict-quorum semantics (spec §6.12 + v1.2.3 §6.18.1) rejected peers count AGAINST convergence: `round.quorum.rejected === 0` is required in addition to all responded peers READY.

Convergence uses the strict denominator: **`status_missing` counts AGAINST**. No "loose mode" toggle. Round state is snapshotted at append time into `round.convergence_snapshot` with `spec_version: 'v4.9'` — audit immutability under future predicate evolution.

---

## Peers and transport

All peers are spawned via a **CLI process**. Claude, Codex, and Gemini use their vendor CLIs. DeepSeek uses the project-owned embedded `cross-review-v1-deepseek-cli`; the v1 server still treats it as a subprocess peer with stdin/stdout, preserving the CLI-only orchestration contract.

**Transport descriptor** returned by `spawnPeer` / `probeAgent`:

| agent  | auth              | endpoint_class                  | Notes |
|--------|-------------------|---------------------------------|-------|
| codex  | `cli-subscription`  | `chatgpt-pro-backend`             | Stderr banner `model: <id>` parsed for authoritative attestation (spec v4.10 §6.11 amendment). |
| claude | `cli-subscription`  | `claude-pro-backend`              | No stderr banner in CLI 2.1.119 (empirically surveyed 2026-04-24, spec v4.11). Falls back to `model_check_skipped` path. |
| gemini | `oauth-personal`    | `v1internal` (cloudcode-pa)       | No authoritative `modelVersion` header — §6.11 skip applies. Ultra tier unlocks 3.x preview models. |
| gemini | `api-key`           | `generativelanguage-v1beta`       | Defensive-coded but not reachable under the current billing veto. |
| deepseek | `api-key`         | `deepseek-openai-compatible`      | Embedded CLI calls DeepSeek Chat Completions with `deepseek-v4-pro`, thinking enabled, prompt via stdin, and optional stdio MCP tools. |

**Item A (spec v4.9 §6.11).** For non-api-key transports the model's text self-report is unreliable across all three providers; `parsePeerOutputs` gates `classifyModelMatch` on `authoritativeModelAttestationAvailable(descriptor)` (equivalent to `auth === 'api-key'`). When false, the check is SKIPPED with an audit record (`model_check_skipped`) instead of flagging false-positive `silent_model_downgrade`.

**Item E (spec v4.10 §6.11 amendment).** For `cli-subscription` transports with a parseable CLI stderr banner, the banner is promoted from forensic-only to AUTHORITATIVE attestation. Banner MATCH → `cli_banner_attested: true` audit elevation. Banner MISMATCH → hard gate: `model_failure_class: 'cli_banner_attestation_mismatch'` + `protocol_violation: true`. Codex-specific in practice (spec v4.11 survey closed the Claude follow-up as negative).

---

## Install

### Prerequisites

- **Node.js 18+**
- The three vendor peer CLIs installed, authenticated, and on PATH:
  - `claude` — Claude Code CLI (`npm install -g @anthropic-ai/claude-code` or equivalent)
  - `codex` — Codex CLI (requires ChatGPT Pro subscription)
  - `gemini` — Gemini CLI (requires Google account; Ultra tier recommended for 3.x preview access)
- Active subscriptions covering each vendor CLI (see [Peers and transport](#peers-and-transport)).
- `DEEPSEEK_API_KEY` in the environment. No external DeepSeek CLI is required; `cross-review-v1-deepseek-cli` is shipped by this package.

### Clone and install

```bash
git clone https://github.com/LCV-Ideas-Software/cross-review-v1.git
cd cross-review-v1
npm install
```

The only runtime dependency is `@modelcontextprotocol/sdk`.

### Gate verification

Before using the server or after any edit, confirm both gates pass:

```bash
npm test             # smoke steps (unit + end-to-end stdio JSON-RPC; count grows with each release — check the last line of output)
npm run check-models # model-drift audit against docs/top-models.json
```

Both must report GREEN. The smoke suite exercises: parser fuzz coverage, schema evolution, spawn contention, probe stubs, session-store atomicity, redaction, N-ary convergence, model-check MATCH/DOWNGRADE/MISSING, rate-limit detection, banner attestation, anti-hallucination confidence/evidence_sources field parsing, operator escalation end-to-end, and Gemini auth-detection precedence regression coverage. Exact count evolves with each release — check the last line of `npm test` output for the current total.

---

## Register with each peer

Each peer registers the MCP server using its host's standard MCP config. **Do NOT set a `CROSS_REVIEW_CALLER` env var** — caller identity is resolved dynamically per session (spec v4.14 §6.20, simplified in v1.2.12) via the calling host's MCP `clientInfo.name` (declared during the `initialize` handshake) with substring match against `claude` / `codex` / `gemini`. The env-var fallback that previously existed was removed in v1.2.12 because it produced "lying logs" — the server affirmed `caller=X` while the actual session was driven by agent Y. If a stale config still sets `CROSS_REVIEW_CALLER`, the server emits a one-shot deprecation notice on stderr at startup and ignores the variable; the server boots and runs normally.

For local workstations, prefer **workspace-scoped MCP config** when the host supports it (`.vscode/mcp.json`, `.gemini/settings.json`, `.mcp.json`, `.codex/config.toml`). Keep user-level MCP config empty unless the host has no project/workspace separation.

### Claude Code

```bash
claude mcp add -s user cross-review -- node /absolute/path/to/cross-review-v1/src/server.js
```

Verify: `claude mcp get cross-review` should show `Status: Connected`. The Claude Code host declares `clientInfo.name: "claude-code"` during MCP initialize, so the server resolves the caller as `claude` automatically.

### ChatGPT Codex

Add to the project `.codex/config.toml` when possible:

```toml
[mcp_servers.cross-review]
command = "/absolute/path/to/cross-review-v1.cmd"
args = []
tool_timeout_sec = 1800
```

Verify: `codex mcp get cross-review` should show `enabled: true, transport: stdio`. The Codex CLI declares a `clientInfo.name` containing `codex`, so the server resolves the caller as `codex` automatically.

### Gemini CLI

Add to the project `.gemini/settings.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "cross-review-v1": {
      "command": "/absolute/path/to/cross-review-v1.cmd",
      "args": []
    }
  }
}
```

Verify: invoke `gemini` and confirm `cross-review-v1` appears in the MCP list. The Gemini CLI declares a `clientInfo.name` containing `gemini`, so the server resolves the caller as `gemini` automatically.

### Mixed-host setups

If your MCP host declares a `clientInfo.name` that does NOT cleanly map to one of `claude` / `codex` / `gemini` (e.g., a custom wrapper or test harness), pass an explicit `caller` argument on every `session_init` call instead of trying to inject identity via env config. The `args.caller` parameter takes precedence over `clientInfo.name` resolution.

### Embedded DeepSeek CLI MCP config

`cross-review-v1-deepseek-cli` ships with `reviewer-configs/deepseek-cli.mcp.json`. The server invokes DeepSeek with a restrictive MCP allowlist by default:

- `memory`
- `ultrathink`
- `code-reasoning`

The file may contain a larger stdio-only MCP catalog for manual DeepSeek CLI runs. Use `--allowed-mcp-server-names <name>` repeatedly, or `DEEPSEEK_ALLOWED_MCP_SERVERS=name1,name2`, to expose only the servers needed for that invocation. The default allowlist is the safe reasoning trio above; use `--allow-all-mcp-servers` only for manual diagnostic runs where recursion and tool exposure are intentional. The embedded CLI supports environment placeholders in the common forms `${env:NAME}`, `${NAME}`, and `$NAME`, and it intentionally does not read or write Gemini profile/config directories.

The embedded catalog deliberately excludes `cross-review-v1` and `cross-review-v2`, even in the manual `--allow-all-mcp-servers` path. DeepSeek child processes also receive a filtered environment containing only OS launch essentials plus `DEEPSEEK_*` settings; unrelated provider keys are not forwarded.

DeepSeek tool calls are bounded by `DEEPSEEK_MAX_TOOL_TURNS` (default `8`) or `--max-tool-turns <n>` for manual CLI runs. If the model still asks for tools after the cap, the CLI fails the round loudly with a max-tool-turns error instead of looping forever or silently truncating the review.

### Reload clients

After registering, reload each host (VS Code extensions: Command Palette → "Developer: Reload Window"; Gemini CLI: restart the REPL). For some changes a full application exit+relaunch is required to pick up PATH env changes (Reload Window alone is insufficient).

---

## Running a session

A high-level session from the caller's perspective:

1. **Initialize.** Call `session_init(task, artifacts[], review_focus?)`. The server runs a parallel capability probe (target 20-25s, hard ceiling 30s) and persists `meta.capability_snapshot` with per-agent tier (`ok` | `offline`).
2. **Round 1: caller drafts.** Caller forms its parecer (opinion/analysis). Caller then calls `ask_peers(session_id, prompt, caller_status: 'NOT_READY')` sending the parecer to all peers in parallel. The server attaches a **tail directive** to the prompt requiring the peer to close with two structured blocks:
   - `<cross_review_peer_model>{"model_id":"..."}</cross_review_peer_model>`
   - `<cross_review_status>{"status":"READY|NOT_READY|NEEDS_EVIDENCE", ...}</cross_review_status>`
   The status block MUST be the last non-empty token of the response.
3. **Parse and examine.** The server parses each peer's stdout via two sibling parsers (`parsePeerResponse` + `parseDeclaredModel`) and attaches `transport_descriptor` + `cli_attested_model_raw` metadata. The response envelope surfaces `peers[]` with per-peer `peer_status`, `peer_structured` (clean JSON payload), `status_source` (`structured` | `regex` | `null`), `parser_warnings[]`, `model_check_skipped` (when applicable), `protocol_violation`, plus the round-level `rate_limited_peers[]` array.
4. **Iterate.** If any peer is `NOT_READY` or `NEEDS_EVIDENCE`, address their findings (incorporate valid ones, refute invalid with evidence, run commands requested via `caller_requests[]`) and repeat step 2.
5. **Converge.** When caller is satisfied AND all peers declared `READY`, call `ask_peers` with `caller_status: 'READY'`. Call `session_check_convergence(session_id)` to confirm `converged === true`. Finalize with `session_finalize(session_id, outcome: 'converged')`.
6. **Safety cap.** Abort after a reasonable max-rounds (commonly 10) with `session_finalize(session_id, outcome: 'max-rounds')`.

### Review focus

`review_focus` is an optional, provider-neutral scope anchor. Use it when a large codebase or broad task needs reviewers to prioritize a specific area, such as `services/billing`, `src/core/session-store.ts`, or `release automation`.

The value can be supplied at `session_init` and is then stored as `meta.review_focus`, or supplied per call to `ask_peer` / `ask_peers` to override the session-level focus for that round. The server injects it as a plain Markdown `Review Focus` block before the normal prompt. It deliberately does **not** send Claude Code's `/focus` slash command; official Claude Code docs describe `/focus` as a focus-mode UI toggle, while Cross Review needs the same scope anchor to work across Claude, Codex, Gemini and DeepSeek. If an operator accidentally pastes a leading `/focus`, the prefix is stripped during normalization and only the plain scope text is forwarded.

The injected block also tells reviewers to label possible findings outside that focus as `OUT OF SCOPE` instead of counting them as blocking issues, unless the issue is a critical cross-cutting blocker that invalidates the result. This keeps broad reviews anchored without hiding genuinely fatal problems.

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
cross-review-v1/
|-- src/
|   |-- server.js                    MCP stdio entrypoint; 7 tools
|   |-- lib/
|       |-- session-store.js         ~/.cross-review/ state; atomic write + lock
|       |-- peer-spawn.js            Contained CLI spawn for each peer
|       |-- status-parser.js         STATUS + v4/v4.10 structured block parser
|       |-- model-parser.js          Sibling peer-model block parser (silent-downgrade defense)
|-- scripts/
|   |-- functional-smoke.js          JSON-RPC stdio smoke (177 steps at v1.2.5; count grows with each release)
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
| `session_init(task, artifacts, review_focus?)` | v0.3.0-alpha | Create session dir; run capability probe; persist `capability_snapshot` and optional `meta.review_focus`. |
| `session_read(session_id)` | v0.3.0-alpha | Return full `meta.json` (rounds, snapshot, escalations, failed_attempts). |
| `session_check_convergence(session_id)` | v0.3.0-alpha | Read the persisted `convergence_snapshot` (or compute for legacy rounds). |
| `session_finalize(session_id, outcome)` | v0.3.0-alpha | Seal with `converged` / `aborted` / `max-rounds`. |
| `ask_peer(session_id, prompt, caller_status, review_focus?)` | v0.3.0-alpha | Bilateral `claude<->codex` only; optional per-round focus override. |
| `ask_peers(session_id, prompt, caller_status, review_focus?)` | v0.5.0-alpha | N-ary parallel spawn; canonical for triangular/quadrilateral sessions; optional per-round focus override. |
| `escalate_to_operator(session_id, question, context)` | v0.7.0-alpha | Record anti-hallucination escalation under `meta.escalations[]`. |

---

## Development

### Make a change, verify gates

```bash
npm test              # 188 smoke steps must stay GREEN (count may grow across releases; check the last line of output)
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

Cross-review-v1 uses its own protocol as the contribution model. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the trilateral design-review workflow required before scope-introducing PRs.

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
