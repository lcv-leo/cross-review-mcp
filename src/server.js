#!/usr/bin/env node

/**
 * cross-review-mcp / server.js
 *
 * MCP server (stdio) exposing the cross-review orchestration surface.
 * Identity is determined by CROSS_REVIEW_CALLER (claude | codex |
 * gemini); ask_peer (legacy bilateral, claude<->codex only) and
 * ask_peers (N-ary, all complements) spawn the peers under the
 * definitive contained-spawn configuration.
 *
 * Exposed tools:
 *   - session_init(task, artifacts[])
 *   - session_read(session_id)
 *   - session_check_convergence(session_id)
 *   - session_finalize(session_id, outcome)
 *   - ask_peer(session_id, prompt, caller_status)       [legacy bilateral]
 *   - ask_peers(session_id, prompt, caller_status)      [N-ary, v0.5.0-alpha]
 *
 * v0.5.0-alpha (F2) additions per spec v4.7 triangular + v4.8 resilience:
 *   - VALID_AGENTS = {claude, codex, gemini}
 *   - session_init runs probeChain in parallel (20-25s target, 30s hard
 *     ceiling) and persists capability_snapshot.
 *   - ask_peers runs spawnPeers (Promise.all over Promise.allSettled-
 *     wrapped spawnPeer) with explicit agent identity; failed peers are
 *     recorded via saveFailedAttempt, successful peers enter the round.
 *   - Every real-spawn peer response is re-parsed with the sibling
 *     modelParser to detect silent_model_downgrade
 *     (TODO-spec-v4.9 -- defensive code ships now per F2 Q4 decision).
 *   - Legacy ask_peer remains bilateral (claude<->codex only); gemini
 *     callers are directed to ask_peers (R23).
 */

"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
	StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const store = require("./lib/session-store.js");
const {
	spawnPeer,
	spawnPeers,
	probeChain,
	authoritativeModelAttestationAvailable,
	matchRateLimitLexeme,
	extractRetryAfterSeconds,
} = require("./lib/peer-spawn.js");
const { parsePeerResponse } = require("./lib/status-parser.js");
const {
	parseDeclaredModel,
	classifyModelMatch,
	MODEL_OPEN_TAG,
	MODEL_CLOSE_TAG,
} = require("./lib/model-parser.js");

const VERSION = "1.2.7";

// v1.2.4: release date for `server_info`. Updated alongside VERSION on each
// ship. Anti-drift smoke (driveV414ServerInfoUnit) asserts that the
// CHANGELOG.md `## [VERSION] — DATE` heading matches this constant, so a
// bump that forgets to update either side fails the gate.
const RELEASE_DATE = "2026-04-26";

// v0.6.0-alpha / spec v4.9: response-level rate-limit detection.
// Requires ALL THREE of (1) status block absent, (2) body < 200 chars,
// (3) provider-shaped lexeme present. Generic {rate, quota, limit} is
// explicitly excluded at the lexeme layer (see peer-spawn.js).
// Returns null or { detection_source: 'response', retry_after_seconds,
// lexeme_matched }.
const RESPONSE_RATE_LIMIT_MAX_CHARS = 200;
function detectResponseRateLimit(stdout) {
	if (typeof stdout !== "string") return null;
	if (stdout.length >= RESPONSE_RATE_LIMIT_MAX_CHARS) return null;
	if (stdout.includes("</cross_review_status>")) return null;
	const lexeme = matchRateLimitLexeme(stdout);
	if (!lexeme) return null;
	return {
		detection_source: "response",
		retry_after_seconds: extractRetryAfterSeconds(stdout),
		lexeme_matched: lexeme,
	};
}
const VALID_AGENTS = ["claude", "codex", "gemini"];
const LEGACY_BILATERAL_PEER = Object.freeze({
	claude: "codex",
	codex: "claude",
	// gemini intentionally absent -- R23 (F2 round 2): ask_peer
	// is a bilateral-only legacy surface; gemini callers must use
	// ask_peers.
});

const TEST_IMPORT = process.env.CROSS_REVIEW_TEST_IMPORT === "1";
// CALLER_ENV is the operator-configured fallback. It seeds the `caller`
// resolution chain (spec v4.14 §6.20) but is NOT the authoritative caller
// per-session anymore: session_init resolves the caller dynamically with
// precedence args.caller > clientInfo-derived > CALLER_ENV.
const CALLER_ENV = TEST_IMPORT
	? (process.env.CROSS_REVIEW_CALLER || "claude").toLowerCase()
	: (process.env.CROSS_REVIEW_CALLER || "").toLowerCase();
if (!TEST_IMPORT && !VALID_AGENTS.includes(CALLER_ENV)) {
	process.stderr.write(
		`[cross-review-mcp] fatal: CROSS_REVIEW_CALLER must be one of ${VALID_AGENTS.join("|")} (got '${CALLER_ENV || "(unset)"}')\n`,
	);
	process.exit(1);
}

// Backwards-compat: legacy code still references CALLER, PEERS, LEGACY_PEER
// as module-level constants. They reflect the env-var resolution and remain
// available for callers that do NOT pass an explicit `caller` arg. Per
// spec v4.14 §6.20 the dynamic resolution at session_init time is canonical.
const CALLER = CALLER_ENV;
const PEERS = VALID_AGENTS.filter((a) => a !== CALLER);
const LEGACY_PEER = LEGACY_BILATERAL_PEER[CALLER] || null;

// v1.2.0 / spec v4.14 §6.20 — clientInfo → agent mapping for dynamic caller.
// Maps the MCP `clientInfo.name` (sent by the host during initialize) to one
// of VALID_AGENTS. Returns null if the name does not map cleanly. The mapping
// is conservative: substring match on lowercased name. Unknown clients
// (operator scripts, tests) fall through to env-var fallback.
function resolveCallerFromClientInfo(clientInfo) {
	const name = String(clientInfo?.name || "").toLowerCase();
	if (!name) return null;
	if (name.includes("claude")) return "claude";
	if (name.includes("gemini")) return "gemini";
	if (name.includes("codex")) return "codex";
	return null;
}

// Resolve caller per spec v4.14 §6.20 precedence:
//   1. args.caller (explicit override) — wins if valid
//   2. clientInfo-derived (server.getClientVersion() name → agent mapping)
//   3. CALLER_ENV (operator-configured fallback)
// Returns { caller, source: 'arg' | 'client_info' | 'env_var', client_info_name }.
// Throws if all three resolution sources fail.
function resolveCallerForSession(argsCaller, clientInfo) {
	const argLower = String(argsCaller || "").toLowerCase();
	if (argLower) {
		if (!VALID_AGENTS.includes(argLower)) {
			throw new Error(
				`caller arg must be one of ${VALID_AGENTS.join("|")} (got '${argLower}')`,
			);
		}
		return {
			caller: argLower,
			source: "arg",
			client_info_name: clientInfo?.name ?? null,
		};
	}
	const fromClient = resolveCallerFromClientInfo(clientInfo);
	if (fromClient && VALID_AGENTS.includes(fromClient)) {
		return {
			caller: fromClient,
			source: "client_info",
			client_info_name: clientInfo?.name ?? null,
		};
	}
	if (CALLER_ENV && VALID_AGENTS.includes(CALLER_ENV)) {
		return {
			caller: CALLER_ENV,
			source: "env_var",
			client_info_name: clientInfo?.name ?? null,
		};
	}
	throw new Error(
		`cannot resolve caller: no caller arg passed, clientInfo.name='${clientInfo?.name || "(missing)"}' did not map to a known agent, and CROSS_REVIEW_CALLER env var is unset`,
	);
}

function peersForCaller(caller) {
	return VALID_AGENTS.filter((a) => a !== caller);
}

function legacyPeerForCaller(caller) {
	return LEGACY_BILATERAL_PEER[caller] || null;
}

// Probe behavior controls. In smoke tests the env-gated
// CROSS_REVIEW_PROBE_STUB short-circuits per-agent probes inside
// peer-spawn.js; CROSS_REVIEW_SKIP_PROBE bypasses probeChain entirely
// (records an empty snapshot). Operators do not set either variable.
const SKIP_PROBE = process.env.CROSS_REVIEW_SKIP_PROBE === "1";
const PROBE_BUDGET_MS =
	Number(process.env.CROSS_REVIEW_PROBE_BUDGET_MS) || 25000;

// v1.2.1 / spec v4.14 §6.20 fix: log line shows env-var caller for backwards
// compat, but per-session log calls SHOULD include the resolved caller in the
// meta object. This is a defense-in-depth post-v1.2.0 cleanup — handlers
// already pass session-specific context via the meta arg, so the global
// caller= prefix is informational ("this server instance was started by X")
// rather than authoritative ("this round was driven by X").
function log(msg, meta) {
	const base = `[cross-review-mcp ${new Date().toISOString()} env_caller=${CALLER}] ${msg}`;
	process.stderr.write(
		meta ? `${base} ${JSON.stringify(meta)}\n` : `${base}\n`,
	);
}

// v1.2.2 / spec v4.14 §6.10 enforcement — peer-exchange language drift detector.
// Spec §6.10 requires en-US for peer exchange. Operator-facing chat may be in
// any language (pt-BR is common in this workspace) but the caller is
// responsible for translating to en-US before sending peer exchange. This
// detector surfaces a non-blocking advisory when the prompt looks non-en-US,
// using two conservative signals chosen to keep false-positive rate low on
// technical en-US prompts that happen to contain identifiers or proper nouns.
//
// Signal 1 — diacritics: counts chars in the romance-language accented set.
// English technical prose virtually never has these. Threshold 4 chars
// allows occasional loanwords (e.g., "café", "naïve") without flagging.
//
// Signal 2 — pt-BR-specific lexemes: small list of high-confidence non-en-US
// words / phrases that don't collide with en-US technical vocabulary.
// Threshold 3 distinct matches.
//
// Either signal hitting threshold flags the prompt. Confidence is reported
// (low / medium / high) so future tightening to hard-reject can use it.
const PT_BR_DIACRITICS_RE = /[áéíóúâêîôûãõàèìòùçÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ]/g;
const PT_BR_LEXEMES = Object.freeze([
	"não",
	"está",
	"estão",
	"são",
	"foi",
	"por favor",
	"concentre-se",
	"apenas",
	"realize",
	"retorne",
	"concluir",
	"auditoria",
	"vulnerabilidades",
	"injeção",
	"vazamento",
	"sincronização",
	"concorrência",
	"falhas",
	"fragilidades",
	"descobertas",
	"arquivos",
	"código",
	"análise",
	"servidor",
	"segurança",
	"robustez",
]);
const PROMPT_LANG_DIACRITICS_THRESHOLD = 4;
const PROMPT_LANG_LEXEMES_THRESHOLD = 3;

function detectPromptLanguageDrift(text) {
	if (typeof text !== "string" || !text.length) return null;
	const diacriticsCount = (text.match(PT_BR_DIACRITICS_RE) || []).length;
	const lower = text.toLowerCase();
	const lexemesMatched = PT_BR_LEXEMES.filter((lex) => lower.includes(lex));
	if (
		diacriticsCount < PROMPT_LANG_DIACRITICS_THRESHOLD &&
		lexemesMatched.length < PROMPT_LANG_LEXEMES_THRESHOLD
	) {
		return null;
	}
	// Confidence calibration:
	//  - low: just barely past threshold on either signal
	//  - medium: clearly past on either OR both at threshold
	//  - high: strong signal on either, OR both well past threshold
	let confidence = "low";
	if (diacriticsCount >= 8 || lexemesMatched.length >= 6) confidence = "medium";
	if (
		diacriticsCount >= 16 ||
		(diacriticsCount >= 8 && lexemesMatched.length >= 5)
	) {
		confidence = "high";
	}
	return {
		suspected_language: "non-en-us",
		confidence,
		signals: {
			diacritics_count: diacriticsCount,
			lexemes_matched: lexemesMatched,
			diacritics_threshold: PROMPT_LANG_DIACRITICS_THRESHOLD,
			lexemes_threshold: PROMPT_LANG_LEXEMES_THRESHOLD,
		},
		spec_reference: "spec v4.14 §6.10",
		recovery_hint: "reformulate_in_en_us",
		// v1.2.4: bind the version literal to the live VERSION constant so
		// future bumps auto-update the operator-visible text. The previous
		// hardcoded "v1.2.2" was caught by Gemini in a v1.2.3 runtime
		// check — exactly the kind of stale-string drift the anti-drift
		// smoke step (README ≡ VERSION) was meant to catch but didn't,
		// because it only inspected README, not runtime payloads.
		// driveV414PromptLanguageDetectorUnit now asserts this string
		// contains server.VERSION so any future regression fails the gate.
		recovery_advice: `Spec §6.10 mandates en-US for peer exchange. Operator-facing chat language does NOT propagate. Reformulate the prompt content in en-US before resubmitting. The current call proceeded (advisory mode, v${VERSION}); future versions may hard-reject when confidence is high.`,
	};
}

// Append the tail directives the peer must honor: both structured
// blocks, peer-model then status, with status as the last non-empty
// token. Idempotent-ish: if the caller already embedded the directive,
// the duplicate just re-asserts the contract. Kept concise; the real
// authority lives in `docs/workflow-spec.md`.
function attachPromptTailDirective(prompt) {
	return `${prompt}

---

**cross-review-mcp tail directive (v${VERSION}):** Close your response with BOTH structured blocks in this exact order. The status block MUST be the last non-empty token of your response; the peer-model block MUST appear immediately before the status block.

1. \`${MODEL_OPEN_TAG}{"model_id":"<your exact canonical model id>"}${MODEL_CLOSE_TAG}\`
2. \`<cross_review_status>{"status":"READY|NOT_READY|NEEDS_EVIDENCE", ...}</cross_review_status>\`

The peer-model block enables the caller to detect silent CLI downgrade (spec v4.11 §6.11 — transport-aware model-check discipline). Under non-api-key transports (cli-subscription / oauth-personal) the text self-report is unreliable and the check is SKIPPED with an audit record; under api-key transports the check is authoritative and a mismatch terminates the round as protocol_violation (class: silent_model_downgrade).

**Anti-hallucination (spec v4.11 §6.14):** If you lack verified information to answer a claim or complete a step:
- DO NOT fabricate. No plausible-sounding guesses presented as fact, no hallucinated function signatures / CLI flags / model IDs / file contents / commit SHAs.
- Exhaustively search first (re-read artifacts, re-query tools, consult primary sources: official docs, CLI \`--help\`, live probes). If a peer exchange can resolve it, respond with status=\`NEEDS_EVIDENCE\` and list specific \`caller_requests\`.
- If after exhaustive search the gap remains, mark status=\`NEEDS_EVIDENCE\` with a \`caller_requests\` item explicitly requesting operator escalation; the caller orchestrator will surface it.

Optional structured fields (spec v4.11 §6.14):
- \`confidence: 'verified' | 'inferred' | 'unknown'\` — self-declared epistemic state for this response.
- \`evidence_sources: ["file:path.ext", "tool:name", "url:https://...", "cli:command --help"]\` — concrete sources consulted. Under \`confidence='verified'\` SHOULD include at least one entry.
- Hard-pair rule: \`confidence='unknown'\` MUST pair with \`status='NEEDS_EVIDENCE'\`. Violating the pairing emits a parser warning and signals a protocol discipline break.`;
}

// Run the full parser stack against a peer's stdout: status parser for
// READY/NOT_READY/NEEDS_EVIDENCE + sibling model parser for silent-
// downgrade detection. Returns an aggregated round-ready record.
// peerModel is the canonical id we PASSED to the CLI (modelForPeer);
// when peerModel === 'stub' the synthetic peer bypasses the model
// check because no real CLI ran.
//
// v0.6.0-alpha / spec v4.9 (Item A): `transportDescriptor` is a third
// argument carrying { agent, auth, endpoint_class }. When auth !== 'api-key'
// (cli-subscription / oauth-personal), the model self-report text is
// unreliable across CLI wrappers; the authoritativeModelAttestationAvailable
// gate evaluates false and classifyModelMatch is SKIPPED. The round record
// gets `model_check_skipped: { reason:'unreliable_text_self_report_on_cli',
// auth, endpoint_class }` instead of false-positive-flagging
// silent_model_downgrade. model_failure_class stays null for bypass rounds;
// failure_class is reserved for real failures (spawn errors, rate-limits).
// Backward-compat: callers that omit transportDescriptor (null/undefined)
// fall back to the v0.5.0-alpha behavior (check runs; may false-positive).
//
// Response-level rate-limit detection also runs here (orthogonal to the
// model check). When detected, `rate_limit` carries the detection_source +
// retry_after_seconds + lexeme_matched payload.
// v0.7.0-alpha / spec v4.10 (Item E) fourth arg: `cliAttestedModel` is the
// model id extracted from the CLI's own stderr banner (Codex CLI emits
// `model: <id>` at the top of every exec). When parseable, the banner is
// treated as AUTHORITATIVE attestation for cli-subscription transports —
// stronger than the model's text self-report (which is known-unreliable)
// and sourced from the CLI layer that negotiates with the provider. A
// parseable banner that MISMATCHES the pinned peer_model is a hard gate:
// `cli_banner_attestation_mismatch` + protocol_violation=true. A parseable
// banner that MATCHES the pinned peer_model elevates the audit trail:
// `cli_banner_attested: true` alongside the §6.11 skip (the text check
// stays suppressed under §6.11 discipline; the banner is what attests).
// When the banner is absent/null (e.g. Claude CLI has no documented banner
// format yet, Gemini oauth-personal has no banner), §6.11 skip applies
// unchanged. Claude banner parsing is DEFERRED to v0.8+ pending empirical
// format survey.
// v1.1.0 / spec v4.13 §6.19 convergence-health hint.
//
// Spec defines the CONTRACT (the field value); thresholds here are
// implementation choice, tunable without spec bump. v1.1.0 thresholds derive
// from the 60-session audit corpus distribution: 5+ rounds is uncommon (5/60
// sessions), 8+ rounds is past the 90th percentile.
//
// Purely advisory: callers SHOULD consider whether continued iteration is
// productive when health is 'concerning'; nothing in the runtime auto-changes
// status, outcome, or peer behavior based on this signal.
const CONVERGENCE_HEALTH_EXTENDED_AT = 6;
const CONVERGENCE_HEALTH_CONCERNING_AT = 8;

function computeConvergenceHealth(roundCount) {
	const n = Number(roundCount);
	if (!Number.isFinite(n) || n < 1) return "normal";
	if (n >= CONVERGENCE_HEALTH_CONCERNING_AT) return "concerning";
	if (n >= CONVERGENCE_HEALTH_EXTENDED_AT) return "extended";
	return "normal";
}

function parsePeerOutputs(
	stdout,
	peerModel,
	transportDescriptor,
	cliAttestedModel = null,
) {
	const statusParsed = parsePeerResponse(stdout);
	const isStub = peerModel === "stub";

	let modelRequested = null;
	let modelReported = null;
	let modelMatch = null;
	let modelFailureClass = null;
	let modelCheckApplicable = false;
	let modelCheckSkipped = null;
	let cliBannerAttested = false;
	let modelWarnings = [];

	if (!isStub) {
		const modelParsed = parseDeclaredModel(stdout);
		modelRequested = peerModel;
		modelReported = modelParsed.model_id;
		modelWarnings = modelParsed.parser_warnings || [];

		const attested = transportDescriptor
			? authoritativeModelAttestationAvailable(transportDescriptor)
			: true; // legacy callers (no descriptor): preserve v0.5.0 semantics.

		if (attested) {
			modelCheckApplicable = true;
			const clazz = classifyModelMatch(modelRequested, modelReported);
			modelMatch = clazz === "ok";
			modelFailureClass = modelMatch ? null : clazz;
		} else {
			// Item E (spec v4.10): if a CLI banner attestation is available,
			// treat it as authoritative for cli-subscription. Banner is
			// Codex-specific in v0.7.0-alpha; Claude CLI parsing deferred.
			const bannerPresent =
				typeof cliAttestedModel === "string" && cliAttestedModel.length > 0;
			if (bannerPresent && transportDescriptor.auth === "cli-subscription") {
				if (cliAttestedModel === modelRequested) {
					// Banner matches pin: elevated confidence. Text-level
					// self-report check stays skipped (§6.11 discipline) —
					// the CLI banner is the attestation that matters.
					cliBannerAttested = true;
					modelCheckSkipped = {
						reason: "unreliable_text_self_report_on_cli",
						auth: transportDescriptor.auth,
						endpoint_class: transportDescriptor.endpoint_class,
						cli_banner_attested: true,
					};
					modelWarnings = [];
				} else {
					// Banner mismatches pin: hard gate. This is a REAL
					// downgrade — the CLI itself reported a different model
					// than the one we requested. Not a text-self-report
					// hallucination; the CLI layer attests the mismatch.
					modelCheckApplicable = true;
					modelMatch = false;
					modelFailureClass = "cli_banner_attestation_mismatch";
					modelWarnings = [];
				}
			} else {
				// Item A bypass: cli-subscription / oauth-personal without
				// a parseable banner. Skip the check and record audit reason.
				modelCheckSkipped = {
					reason: "unreliable_text_self_report_on_cli",
					auth: transportDescriptor.auth,
					endpoint_class: transportDescriptor.endpoint_class,
				};
				modelWarnings = [];
			}
		}
	}

	const rateLimit = detectResponseRateLimit(stdout);

	const parserWarnings = [
		...(statusParsed.parser_warnings || []),
		...modelWarnings,
	];

	const statusMissing = statusParsed.status == null;
	const modelViolation = modelCheckApplicable && !modelMatch;
	const protocolViolation = statusMissing || modelViolation;

	return {
		peer_status: statusParsed.status,
		peer_structured: statusParsed.structured,
		status_source: statusParsed.source,
		parser_warnings: parserWarnings,
		model_check_applicable: modelCheckApplicable,
		model_check_skipped: modelCheckSkipped,
		model_requested: modelRequested,
		model_reported: modelReported,
		model_match: modelMatch,
		model_failure_class: modelFailureClass,
		cli_banner_attested: cliBannerAttested,
		cli_attested_model: cliAttestedModel,
		protocol_violation: protocolViolation,
		rate_limit: rateLimit,
	};
}

const server = new Server(
	{ name: "cross-review-mcp", version: VERSION },
	{ capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "server_info",
			description:
				"Return server identity and capability metadata: package name, runtime version (server.VERSION), release date (RELEASE_DATE constant — bumped each ship), active spec version (session-store.SESSION_SPEC_VERSION), full list of registered MCP tools, and authoritative links (GitHub repo / npm / spec doc). USE CASES: (a) callers reporting which version they're running for telemetry; (b) operators verifying which version is currently loaded in memory after a release — MCP servers do NOT auto-reload on package update, so a fresh `npm install` does not propagate to running instances until the MCP host is restarted, and `server_info` is the canonical way to confirm what the runtime is actually executing; (c) external auditors mapping findings to a specific runtime build. The tool has no side effects and does not require a session_id.",
			inputSchema: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
		},
		{
			name: "session_init",
			description: `Create a new cross-review session directory under ~/.cross-review/<uuid>/. Returns the session_id. Also runs a parallel capability probe (probeChain) against all peers (target 20-25s, hard ceiling 30s) and persists the result as meta.capability_snapshot -- spec v4.11 section 6.9.3.\n\nPROMPT LANGUAGE (spec v4.14 §6.10). The \`task\` field is peer exchange — peer agents read it from meta.json. Peer exchange MUST be en-US regardless of operator-facing chat language. The operator may converse with the caller in pt-BR or any other language, but the caller is responsible for translating peer-exchange content (this \`task\` field, and \`prompt\` in subsequent ask_peer/ask_peers calls) to en-US before submission. Runtime emits a non-blocking advisory \`task_language_warning\` when non-en-US text is detected (diacritics or pt-BR lexemes); current behavior is warn-only but future versions may hard-reject.\n\nCALLER RESOLUTION (spec v4.14 §6.20). The session's caller is resolved dynamically per call with this precedence:\n  1. \`caller\` arg (explicit override) — wins if valid (must be one of ${VALID_AGENTS.join("|")}).\n  2. clientInfo.name from MCP initialize — substring-mapped to agent ('claude'→claude, 'gemini'→gemini, 'codex'→codex).\n  3. CROSS_REVIEW_CALLER env var — operator-configured fallback.\nThe resolved caller is recorded in \`meta.caller\` and \`meta.caller_resolution = { source, client_info_name }\` for audit. Peers are computed dynamically as VALID_AGENTS minus the resolved caller. Pass \`caller\` explicitly when an agent shares an MCP server instance with another (mixed-host setups) or when the env var doesn't reflect reality.`,
			inputSchema: {
				type: "object",
				properties: {
					task: {
						type: "string",
						description: "Short description of the task under review.",
					},
					artifacts: {
						type: "array",
						items: { type: "string" },
						description:
							"Optional list of artifact paths relevant to the review (read by peer at its discretion).",
					},
					caller: {
						type: "string",
						enum: VALID_AGENTS,
						description:
							"Explicit caller identity (spec v4.14 §6.20). Overrides clientInfo-derived and env-var resolution. Use this when the calling agent does not match what the MCP server's clientInfo would report, or to be explicit about identity in mixed-host setups.",
					},
				},
				required: ["task"],
			},
		},
		{
			name: "session_read",
			description:
				"Return the full session metadata (meta.json) including all rounds recorded so far, capability_snapshot, and any failed_attempts (spec v4.11 section 6.9.3.6 audit trail, secrets redacted).",
			inputSchema: {
				type: "object",
				properties: { session_id: { type: "string" } },
				required: ["session_id"],
			},
		},
		{
			name: "session_check_convergence",
			description:
				"Return whether convergence holds in the last round. Bilateral (ask_peer round): converged iff BOTH caller_status and peer_status are READY. N-ary (ask_peers round): converged iff caller_status is READY AND every responded peer declared READY AND `round.quorum.rejected === 0` (strict quorum; spec v4.14 §6.12). Peers excluded at probe time live in capability_snapshot and are NOT in the round's peer list (the probe excluded them before dispatch, so they are not 'missing' in the §6.12 sense). Peers that failed at spawn time during the round are in `meta.failed_attempts` and counted in `round.quorum.rejected`; under strict-quorum semantics they DO count against convergence (v1.2.3 closure of an external-audit finding that the snapshot computation pre-v1.2.3 ignored rejected, allowing 2-of-3 unanimity to misreport as converged when 1 peer was spawn-rejected). peer_status values: READY | NOT_READY | NEEDS_EVIDENCE.",
			inputSchema: {
				type: "object",
				properties: { session_id: { type: "string" } },
				required: ["session_id"],
			},
		},
		{
			name: "session_finalize",
			description:
				'Mark the session as concluded with an outcome: converged | aborted | max-rounds. Optional `reason` (spec v4.13 §6.18) records the structured "why" — e.g., "stale" for sweeper-finalized sessions, "peer_scope_creep" for intentional rollback aborts, "moderation_flag_unresolved" for the 5-attempt cap from §6.16. Stored as meta.outcome_reason. Omit for legacy/unknown.',
			inputSchema: {
				type: "object",
				properties: {
					session_id: { type: "string" },
					outcome: {
						type: "string",
						enum: ["converged", "aborted", "max-rounds"],
					},
					reason: {
						type: "string",
						description:
							'Optional structured reason for the outcome. Free-form short string; conventions: "stale", "peer_scope_creep", "moderation_flag_unresolved", "operator_abort". Omit when no specific reason.',
					},
				},
				required: ["session_id", "outcome"],
			},
		},
		{
			name: "session_sweep",
			description:
				'Long-idle session reconciliation (spec v4.13 §6.18 + v4.14 §6.18.4 v1.2.5 delete_files amendment). Walks ~/.cross-review/<id>/meta.json and lists sessions whose last activity (max of started_at, rounds[].started_at, rounds[].completed_at) is older than `stale_days`, EXCLUDING (a) sessions younger than 24h from last activity (hard non-overridable footgun guard) and (b) already finalized sessions. Returns { candidates, finalized, purged }. With `dry_run: true` (default), the call is read-only — `finalized` and `purged` are empty and no meta.json is touched. With `dry_run: false`, every candidate row with `would_finalize: true` is finalized via re-read-before-write semantics: if `meta.outcome` was set by a concurrent process between enumeration and write, the session is left untouched. Finalize sets `outcome: "aborted"` + `outcome_reason: <reason>` (default "stale"). Locked sessions (.lock present) appear in candidates with `would_finalize: false, skip_reason: "locked"` so the operator audits them. Sessions with malformed timestamps appear with `skip_reason: "malformed_timestamp"` and are never auto-finalized. With `delete_files: true` AND `dry_run: false` (spec §6.18.4), after finalize the session directory is physically removed via `fs.rmSync(dir, { recursive: true, force: true })` and a `purged` entry is added; default `delete_files: false` preserves the audit trail (pre-v1.2.5 behavior). Purge failure (EBUSY on Windows AV scan, EACCES, etc.) logs to host stderr but does NOT undo finalize — outcome="aborted" is canonical state, on-disk artifacts are best-effort cleanup.',
			inputSchema: {
				type: "object",
				properties: {
					stale_days: {
						type: "number",
						description:
							"Minimum age in days from last activity before a session becomes a candidate. Default 7. The 24h hard floor below this argument is non-overridable: stale_days=0 still excludes sessions younger than 24h.",
					},
					dry_run: {
						type: "boolean",
						description:
							"When true (default), the call is read-only and `finalized`/`purged` are empty. Set false to finalize candidates with would_finalize=true.",
					},
					delete_files: {
						type: "boolean",
						description:
							"When true AND dry_run=false, physically remove each finalized session directory (`fs.rmSync` recursive). Default false preserves the audit trail. Purge failure does NOT undo finalize.",
					},
					reason: {
						type: "string",
						description:
							'outcome_reason value to record on finalized sessions. Default "stale". Free-form short string; conventions documented in spec §6.18.',
					},
				},
			},
		},
		{
			name: "escalate_to_operator",
			description:
				"Anti-hallucination escalation (spec v4.11 §6.14 Item D). Record that the caller or peer has exhausted peer-exchange evidence gathering and still cannot answer the question without fabrication. The MCP server persists the escalation under meta.escalations[]; the caller orchestrator (Claude Code) surfaces the question to the operator via chat. Returns the escalation record with escalation_id. Does NOT auto-dispatch to the operator — the caller is responsible for the chat surface.",
			inputSchema: {
				type: "object",
				properties: {
					session_id: { type: "string" },
					question: {
						type: "string",
						description:
							"Concrete question the operator needs to answer to unblock the session.",
					},
					context: {
						type: "string",
						description:
							"Optional context: what was searched, what was ruled out, why the peer exchange could not resolve it.",
					},
				},
				required: ["session_id", "question"],
			},
		},
		{
			name: "ask_peer",
			description: `Send a prompt to the single bilateral peer (${LEGACY_PEER || `(legacy bilateral not available for caller=${CALLER}; use ask_peers)`}) and return its response with parsed STATUS. Caller MUST declare its own caller_status (READY means "I have no further changes or objections this round"; NOT_READY means "I applied changes and want peer to re-review, or I disagree with peer's previous response"). caller_status is restricted to READY|NOT_READY -- if the caller is missing evidence, emit NOT_READY and attach a CALLER_REQUEST block for peer. Peer status may be READY|NOT_READY|NEEDS_EVIDENCE. Convergence requires both READY in the same round. Peer runs under contained spawn with destructive MCPs/apps disabled; peer is invoked with the top-level model explicitly set (spec v4 section 6.9.2: codex=gpt-5.5 xhigh, claude=claude-opus-4-7, gemini=gemini-3.1-pro-preview; no silent fallback).

Legacy bilateral surface: ask_peer is claude<->codex only (R23). Gemini callers MUST use ask_peers instead.

Peer response contract:
  - <cross_review_peer_model>{"model_id":"<canonical id>"}</cross_review_peer_model>
  - <cross_review_status>{"status":"READY", ...}</cross_review_status>

The peer-model block MUST appear immediately before the status block; the status block MUST be the last non-empty token. A mismatch between the declared model_id and the pinned CODEX_MODEL/CLAUDE_MODEL/GEMINI_MODEL constant fails the round as protocol_violation with failure_class='silent_model_downgrade'. This check is conditionally skipped per spec v4.11 §6.11 transport-class bypass for cli-subscription / oauth-personal endpoints; api-key endpoints retain the strict check. The defense is not retried.

The v3 legacy line-form (STATUS: READY | STATUS: NOT_READY | STATUS: NEEDS_EVIDENCE) remains supported for status but does NOT substitute for the peer-model block.

Response payload includes peer_structured (clean JSON when the structured block validated), status_source ('structured' | 'regex' | null), parser_warnings (from both parsers), peer_model (requested pinned id), model_reported (declared by peer), model_match (boolean or null when peer is synthetic), and protocol_violation (boolean).

FAILURE-CLASS RECOVERY CONTRACT (spec v4.12 §6.16): on spawn rejection, the response carries 'failure_class' + 'recovery_hint'. Caller MUST honor the hint:
- 'prompt_flagged_by_moderation' (recovery_hint='reformulate_and_retry'): reformulate the prompt per 'reformulation_advice' and call ask_peer again in a new round. Repeat up to 5 attempts before escalating to operator. Do NOT abort the session.
- 'rate_limit_induced_response' (recovery_hint='wait_and_retry'): wait 'retry_after_seconds' and resubmit.
- 'spawn_rejected' (no recovery_hint): unclassified peer-side error; surface to operator.

PROMPT LANGUAGE (spec v4.14 §6.10). The 'prompt' field is peer exchange MUST be en-US regardless of operator-facing chat language. The operator may converse with the caller in pt-BR or any other language, but the caller is responsible for translating peer-exchange content (this 'prompt' field, plus the session_init 'task' field) to en-US before submission. Runtime emits a non-blocking advisory 'prompt_language_warning' field on the response when non-en-US text is detected (diacritics or pt-BR lexemes); current behavior is warn-only but future versions may hard-reject when confidence is high.`,
			inputSchema: {
				type: "object",
				properties: {
					session_id: { type: "string" },
					prompt: {
						type: "string",
						description:
							"Full prompt for the peer. The server automatically appends the tail directive so the peer emits both the peer-model and status blocks in the correct order.",
					},
					caller_status: {
						type: "string",
						enum: ["READY", "NOT_READY"],
						description:
							"Caller's own STATUS for this round. READY = caller has nothing to add and concurs with peer's previous position (if any). NOT_READY = caller has applied changes, has objections, needs evidence from peer, or wants another round regardless.",
					},
				},
				required: ["session_id", "prompt", "caller_status"],
			},
		},
		{
			name: "ask_peers",
			description: `N-ary peer spawn (spec v4.11): send the same prompt to all complements (caller=${CALLER}, peers=${PEERS.join(",")}) in parallel and return the aggregated per-peer responses. Promise.allSettled preserves per-peer partial results; failed spawns enter meta.failed_attempts (redaction applied) and are counted in round.quorum.rejected. Under strict-quorum semantics (spec v4.14 §6.12) rejected peers count AGAINST convergence: the predicate requires caller READY AND every responded peer READY AND round.quorum.rejected === 0. Successful peers enter the round with their parsed status and model-check outcome. caller_status semantics identical to ask_peer. This is the canonical tool for triangular sessions.\n\nFAILURE-CLASS RECOVERY CONTRACT (spec v4.12 §6.16): each rejected peer carries a 'failure_class' and 'recovery_hint'. The caller MUST honor the hint:\n- 'prompt_flagged_by_moderation' (recovery_hint='reformulate_and_retry'): the peer's provider rejected the prompt as potentially violating its usage policy (commonly OpenAI Codex on reasoning models). The 'reformulation_advice' field gives concrete guidance — avoid charged words ('adversarial', 'jailbreak', 'exploit', 'attack', 'bypass'), replace model-introspection prose with neutral technical descriptions, prefer 'response anomaly' over 'silent_downgrade', 'edge case' over 'adversarial input'. The caller MUST reformulate the prompt and call ask_peers again in a NEW round (do NOT abort the session). Repeat up to 5 reformulation attempts before escalating to the operator.\n- 'rate_limit_induced_response' (recovery_hint='wait_and_retry'): observe 'retry_after_seconds' and resubmit after the cooldown window.\n- 'spawn_rejected' (no recovery_hint): unclassified peer-side error; surface to operator.\n\nThe session continues with whatever peers responded; reformulation recovers the missing peer in a follow-up round.\n\nPROMPT LANGUAGE (spec v4.14 §6.10). The 'prompt' field is peer exchange MUST be en-US regardless of operator-facing chat language. The operator may converse with the caller in pt-BR or any other language, but the caller is responsible for translating peer-exchange content (this 'prompt' field, plus the session_init 'task' field) to en-US before submission. Runtime emits a non-blocking advisory 'prompt_language_warning' field on the response when non-en-US text is detected (diacritics or pt-BR lexemes); current behavior is warn-only but future versions may hard-reject when confidence is high.`,
			inputSchema: {
				type: "object",
				properties: {
					session_id: { type: "string" },
					prompt: {
						type: "string",
						description:
							"Full prompt for all peers. Same tail-directive injection as ask_peer.",
					},
					caller_status: {
						type: "string",
						enum: ["READY", "NOT_READY"],
					},
				},
				required: ["session_id", "prompt", "caller_status"],
			},
		},
	],
}));

// Spec v4.14 §6.20: probe runs against the dynamically-resolved peer set
// for this session, not the env-var-derived global PEERS. peersList defaults
// to global PEERS for backwards compatibility with code paths that have not
// been updated to pass it.
async function runSessionInitProbe(peersList = PEERS) {
	if (SKIP_PROBE) {
		return { skipped: true, reason: "CROSS_REVIEW_SKIP_PROBE=1", peers: [] };
	}
	try {
		const snapshot = await probeChain(peersList, { budgetMs: PROBE_BUDGET_MS });
		return {
			skipped: false,
			started_at: new Date().toISOString(),
			budget_ms: PROBE_BUDGET_MS,
			peers: snapshot,
		};
	} catch (err) {
		// probeChain never rejects (allSettled wrapper), but belt + braces.
		return {
			skipped: false,
			error: String(err?.message || err),
			peers: [],
		};
	}
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
	const { name, arguments: args } = req.params;
	log(`tool call: ${name}`);
	try {
		switch (name) {
			case "server_info": {
				// v1.2.4 §6.18.2: server identity + capability metadata.
				// Fully synchronous, no I/O, no session — returns the static
				// pinning constants so callers and operators can confirm
				// exactly what runtime is loaded in memory.
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									ok: true,
									name: "cross-review-mcp",
									version: VERSION,
									release_date: RELEASE_DATE,
									spec_version: store.SESSION_SPEC_VERSION,
									tools: [
										"server_info",
										"session_init",
										"session_read",
										"session_check_convergence",
										"session_finalize",
										"session_sweep",
										"ask_peer",
										"ask_peers",
										"escalate_to_operator",
									],
									links: {
										repo: "https://github.com/lcv-leo/cross-review-mcp",
										npm: "https://www.npmjs.com/package/@lcv-leo/cross-review-mcp",
										spec: "https://github.com/lcv-leo/cross-review-mcp/blob/main/docs/workflow-spec.md",
										changelog:
											"https://github.com/lcv-leo/cross-review-mcp/blob/main/CHANGELOG.md",
									},
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "session_init": {
				const t0 = Date.now();
				// Spec v4.14 §6.20: dynamic caller resolution per session.
				const clientInfo =
					typeof server.getClientVersion === "function"
						? server.getClientVersion()
						: null;
				const resolution = resolveCallerForSession(args.caller, clientInfo);
				const callerForSession = resolution.caller;
				const peersForSession = peersForCaller(callerForSession);
				// Spec v4.14 §6.10 enforcement (advisory): detect non-en-US in
				// task field. Warn-only — does not block session creation.
				const taskLanguageWarning = detectPromptLanguageDrift(args.task);
				if (taskLanguageWarning) {
					log("session_init: task language drift detected", {
						confidence: taskLanguageWarning.confidence,
						diacritics: taskLanguageWarning.signals.diacritics_count,
						lexemes: taskLanguageWarning.signals.lexemes_matched.length,
					});
				}
				const capabilitySnapshot = await runSessionInitProbe(peersForSession);
				const id = store.initSession({
					task: args.task,
					artifacts: args.artifacts || [],
					callerAgent: callerForSession,
					peers: peersForSession,
					capabilitySnapshot,
					callerResolution: {
						source: resolution.source,
						client_info_name: resolution.client_info_name,
					},
				});
				log("session_init created", {
					session_id: id,
					caller: callerForSession,
					caller_source: resolution.source,
					client_info_name: resolution.client_info_name,
					probe_duration_ms: Date.now() - t0,
					probe_skipped: capabilitySnapshot.skipped === true,
				});
				const responsePayload = {
					session_id: id,
					caller: callerForSession,
					caller_resolution: {
						source: resolution.source,
						client_info_name: resolution.client_info_name,
					},
					peers: peersForSession,
					capability_snapshot: capabilitySnapshot,
				};
				if (taskLanguageWarning) {
					responsePayload.task_language_warning = taskLanguageWarning;
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(responsePayload, null, 2),
						},
					],
				};
			}
			case "session_read": {
				const meta = store.readMeta(args.session_id);
				return {
					content: [{ type: "text", text: JSON.stringify(meta, null, 2) }],
				};
			}
			case "session_check_convergence": {
				const result = store.checkConvergence(args.session_id);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			}
			case "session_finalize": {
				// v1.2.3 / external audit round-2 F5: acquire the session
				// lock before writing, and refuse to clobber an already
				// finalized outcome. Pre-v1.2.3 finalize wrote unconditionally
				// and held no lock — racing with an in-flight ask_peers could
				// interleave appendRound and finalize, and a second
				// finalize call silently overwrote the first outcome.
				const sessionId = args.session_id;
				if (!store.acquireLock(sessionId)) {
					throw new Error(
						`session ${sessionId} is currently locked by another process (TTL 1h); retry shortly or clear ~/.cross-review/${sessionId}/.lock if stale`,
					);
				}
				try {
					const meta = store.readMeta(sessionId);
					if (meta.outcome != null) {
						// v1.2.3 / external audit round-2 F5b: safe-idempotent
						// re-finalize. If the second call provides the SAME
						// outcome AND the SAME outcome_reason (after
						// null-normalization), no-op success — the meta is
						// already in the requested terminal state, and this
						// just lets a retry-after-network-blip succeed
						// silently. Different outcome OR different reason is
						// rejected (real conflict).
						//
						// Null-normalization (gemini R2 ask): empty string and
						// whitespace-only strings collapse to null, so a
						// caller that retries `(id, 'aborted')` (stored null)
						// and then `(id, 'aborted', '')` succeeds idempotently
						// instead of falsely flagging the empty string as a
						// different reason.
						//
						// Crucially: the no-op path does NOT call
						// store.finalize, so meta.finalized_at is NOT rewritten.
						const normReason = (r) => {
							if (r == null) return null;
							const s = String(r).trim();
							return s.length === 0 ? null : s;
						};
						const incomingReason = normReason(args.reason);
						const existingReason = normReason(meta.outcome_reason);
						const sameOutcome = meta.outcome === args.outcome;
						const sameReason = existingReason === incomingReason;
						if (sameOutcome && sameReason) {
							return {
								content: [
									{
										type: "text",
										text: JSON.stringify(
											{
												ok: true,
												outcome: meta.outcome,
												outcome_reason: existingReason,
												idempotent: true,
												note: "session was already finalized with identical outcome+reason; meta.finalized_at preserved from original call",
											},
											null,
											2,
										),
									},
								],
							};
						}
						throw new Error(
							`session ${sessionId} already finalized (outcome='${meta.outcome}', outcome_reason='${existingReason ?? "(null)"}'); conflicting re-finalize rejected (incoming outcome='${args.outcome}', outcome_reason='${incomingReason ?? "(null)"}'). Identical re-finalize is allowed as a no-op; different outcome or reason is not.`,
						);
					}
					store.finalize(sessionId, args.outcome, args.reason ?? null);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										outcome: args.outcome,
										outcome_reason: args.reason ?? null,
									},
									null,
									2,
								),
							},
						],
					};
				} finally {
					store.releaseLock(sessionId);
				}
			}
			case "session_sweep": {
				// v1.1.0 / spec v4.13 §6.18 long-idle session reconciliation.
				// v1.2.5 / external-audit round-4 §4.2: optional delete_files
				// mode physically removes the session directory after finalize.
				const staleDays =
					typeof args.stale_days === "number" && args.stale_days >= 0
						? args.stale_days
						: store.SWEEP_DEFAULT_STALE_DAYS;
				const dryRun = args.dry_run !== false; // default true — read-only by default
				const deleteFiles = args.delete_files === true; // default false — preserve audit trail
				const reason =
					typeof args.reason === "string" && args.reason.trim().length > 0
						? args.reason.trim()
						: "stale";
				const result = store.sweepStaleSessions({
					staleDays,
					dryRun,
					reason,
					deleteFiles,
				});
				log("session_sweep", {
					stale_days: staleDays,
					dry_run: dryRun,
					delete_files: deleteFiles,
					reason,
					candidates: result.candidates.length,
					finalized: result.finalized.length,
					purged: result.purged.length,
					locked: result.candidates.filter((c) => c.locked).length,
				});
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									ok: true,
									stale_days: staleDays,
									dry_run: dryRun,
									delete_files: deleteFiles,
									reason,
									...result,
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "escalate_to_operator": {
				// v1.2.3 / external audit round-2 follow-up: acquire lock
				// before writing meta.escalations[]. Pre-v1.2.3 escalation
				// was an unguarded writer, racing with in-flight ask_peers.
				// Post-finalization escalation IS allowed (operator may
				// legitimately escalate something on a concluded session
				// during later review) — we lock for write-ordering, NOT to
				// reject finalized sessions.
				const sessionId = args.session_id;
				const question = args.question;
				const context = args.context ?? null;
				if (typeof question !== "string" || question.trim().length === 0) {
					throw new Error(
						`escalate_to_operator requires a non-empty 'question' string.`,
					);
				}
				if (!store.acquireLock(sessionId)) {
					throw new Error(
						`session ${sessionId} is currently locked by another process (TTL 1h); retry shortly or clear ~/.cross-review/${sessionId}/.lock if stale`,
					);
				}
				try {
					const entry = store.saveEscalation(
						sessionId,
						CALLER,
						question,
						context,
					);
					log("escalate_to_operator: recorded", {
						session: sessionId,
						escalation_id: entry.escalation_id,
						round: entry.round_index,
					});
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(entry, null, 2),
							},
						],
					};
				} finally {
					store.releaseLock(sessionId);
				}
			}
			case "ask_peer": {
				const sessionId = args.session_id;
				const rawPrompt = args.prompt;
				const callerStatus = args.caller_status;
				if (!["READY", "NOT_READY"].includes(callerStatus)) {
					throw new Error(
						`ask_peer requires caller_status = 'READY' or 'NOT_READY' (got '${callerStatus}')`,
					);
				}
				if (!store.acquireLock(sessionId)) {
					throw new Error(
						`session ${sessionId} is currently locked by another process (TTL 1h); retry shortly or clear ~/.cross-review/${sessionId}/.lock if stale`,
					);
				}
				try {
					const meta = store.readMeta(sessionId);
					// v1.2.3 / external audit round-2 F5c: refuse on finalized
					// session. Appending a round to a session whose outcome is
					// already set produces zombie state mixing finalized and
					// ongoing rounds. If the caller wants to extend the
					// conversation, they should open a new session.
					if (meta.outcome != null) {
						throw new Error(
							`session ${sessionId} is already finalized (outcome='${meta.outcome}', outcome_reason='${meta.outcome_reason ?? "(null)"}'); cannot append a new round. Open a new session via session_init if you need to extend the conversation.`,
						);
					}
					// Spec v4.14 §6.20: caller is per-session (meta.caller),
					// not the global CALLER constant. ask_peer's bilateral
					// surface is available iff the SESSION'S caller has a
					// legacy bilateral pairing.
					const sessionCaller = String(meta.caller || CALLER).toLowerCase();
					const sessionLegacyPeer = legacyPeerForCaller(sessionCaller);
					if (sessionLegacyPeer == null) {
						throw new Error(
							`ask_peer is a bilateral-only surface (claude<->codex). Session caller='${sessionCaller}' MUST use ask_peers instead (spec v4.11 §6.11 / triangular topology).`,
						);
					}
					const roundNum = (meta.rounds?.length || 0) + 1;
					// Spec v4.14 §6.10 enforcement (advisory).
					const promptLanguageWarning = detectPromptLanguageDrift(rawPrompt);
					if (promptLanguageWarning) {
						log("ask_peer: prompt language drift detected", {
							round: roundNum,
							confidence: promptLanguageWarning.confidence,
							diacritics: promptLanguageWarning.signals.diacritics_count,
							lexemes: promptLanguageWarning.signals.lexemes_matched.length,
						});
					}
					const promptWithTail = attachPromptTailDirective(rawPrompt);
					store.savePromptForRound(sessionId, roundNum, promptWithTail);
					log(`ask_peer: spawning ${sessionLegacyPeer}`, {
						session: sessionId,
						round: roundNum,
						caller_status: callerStatus,
						prompt_bytes: Buffer.byteLength(promptWithTail, "utf8"),
					});
					const t0 = Date.now();
					let spawnResult;
					try {
						spawnResult = await spawnPeer(sessionLegacyPeer, promptWithTail);
					} catch (spawnErr) {
						// v1.0.5 / spec v4.12 §6.16: classify spawn-level
						// failures with structured recovery_hint so the caller
						// can act (reformulate vs wait vs escalate). Mirrors
						// ask_peers semantics for bilateral surface.
						// v1.2.5 / external-audit round-4 §4.1: also classify
						// stream_overflow as a distinct failure_class. It's
						// volumetric (not semantic), so recovery_hint=null:
						// caller MAY retry as transient (peer might respond
						// shorter); if persistent, escalate to operator.
						const spawnRateLimit = spawnErr?.spawn_rate_limit || null;
						const promptFlagged = spawnErr?.prompt_flagged || null;
						const streamOverflow = spawnErr?.stream_overflow || null;
						const failureClass = promptFlagged
							? "prompt_flagged_by_moderation"
							: streamOverflow
								? "stream_overflow"
								: spawnRateLimit
									? "rate_limit_induced_response"
									: "spawn_rejected";
						const recoveryHint = promptFlagged
							? "reformulate_and_retry"
							: spawnRateLimit
								? "wait_and_retry"
								: null;
						const reasonMsg = String(
							spawnErr?.message || spawnErr || "spawn rejected",
						);
						store.saveFailedAttempt(
							sessionId,
							sessionLegacyPeer,
							failureClass,
							{
								stderr_tail: reasonMsg,
								failure_class: failureClass,
								round: roundNum,
								retry_attempt: 0,
								retry_after_seconds:
									spawnRateLimit?.retry_after_seconds ?? null,
								detection_source:
									spawnRateLimit || promptFlagged ? "spawn" : null,
								lexeme_matched:
									promptFlagged?.lexeme_matched ??
									spawnRateLimit?.lexeme_matched ??
									null,
								recovery_hint: recoveryHint,
								docs_url: promptFlagged?.docs_url ?? null,
							},
						);
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: false,
											agent: sessionLegacyPeer,
											failure_class: failureClass,
											recovery_hint: recoveryHint,
											retry_after_seconds:
												spawnRateLimit?.retry_after_seconds ?? null,
											docs_url: promptFlagged?.docs_url ?? null,
											reformulation_advice: promptFlagged
												? 'Avoid charged words like "adversarial", "jailbreak", "exploit", "attack", "bypass", "circumvent". Replace model-introspection prose with neutral technical descriptions. Prefer "response anomaly" over "silent_downgrade", "edge case" over "adversarial input", "alternative path" over "bypass". Resubmit the reformulated prompt via ask_peer in a new round; do NOT abort the session. Repeat up to 5 reformulation attempts before escalating to the operator.'
												: null,
											reason: reasonMsg.slice(-400),
										},
										null,
										2,
									),
								},
							],
						};
					}
					const {
						stdout,
						stderr,
						peer_model: peerModel,
						transport_descriptor: transportDescriptor,
						cli_attested_model_raw: cliAttestedModelRaw,
					} = spawnResult;
					const durationMs = Date.now() - t0;
					const parsed = parsePeerOutputs(
						stdout,
						peerModel,
						transportDescriptor,
						cliAttestedModelRaw,
					);
					const fname = store.savePeerResponse(
						sessionId,
						roundNum,
						sessionLegacyPeer,
						stdout,
						parsed.peer_status,
					);
					// Response-level rate-limit → surface in a per-peer
					// rate_limited_peers entry. The peer still blocks
					// convergence (strict denominator) but the operator
					// gets a retry-after signal.
					const rateLimitedPeers = [];
					if (parsed.rate_limit) {
						rateLimitedPeers.push({
							agent: sessionLegacyPeer,
							retry_after_seconds: parsed.rate_limit.retry_after_seconds,
							detection_source: parsed.rate_limit.detection_source,
							lexeme_matched: parsed.rate_limit.lexeme_matched,
						});
					}
					const convergenceHealth = computeConvergenceHealth(roundNum);
					store.appendRound(sessionId, {
						round: roundNum,
						caller: sessionCaller,
						caller_status: callerStatus,
						peer: sessionLegacyPeer,
						peer_status: parsed.peer_status,
						peer_structured: parsed.peer_structured,
						status_source: parsed.status_source,
						parser_warnings: parsed.parser_warnings,
						peer_model: peerModel,
						model_requested: parsed.model_requested,
						model_reported: parsed.model_reported,
						model_match: parsed.model_match,
						model_failure_class: parsed.model_failure_class,
						model_check_skipped: parsed.model_check_skipped,
						transport_descriptor: transportDescriptor,
						cli_attested_model_raw: cliAttestedModelRaw,
						response_class: parsed.rate_limit
							? "rate_limit_induced_response"
							: null,
						retry_after_seconds: parsed.rate_limit?.retry_after_seconds ?? null,
						rate_limited_peers: rateLimitedPeers,
						peer_file: fname,
						protocol_violation: parsed.protocol_violation,
						duration_ms: durationMs,
						completed_at: new Date().toISOString(),
						convergence_health: convergenceHealth,
					});
					log("ask_peer: done", {
						round: roundNum,
						caller_status: callerStatus,
						peer_status: parsed.peer_status,
						status_source: parsed.status_source,
						peer_model: peerModel,
						model_reported: parsed.model_reported,
						model_match: parsed.model_match,
						protocol_violation: parsed.protocol_violation,
						parser_warnings_count: parsed.parser_warnings.length,
						converged_this_round:
							callerStatus === "READY" && parsed.peer_status === "READY",
						duration_ms: durationMs,
					});
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										round: roundNum,
										caller_status: callerStatus,
										peer_status: parsed.peer_status,
										peer_structured: parsed.peer_structured,
										status_source: parsed.status_source,
										parser_warnings: parsed.parser_warnings,
										peer_model: peerModel,
										model_requested: parsed.model_requested,
										model_reported: parsed.model_reported,
										model_match: parsed.model_match,
										model_failure_class: parsed.model_failure_class,
										model_check_skipped: parsed.model_check_skipped,
										transport_descriptor: transportDescriptor,
										cli_attested_model_raw: cliAttestedModelRaw,
										rate_limited_peers: rateLimitedPeers,
										protocol_violation: parsed.protocol_violation,
										convergence_health: convergenceHealth,
										...(promptLanguageWarning && {
											prompt_language_warning: promptLanguageWarning,
										}),
										duration_ms: durationMs,
										content: stdout,
										stderr_tail: (stderr || "").slice(-600),
									},
									null,
									2,
								),
							},
						],
					};
				} finally {
					store.releaseLock(sessionId);
				}
			}
			case "ask_peers": {
				const sessionId = args.session_id;
				const rawPrompt = args.prompt;
				const callerStatus = args.caller_status;
				if (!["READY", "NOT_READY"].includes(callerStatus)) {
					throw new Error(
						`ask_peers requires caller_status = 'READY' or 'NOT_READY' (got '${callerStatus}')`,
					);
				}
				if (!store.acquireLock(sessionId)) {
					throw new Error(
						`session ${sessionId} is currently locked by another process (TTL 1h); retry shortly or clear ~/.cross-review/${sessionId}/.lock if stale`,
					);
				}
				try {
					const meta = store.readMeta(sessionId);
					// v1.2.3 / external audit round-2 F5c: refuse on finalized
					// session. Same rationale as ask_peer guard above.
					if (meta.outcome != null) {
						throw new Error(
							`session ${sessionId} is already finalized (outcome='${meta.outcome}', outcome_reason='${meta.outcome_reason ?? "(null)"}'); cannot append a new round. Open a new session via session_init if you need to extend the conversation.`,
						);
					}
					// Spec v4.14 §6.20: caller + peers are per-session; read
					// from meta. Backwards-compat: pre-v4.14 sessions may
					// not have meta.peers populated as N-ary array — fall
					// back to env-derived PEERS only if meta is silent.
					const sessionCaller = String(meta.caller || CALLER).toLowerCase();
					const metaPeers =
						Array.isArray(meta.peers) && meta.peers.length > 0
							? meta.peers
							: peersForCaller(sessionCaller);
					if (metaPeers.length === 0) {
						throw new Error(
							`ask_peers has no peers to spawn (session caller='${sessionCaller}' is the only agent in VALID_AGENTS).`,
						);
					}
					const roundNum = (meta.rounds?.length || 0) + 1;
					// Spec v4.14 §6.10 enforcement (advisory).
					const promptLanguageWarning = detectPromptLanguageDrift(rawPrompt);
					if (promptLanguageWarning) {
						log("ask_peers: prompt language drift detected", {
							round: roundNum,
							confidence: promptLanguageWarning.confidence,
							diacritics: promptLanguageWarning.signals.diacritics_count,
							lexemes: promptLanguageWarning.signals.lexemes_matched.length,
						});
					}
					const promptWithTail = attachPromptTailDirective(rawPrompt);
					store.savePromptForRound(sessionId, roundNum, promptWithTail);
					log(`ask_peers: spawning ${metaPeers.join(",")}`, {
						session: sessionId,
						round: roundNum,
						caller_status: callerStatus,
						prompt_bytes: Buffer.byteLength(promptWithTail, "utf8"),
					});
					const t0 = Date.now();
					const peerResults = await spawnPeers(metaPeers, promptWithTail);
					const durationMs = Date.now() - t0;

					const roundPeers = [];
					const responsePeers = [];
					const rateLimitedPeers = [];
					let anyProtocolViolation = false;

					for (const entry of peerResults) {
						if (entry.status === "rejected") {
							const reason = entry.reason;
							const reasonMsg = String(
								reason?.message || reason || "spawn rejected",
							);
							// v0.6.0-alpha / spec v4.9 (Item C): spawn-level
							// rate-limit hint attached by peer-spawn.js on
							// non-zero exit. Classify as
							// 'rate_limit_induced_response' when present.
							const spawnRateLimit = reason?.spawn_rate_limit || null;
							// v1.0.5 / spec v4.12: spawn-level prompt
							// moderation flag (OpenAI Codex on reasoning models).
							// Recovery contract is reformulate_and_retry, NOT
							// wait-and-retry. Surfaced as a distinct
							// failure_class so the caller knows which path to
							// take.
							const promptFlagged = reason?.prompt_flagged || null;
							// v1.2.5 / external-audit round-4 §4.1:
							// stream_overflow as distinct failure_class.
							// Volumetric (not semantic) → recovery_hint=null
							// (caller MAY retry as transient).
							const streamOverflow = reason?.stream_overflow || null;
							const failureClass = promptFlagged
								? "prompt_flagged_by_moderation"
								: streamOverflow
									? "stream_overflow"
									: spawnRateLimit
										? "rate_limit_induced_response"
										: "spawn_rejected";
							const recoveryHint = promptFlagged
								? "reformulate_and_retry"
								: spawnRateLimit
									? "wait_and_retry"
									: null;
							store.saveFailedAttempt(sessionId, entry.agent, failureClass, {
								stderr_tail: reasonMsg,
								failure_class: failureClass,
								round: roundNum,
								retry_attempt: 0,
								retry_after_seconds:
									spawnRateLimit?.retry_after_seconds ?? null,
								detection_source:
									spawnRateLimit || promptFlagged ? "spawn" : null,
								lexeme_matched:
									promptFlagged?.lexeme_matched ??
									spawnRateLimit?.lexeme_matched ??
									null,
								recovery_hint: recoveryHint,
								docs_url: promptFlagged?.docs_url ?? null,
							});
							log("ask_peers: peer rejected", {
								round: roundNum,
								agent: entry.agent,
								failure_class: failureClass,
								recovery_hint: recoveryHint,
								retry_after_seconds:
									spawnRateLimit?.retry_after_seconds ?? null,
								reason: reasonMsg.slice(-200),
							});
							responsePeers.push({
								agent: entry.agent,
								status: "rejected",
								reason: reasonMsg.slice(-400),
								failure_class: failureClass,
								retry_after_seconds:
									spawnRateLimit?.retry_after_seconds ?? null,
								detection_source:
									spawnRateLimit || promptFlagged ? "spawn" : null,
								recovery_hint: recoveryHint,
								docs_url: promptFlagged?.docs_url ?? null,
								reformulation_advice: promptFlagged
									? 'Avoid charged words like "adversarial", "jailbreak", "exploit", "attack", "bypass", "circumvent". Replace model-introspection prose with neutral technical descriptions. Prefer "response anomaly" over "silent_downgrade", "edge case" over "adversarial input", "alternative path" over "bypass". Resubmit the reformulated prompt via ask_peers in a new round; do NOT abort the session. Repeat up to 5 reformulation attempts before escalating to the operator.'
									: null,
							});
							if (spawnRateLimit) {
								rateLimitedPeers.push({
									agent: entry.agent,
									retry_after_seconds: spawnRateLimit.retry_after_seconds,
									detection_source: "spawn",
									lexeme_matched: spawnRateLimit.lexeme_matched,
								});
							}
							anyProtocolViolation = true;
							continue;
						}
						const {
							stdout,
							stderr,
							peer_model: peerModel,
							transport_descriptor: transportDescriptor,
							cli_attested_model_raw: cliAttestedModelRaw,
						} = entry.value;
						const parsed = parsePeerOutputs(
							stdout,
							peerModel,
							transportDescriptor,
							cliAttestedModelRaw,
						);
						const fname = store.savePeerResponse(
							sessionId,
							roundNum,
							entry.agent,
							stdout,
							parsed.peer_status,
						);
						if (parsed.protocol_violation) anyProtocolViolation = true;
						if (parsed.rate_limit) {
							rateLimitedPeers.push({
								agent: entry.agent,
								retry_after_seconds: parsed.rate_limit.retry_after_seconds,
								detection_source: parsed.rate_limit.detection_source,
								lexeme_matched: parsed.rate_limit.lexeme_matched,
							});
						}
						roundPeers.push({
							agent: entry.agent,
							peer_status: parsed.peer_status,
							peer_structured: parsed.peer_structured,
							status_source: parsed.status_source,
							parser_warnings: parsed.parser_warnings,
							peer_model: peerModel,
							model_requested: parsed.model_requested,
							model_reported: parsed.model_reported,
							model_match: parsed.model_match,
							model_failure_class: parsed.model_failure_class,
							model_check_skipped: parsed.model_check_skipped,
							transport_descriptor: transportDescriptor,
							cli_attested_model_raw: cliAttestedModelRaw,
							response_class: parsed.rate_limit
								? "rate_limit_induced_response"
								: null,
							retry_after_seconds:
								parsed.rate_limit?.retry_after_seconds ?? null,
							peer_file: fname,
							protocol_violation: parsed.protocol_violation,
						});
						responsePeers.push({
							agent: entry.agent,
							status: "fulfilled",
							peer_status: parsed.peer_status,
							peer_structured: parsed.peer_structured,
							status_source: parsed.status_source,
							parser_warnings: parsed.parser_warnings,
							peer_model: peerModel,
							model_requested: parsed.model_requested,
							model_reported: parsed.model_reported,
							model_match: parsed.model_match,
							model_failure_class: parsed.model_failure_class,
							model_check_skipped: parsed.model_check_skipped,
							transport_descriptor: transportDescriptor,
							cli_attested_model_raw: cliAttestedModelRaw,
							response_class: parsed.rate_limit
								? "rate_limit_induced_response"
								: null,
							retry_after_seconds:
								parsed.rate_limit?.retry_after_seconds ?? null,
							protocol_violation: parsed.protocol_violation,
							content: stdout,
							stderr_tail: (stderr || "").slice(-400),
						});
					}

					const convergenceHealth = computeConvergenceHealth(roundNum);
					store.appendRound(sessionId, {
						round: roundNum,
						caller: sessionCaller,
						caller_status: callerStatus,
						peers: roundPeers,
						quorum: {
							requested: metaPeers.length,
							responded: roundPeers.length,
							rejected: metaPeers.length - roundPeers.length,
						},
						rate_limited_peers: rateLimitedPeers,
						protocol_violation: anyProtocolViolation,
						duration_ms: durationMs,
						completed_at: new Date().toISOString(),
						convergence_health: convergenceHealth,
					});

					const allPeersReady =
						roundPeers.length === metaPeers.length &&
						roundPeers.every((p) => p.peer_status === "READY");

					log("ask_peers: done", {
						round: roundNum,
						caller_status: callerStatus,
						peers_responded: roundPeers.length,
						peers_requested: metaPeers.length,
						converged_this_round: callerStatus === "READY" && allPeersReady,
						duration_ms: durationMs,
					});

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										round: roundNum,
										caller_status: callerStatus,
										peers: responsePeers,
										quorum: {
											requested: metaPeers.length,
											responded: roundPeers.length,
											rejected: metaPeers.length - roundPeers.length,
										},
										rate_limited_peers: rateLimitedPeers,
										protocol_violation: anyProtocolViolation,
										convergence_health: convergenceHealth,
										...(promptLanguageWarning && {
											prompt_language_warning: promptLanguageWarning,
										}),
										duration_ms: durationMs,
									},
									null,
									2,
								),
							},
						],
					};
				} finally {
					store.releaseLock(sessionId);
				}
			}
			default:
				throw new Error(`unknown tool: ${name}`);
		}
	} catch (err) {
		log(`error in ${name}: ${err?.message || err}`);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ error: String(err?.message || err) }, null, 2),
				},
			],
			isError: true,
		};
	}
});

async function main() {
	log(
		`starting v${VERSION}, caller=${CALLER}, peers=${PEERS.join(",")}, legacy_bilateral_peer=${LEGACY_PEER || "(none)"}`,
	);
	const transport = new StdioServerTransport();
	await server.connect(transport);
	log("stdio transport connected");
}

if (!TEST_IMPORT) {
	main().catch((err) => {
		process.stderr.write(
			`[cross-review-mcp] fatal: ${err?.stack || err?.message || err}\n`,
		);
		process.exit(1);
	});
}

// Exported only for test harness (unit tests that require() the module
// without activating the stdio transport should set
// CROSS_REVIEW_TEST_IMPORT=1 and replace main() with a no-op before
// require; in practice, tests drive the server via stdio JSON-RPC).
module.exports = {
	VERSION,
	VALID_AGENTS,
	CALLER,
	PEERS,
	LEGACY_PEER,
	attachPromptTailDirective,
	parsePeerOutputs,
	// v1.1.0 / spec v4.13 §6.19 exports for smoke / audit.
	computeConvergenceHealth,
	CONVERGENCE_HEALTH_EXTENDED_AT,
	CONVERGENCE_HEALTH_CONCERNING_AT,
	// v1.2.0 / spec v4.14 §6.20 exports for smoke / audit.
	resolveCallerFromClientInfo,
	resolveCallerForSession,
	peersForCaller,
	legacyPeerForCaller,
	// v1.2.2 / spec v4.14 §6.10 enforcement exports for smoke.
	detectPromptLanguageDrift,
	PT_BR_LEXEMES,
	PROMPT_LANG_DIACRITICS_THRESHOLD,
	PROMPT_LANG_LEXEMES_THRESHOLD,
};
