// v0.6.0-alpha / spec v4.9 additions (approved by session c9508617, 2026-04-24):
//   - spawnPeer + probeAgent now return a `transport_descriptor`
//     { agent, auth, endpoint_class } that `parsePeerOutputs` consults to
//     decide whether the text self-report model-check applies. Non-api-key
//     transports (cli-subscription, oauth-personal) do NOT expose an
//     authoritative modelVersion; the check is skipped with an audit record
//     (`model_check_skipped.reason = 'unreliable_text_self_report_on_cli'`)
//     instead of false-positive-flagging `silent_model_downgrade`.
//   - probeAgent retires `tier: 'fallback'` in favor of `tier: 'ok' | 'offline'`.
//     Under bypass, a responded peer is `ok` with `model_check_skipped` set;
//     `failure_class: 'silent_model_downgrade'` is no longer emitted from the
//     probe for cli-subscription/oauth-personal peers.
//   - Rate-limit detection: `detectSpawnRateLimit(stderr)` matches a
//     provider-shaped lexeme set (429, rate limit, usage limit, quota
//     exceeded, insufficient_quota, RESOURCE_EXHAUSTED, Retry-After) on the
//     redacted stderr tail. When non-zero exit + lexeme → reject with
//     `err.spawn_rate_limit = { retry_after_seconds, lexeme_matched, detection_source: 'spawn' }`.
//     Generic `{rate, quota, limit}` is explicitly excluded to prevent
//     false-positives on meta-discussion.
//   - `cli_attested_model_raw`: extracts stderr banner line `model: <id>`.
//     For Codex this is forensic-only under cli-subscription; for the embedded
//     DeepSeek wrapper it is the provider-response model attestation.
//
// Spawn of the peer CLI with the definitive flag tree from the canonical
// README.
// - Codex: -a never -s read-only + mcp_servers.*.enabled=false (intersected
//   with configured) + apps.*.enabled=false + approval_mode=approve for
//   essential read-only tools + recursion prevented (cross-review stays
//   disabled if configured in config.toml).
// - Claude: --permission-mode default + --strict-mcp-config + minimal MCP +
//   write/edit tools disabled.
// - Gemini (added in v0.5.0-alpha / spec v4.7 triangular): --approval-mode
//   plan (read-only) + --allowed-mcp-server-names limited to
//   {memory, ultrathink, code-reasoning} (recursion prevented -- cross-review
//   is NOT in the allowlist) + --output-format text + explicit -m. Prompt is
//   delivered via stdin with a minimal -p marker " " to trigger
//   non-interactive mode; Gemini CLI appends -p to stdin (verified on
//   CLI 0.39.1), so the effective prompt equals the stdin content.
//
// Since v0.4.0-alpha (spec v4 section 6.9.2), all paths pass an EXPLICIT
// model flag targeting the top-tier model available in the operator's
// subscription -- never rely on CLI defaults (which may regress to smaller
// variants in future releases). IDs pinned in v0.5.0-alpha:
//   - Codex: model `gpt-5.5` + reasoning_effort `xhigh` (via -c override,
//            equivalent to a dedicated high-reasoning flag where available).
//   - Claude: model `claude-opus-4-7` (full ID, not an alias, for
//             auditability).
//   - Gemini: model `gemini-3.1-pro-preview` via Gemini CLI oauth-personal
//             auth under Google One AI Ultra subscription. Verified
//             2026-04-24: Ultra tier unlocks 3.x previews through the
//             v1internal code-assist endpoint (`cloudcode-pa.googleapis.com`).
//             Empirical evidence: `-m gemini-3.1-pro-preview` and
//             `-m gemini-3-pro-preview` both produce coherent responses
//             under Ultra (previously silent-downgraded to 2.5-pro /
//             2.5-flash on the pre-Ultra tier); `-m gemini-9.9-nonexistent`
//             returns clean 404 (server validates IDs; accepted 3.x IDs
//             are NOT silent-downgraded under Ultra).
//             KNOWN LIMITATION: the oauth-personal response does NOT
//             expose an authoritative `modelVersion` field (unlike the
//             SDK path), so the runtime silent-downgrade defense from
//             v0.5.0-alpha will still false-positive-flag based on the
//             model's unreliable text self-report (e.g. `gemini-1.5-pro`).
//             The protocol_violation audit flag is noisy on Gemini
//             rounds; convergence still works (based on peer_status
//             only, not protocol_violation). Resolution for a cleaner
//             audit trail requires SDK path (separate billing) or a
//             Gemini-specific bypass in the model-check (v0.6.0-alpha).
//   - DeepSeek: model `deepseek-v4-pro` via cross-review-v1's own embedded
//               DeepSeek CLI. The CLI is part of this package, reads prompts
//               from stdin, calls DeepSeek's OpenAI-compatible API with
//               thinking enabled, and deliberately contains no Gemini CLI code
//               or ~/.gemini/settings.json access.
// Model change requires explicit spec/config bump/edit; no silent fallback.
// `spawnPeer` returns `peer_model` for persistence in
// meta.json.rounds[i].peer_model, meeting the normative auditability
// requirement.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const CONFIGS_DIR = path.resolve(__dirname, "..", "..", "reviewer-configs");
const EXCLUSIONS_PATH = path.join(CONFIGS_DIR, "peer-exclusions.json");
const REVIEWER_MCP_JSON = path.join(CONFIGS_DIR, "reviewer-minimal.mcp.json");
const DEEPSEEK_MCP_JSON = path.join(CONFIGS_DIR, "deepseek-cli.mcp.json");

// Normative IDs for v0.5.0-alpha (spec v4 section 6.9.2, extended by v4.7
// triangular + v4.8 resilience).
const CODEX_MODEL = "gpt-5.5";
const CODEX_REASONING_EFFORT = "xhigh";
const CLAUDE_MODEL = "claude-opus-4-7";
const GEMINI_MODEL = "gemini-3.1-pro-preview";
const DEEPSEEK_MODEL = "deepseek-v4-pro";
const DEEPSEEK_REASONING_EFFORT = "max";
const DEEPSEEK_CLI_PATH = path.resolve(__dirname, "..", "deepseek-cli.js");

// Gemini peer containment: allowlist of MCP servers the peer may use while
// analyzing. Deliberately excludes cross-review-v1 to prevent recursion
// (spec v4 section 6.9.2). Includes the canonical reasoning stack so the
// peer can honor the tri-tool mandate (spec v4 section 6.2 per
// feedback_tri_tool_cross_review).
const GEMINI_ALLOWED_MCP_SERVERS = ["memory", "ultrathink", "code-reasoning"];
const DEEPSEEK_ALLOWED_MCP_SERVERS = [
	"memory",
	"ultrathink",
	"code-reasoning",
];

function copyEnvIfPresent(target, name) {
	if (process.env[name] !== undefined) target[name] = process.env[name];
}

function readWindowsRegistryEnv(name) {
	if (process.platform !== "win32") return undefined;
	const roots = [
		"HKCU\\Environment",
		"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
	];
	for (const root of roots) {
		try {
			const output = execFileSync(
				"reg",
				["query", root, "/v", name],
				{
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
					windowsHide: true,
				},
			);
			const line = output
				.split(/\r?\n/)
				.map((entry) => entry.trim())
				.find((entry) => entry.toLowerCase().startsWith(name.toLowerCase()));
			if (!line) continue;
			const match = line.match(
				new RegExp(`^${name}\\s+REG_\\w+\\s+(.+)$`, "i"),
			);
			if (match && match[1].trim()) return match[1].trim();
		} catch {}
	}
	return undefined;
}

function envValue(name) {
	if (process.env[name] !== undefined && process.env[name] !== "") {
		return process.env[name];
	}
	const registryValue = readWindowsRegistryEnv(name);
	if (registryValue !== undefined && registryValue !== "") {
		return registryValue;
	}
	return undefined;
}

function copyEnvValueIfPresent(target, name) {
	const value = envValue(name);
	if (value !== undefined) target[name] = value;
}

function buildDeepSeekEnv() {
	const env = {};
	for (const name of [
		"PATH",
		"Path",
		"PATHEXT",
		"SystemRoot",
		"SYSTEMROOT",
		"WINDIR",
		"windir",
		"ComSpec",
		"COMSPEC",
		"TEMP",
		"TMP",
		"USERPROFILE",
		"HOME",
		"APPDATA",
		"LOCALAPPDATA",
	]) {
		copyEnvIfPresent(env, name);
	}
	for (const name of [
		"DEEPSEEK_API_KEY",
		"DEEPSEEK_BASE_URL",
		"DEEPSEEK_MODEL",
		"DEEPSEEK_MAX_TOKENS",
		"DEEPSEEK_REASONING_EFFORT",
		"DEEPSEEK_THINKING",
		"DEEPSEEK_TIMEOUT_MS",
		"DEEPSEEK_MAX_TOOL_TURNS",
		"DEEPSEEK_MCP_CONFIG",
		"DEEPSEEK_ALLOWED_MCP_SERVERS",
	]) {
		copyEnvValueIfPresent(env, name);
	}
	return env;
}

// ---------------------------------------------------------------------------
// v0.6.0-alpha / spec v4.9 — transport_descriptor + rate-limit detection
// ---------------------------------------------------------------------------

// Pure decision function — composes the three transport signals into the
// final auth class. Exported for testing; callers in production code use
// `detectGeminiAuth()` which reads the signals from fs + env.
//
// Precedence (v0.9.0-alpha.1 / field-use session 6cf09af3 fix):
//   1. `~/.gemini/settings.json` `security.auth.selectedType` if parseable.
//      The CLI itself decides auth mode via this field; anything it
//      declares is authoritative.
//   2. `GEMINI_API_KEY` env var presence → 'api-key' (only consulted when
//      settings.json does NOT declare a selectedType).
//   3. `~/.gemini/oauth_creds.json` presence → 'oauth-personal'.
//   4. Default → 'oauth-personal' (matches CLI's documented default).
//
// Rationale: previous v0.6.0-alpha precedence put env-var first, which
// caused false-positive `silent_model_downgrade` for operators who set
// `GEMINI_API_KEY` for unrelated reasons while the CLI itself stayed on
// oauth-personal via settings.json. Session 6cf09af3 field-use validation
// surfaced this bug; Round 1 trilateral concurred on the settings.json-first
// precedence as the v1.0-blocker fix.
function geminiAuthFromSignals({
	settingsSelectedType,
	hasApiKeyEnv,
	hasOauthCreds,
}) {
	if (settingsSelectedType === "oauth-personal") return "oauth-personal";
	if (
		settingsSelectedType === "api-key" ||
		settingsSelectedType === "gemini-api-key"
	) {
		return "api-key";
	}
	// settingsSelectedType absent, null, or unrecognized → fall through to
	// env + fs signals.
	if (hasApiKeyEnv) return "api-key";
	if (hasOauthCreds) return "oauth-personal";
	return "oauth-personal";
}

// Production wrapper: reads fs + env, delegates the pure decision.
function detectGeminiAuth() {
	const home = os.homedir() || "";
	let settingsSelectedType = null;
	if (home) {
		const settingsPath = path.join(home, ".gemini", "settings.json");
		if (fs.existsSync(settingsPath)) {
			try {
				const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
				settingsSelectedType = settings?.security?.auth?.selectedType ?? null;
			} catch {
				// Malformed settings.json: fall through to env + fs signals.
				settingsSelectedType = null;
			}
		}
	}
	const hasApiKeyEnv = Boolean(process.env.GEMINI_API_KEY);
	const hasOauthCreds = Boolean(
		home && fs.existsSync(path.join(home, ".gemini", "oauth_creds.json")),
	);
	return geminiAuthFromSignals({
		settingsSelectedType,
		hasApiKeyEnv,
		hasOauthCreds,
	});
}

// Build a transport descriptor for the peer. The `auth` field gates the
// Item A model-check bypass in parsePeerOutputs: only 'api-key' exposes an
// authoritative modelVersion; cli-subscription / oauth-personal do not.
function buildTransportDescriptor(agent) {
	if (agent === "codex") {
		return {
			agent: "codex",
			auth: "cli-subscription",
			endpoint_class: "chatgpt-pro-backend",
		};
	}
	if (agent === "claude") {
		return {
			agent: "claude",
			auth: "cli-subscription",
			endpoint_class: "claude-pro-backend",
		};
	}
	if (agent === "gemini") {
		const auth = detectGeminiAuth();
		return {
			agent: "gemini",
			auth,
			endpoint_class:
				auth === "api-key" ? "generativelanguage-v1beta" : "v1internal",
		};
	}
	if (agent === "deepseek") {
		return {
			agent: "deepseek",
			auth: "api-key",
			endpoint_class: "deepseek-openai-compatible",
		};
	}
	return { agent: String(agent), auth: "unknown", endpoint_class: "unknown" };
}

// Gate: Item A bypass applies whenever the transport does NOT expose an
// authoritative modelVersion attestation (anything except api-key SDK path).
function authoritativeModelAttestationAvailable(descriptor) {
	return descriptor?.auth === "api-key";
}

// Provider-shaped rate-limit lexemes. Generic {rate, quota, limit} explicitly
// excluded to avoid false-positives on legitimate meta-discussion.
// v1.2.5 / external-audit round-4 §4.1: per-stream byte caps. F8 (v1.2.4)
// capped on-disk persistence (savePromptForRound + savePeerResponse) but
// did NOT cap RAM accumulation in stdout/stderr buffers — an infinite peer
// output would exhaust process memory before the spawn timeout fired.
// These caps detect overflow at receive time, kill the offending process
// tree, and reject with `err.stream_overflow = { stream, max_bytes, tail }`.
//
// Threshold rationale:
//   PEER_STREAM_MAX_BYTES = 4 MiB. Peers output O(10kb) typical, O(100kb)
//   verbose; 4 MiB is ~40x typical so no false positives on legitimate
//   long responses, but firmly bounds runaway output.
//   PROBE_STREAM_MAX_BYTES = 256 KiB. Probes are short by design (one-line
//   model self-report); a 256 KiB cap is still ~50x the canonical probe
//   response size of ~5 KiB and still well below the typical timeout budget
//   for a runaway probe.
const PEER_STREAM_MAX_BYTES = 4 * 1024 * 1024;
const PROBE_STREAM_MAX_BYTES = 256 * 1024;

// v1.4.0 §6.25 (gemini audit + codex follow-up, session bf4ffea3): rate-
// limit lexemes are regex-anchored to provider error shapes. Pre-v1.4.0,
// "429" was a bare-substring match — line numbers like `299:` / `429:` /
// `1429` from grep listings, file paths, timestamps, and benign code
// listings tripped the classifier and surfaced as
// `failure_class: "rate_limit_induced_response"`. Empirically observed in
// session bf4ffea3 R1: the codex peer rejection was actually a Windows-
// sandbox PowerShell ConstrainedLanguage failure (upstream Codex CLI bug —
// see memory `reference_codex_cli_sandbox_constrained_language.md`), but
// the classifier mismatched grep line numbers as 429.
//
// The contract is now:
//   - "429" only matches in HTTP / status / error / parens shapes
//     (e.g. `HTTP 429`, `status: 429`, `statusCode: 429`, `(429)`,
//     `"status": 429`, `error 429`, `code: 429`).
//   - Phrase tokens (Too Many Requests, rate limit, usage limit, quota
//     exceeded, insufficient_quota, RESOURCE_EXHAUSTED, Retry-After) match
//     on word boundaries — strict enough that benign mentions of "rate of
//     adoption" or "set a limit" don't trip.
//   - Pure substring matching is gone; a `429:` line number, a path
//     containing `/429/`, and a timestamp like `[14:29:00]` no longer
//     classify as rate-limit.
const RATE_LIMIT_PATTERNS = Object.freeze([
	{
		lexeme: "429",
		// Each anchored alternation member carries its own \b where the
		// member starts on a word char; the JSON shapes (`"status"`,
		// `"code"`) and the parens `(` member are quote/paren-anchored
		// on their own. Outer \b is intentionally absent because `\b`
		// doesn't fire before `"` (non-word) and would block the JSON
		// shape.
		//
		// v1.4.0 R2 (gemini@10b7a12b R2 finding): added
		//   - `Status-Code: 429` / `status_code: 429` via [-_]? separator
		//   - `"code": 429` (JSON-RPC error envelope)
		//   - `error: 429` / `error=429` / `error_code: 429` via
		//     [\s:=_-]+ separator class instead of strict whitespace
		re: /(?:\bHTTP\/[\d.]+\s+|\bHTTP\s+|\bstatus(?:[-_]?[Cc]ode)?\s*[:=]\s*|\bcode\s*[:=]\s*|"(?:status|code)"\s*:\s*|\berror[\s:=_-]+(?:code[\s:=_-]+)?|\(\s*)429\b/i,
	},
	{
		lexeme: "Too Many Requests",
		re: /\bToo\s+Many\s+Requests\b/i,
	},
	{
		lexeme: "rate limit",
		re: /\brate[-_\s]?limit(?:s)?(?:\s*(?:exceeded|reached|hit|enforced))?\b/i,
	},
	{
		lexeme: "usage limit",
		re: /\busage\s*limit(?:\s*(?:reached|exceeded|hit))?\b/i,
	},
	{
		lexeme: "quota exceeded",
		re: /\bquota\s*exceeded\b/i,
	},
	{
		lexeme: "insufficient_quota",
		re: /\binsufficient[_-]quota\b/i,
	},
	{
		lexeme: "RESOURCE_EXHAUSTED",
		re: /\bRESOURCE[_-]EXHAUSTED\b/i,
	},
	{
		lexeme: "Retry-After",
		re: /\bRetry[-_]After\b/i,
	},
]);

// Backward-compat export: the historical `RATE_LIMIT_LEXEMES` was a frozen
// string array consumed by smoke tests as an enumeration. Preserved as an
// extracted view of `RATE_LIMIT_PATTERNS` so external introspection still
// returns the same lexeme list.
const RATE_LIMIT_LEXEMES = Object.freeze(
	RATE_LIMIT_PATTERNS.map((p) => p.lexeme),
);

function matchRateLimitLexeme(text) {
	if (typeof text !== "string" || !text.length) return null;
	for (const { lexeme, re } of RATE_LIMIT_PATTERNS) {
		if (re.test(text)) return lexeme;
	}
	return null;
}

function extractRetryAfterSeconds(text) {
	if (typeof text !== "string") return null;
	const m = text.match(/retry[-_ ]after[:\s]+(\d+)/i);
	if (!m) return null;
	const n = Number(m[1]);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

// Spawn-level rate-limit detection: non-zero exit + stderr lexeme match.
// Returns null or { detection_source:'spawn', retry_after_seconds, lexeme_matched }.
function detectSpawnRateLimit(stderr) {
	const lexeme = matchRateLimitLexeme(stderr);
	if (!lexeme) return null;
	return {
		detection_source: "spawn",
		retry_after_seconds: extractRetryAfterSeconds(stderr),
		lexeme_matched: lexeme,
	};
}

// Provider-shaped moderation-flag lexemes. Distinct from rate-limit because
// the recovery is "reformulate the prompt and retry", not "wait and retry".
// OpenAI Codex CLI emits these on reasoning-model moderation rejections.
const PROMPT_FLAG_LEXEMES = Object.freeze([
	"your prompt was flagged as potentially violating",
	"flagged as potentially violating our usage policy",
	"invalid prompt: your prompt was flagged",
]);

function matchPromptFlagLexeme(text) {
	if (typeof text !== "string" || !text.length) return null;
	const lower = text.toLowerCase();
	for (const lex of PROMPT_FLAG_LEXEMES) {
		if (lower.includes(lex)) return lex;
	}
	return null;
}

// Spawn-level prompt-moderation detection: non-zero exit + stderr lexeme match.
// Returns null or { detection_source:'spawn', lexeme_matched, docs_url }.
// Recovery contract is recorded by the server.js handler as
// failure_class='prompt_flagged_by_moderation' + recovery_hint='reformulate_and_retry'.
function detectPromptModerationFlag(stderr) {
	const lexeme = matchPromptFlagLexeme(stderr);
	if (!lexeme) return null;
	return {
		detection_source: "spawn",
		lexeme_matched: lexeme,
		docs_url:
			"https://platform.openai.com/docs/guides/reasoning#advice-on-prompting",
	};
}

// Extract CLI stderr banner line `model: <id>`. For Codex this remains
// forensic-only under cli-subscription. For the embedded DeepSeek CLI, the
// line is written by our wrapper from the provider response model and is the
// authoritative transport attestation.
function extractCliAttestedModelRaw(stderr) {
	if (typeof stderr !== "string" || !stderr.length) return null;
	const m = stderr.match(/^model:\s*(\S[^\r\n]*)/m);
	return m ? m[1].trim() : null;
}

function extractCodexAttestedModelRaw(stderr) {
	return extractCliAttestedModelRaw(stderr);
}

function loadExclusions() {
	return JSON.parse(fs.readFileSync(EXCLUSIONS_PATH, "utf8"));
}

function listCodexConfiguredServers() {
	const configPath = path.join(
		process.env.USERPROFILE || process.env.HOME || "",
		".codex",
		"config.toml",
	);
	if (!fs.existsSync(configPath)) return [];
	const content = fs.readFileSync(configPath, "utf8");
	const names = new Set();
	const re = /^\[mcp_servers\.([^\].]+)\]/gm;
	for (;;) {
		const m = re.exec(content);
		if (m === null) break;
		names.add(m[1]);
	}
	return [...names];
}

// v1.4.0 §6.25 (codex follow-up, session bf4ffea3): Codex sandbox/approval
// policy is configurable via env vars. Default behavior is UNCHANGED for
// public consumers — `-a never -s read-only` is still the baseline. The
// motivation is operational: Codex CLI 0.125.0 on Windows runs PowerShell
// in ConstrainedLanguage under its sandbox, breaking the CLI's own command-
// safety layer (see memory `reference_codex_cli_sandbox_constrained_language.md`).
// On affected hosts the operator can opt in to a relaxed policy via:
//
//   CROSS_REVIEW_CODEX_SANDBOX = read-only | workspace-write | danger-full-access
//   CROSS_REVIEW_CODEX_APPROVAL = never | on-request | on-failure | untrusted
//   CROSS_REVIEW_CODEX_BYPASS  = 1 | true   (overrides both, emits
//                                            --dangerously-bypass-approvals-and-sandbox)
//
// Invalid values throw at spawn time so typos are loud, not silent. The
// resolved policy is logged once at module load via `logCodexSandboxPolicy`
// (called from server.js startup) so meta.json's spawn audit trail can be
// correlated with the operator's local env.
const CODEX_SANDBOX_VALID = Object.freeze([
	"read-only",
	"workspace-write",
	"danger-full-access",
]);
const CODEX_APPROVAL_VALID = Object.freeze([
	"never",
	"on-request",
	"on-failure",
	"untrusted",
]);
const CODEX_SANDBOX_DEFAULT = "read-only";
const CODEX_APPROVAL_DEFAULT = "never";

function resolveCodexSandboxPolicy() {
	const sandboxRaw = process.env.CROSS_REVIEW_CODEX_SANDBOX;
	const approvalRaw = process.env.CROSS_REVIEW_CODEX_APPROVAL;
	const bypassRaw = process.env.CROSS_REVIEW_CODEX_BYPASS;

	const sandbox = sandboxRaw ? sandboxRaw.toLowerCase() : CODEX_SANDBOX_DEFAULT;
	const approval = approvalRaw
		? approvalRaw.toLowerCase()
		: CODEX_APPROVAL_DEFAULT;
	const bypass =
		typeof bypassRaw === "string" &&
		(bypassRaw.toLowerCase() === "1" || bypassRaw.toLowerCase() === "true");

	if (!CODEX_SANDBOX_VALID.includes(sandbox)) {
		throw new Error(
			`buildCodexArgs: invalid CROSS_REVIEW_CODEX_SANDBOX='${sandboxRaw}'. ` +
				`Valid values: ${CODEX_SANDBOX_VALID.join(", ")}.`,
		);
	}
	if (!CODEX_APPROVAL_VALID.includes(approval)) {
		throw new Error(
			`buildCodexArgs: invalid CROSS_REVIEW_CODEX_APPROVAL='${approvalRaw}'. ` +
				`Valid values: ${CODEX_APPROVAL_VALID.join(", ")}.`,
		);
	}

	return {
		sandbox,
		approval,
		bypass,
		// Source labels surface intent in audit/log lines without exposing
		// the raw env-var strings (which the operator may consider host-local).
		source: {
			sandbox: sandboxRaw ? "env" : "default",
			approval: approvalRaw ? "env" : "default",
			bypass: bypass ? "env" : "default",
		},
	};
}

let _codexSandboxPolicyLogged = false;
function logCodexSandboxPolicy(write = (s) => process.stderr.write(s)) {
	if (_codexSandboxPolicyLogged) return null;
	_codexSandboxPolicyLogged = true;
	let policy;
	try {
		policy = resolveCodexSandboxPolicy();
	} catch (err) {
		write(`[cross-review-v1] codex sandbox config invalid: ${err.message}\n`);
		return { error: err.message };
	}
	if (
		policy.source.sandbox === "default" &&
		policy.source.approval === "default" &&
		!policy.bypass
	) {
		// Quiet on the default path so untouched installs don't add noise.
		return policy;
	}
	const parts = [
		`sandbox=${policy.sandbox}(${policy.source.sandbox})`,
		`approval=${policy.approval}(${policy.source.approval})`,
		policy.bypass ? "bypass=on(env)" : null,
	].filter(Boolean);
	write(`[cross-review-v1] codex policy: ${parts.join(" ")}\n`);
	return policy;
}

function _resetCodexSandboxPolicyLogForTests() {
	_codexSandboxPolicyLogged = false;
}

function buildCodexArgs() {
	const ex = loadExclusions();
	const configured = listCodexConfiguredServers();

	// Intersection: only override mcp_servers.* if it exists in config.toml,
	// otherwise the CLI yields "invalid transport".
	const effectiveDisable = (ex.codex_disable || []).filter((n) =>
		configured.includes(n),
	);
	const disableArgs = effectiveDisable.flatMap((n) => [
		"-c",
		`mcp_servers.${n}.enabled=false`,
	]);

	const appsDisableArgs = (ex.codex_apps_disable || []).flatMap((id) => [
		"-c",
		`apps.${id}.enabled=false`,
	]);

	const approveArgs = (ex.codex_approve_tools || []).flatMap(
		({ server, tool }) => [
			"-c",
			`mcp_servers.${server}.tools.${tool}.approval_mode=approve`,
		],
	);

	const policy = resolveCodexSandboxPolicy();
	const policyArgs = policy.bypass
		? ["--dangerously-bypass-approvals-and-sandbox"]
		: ["-a", policy.approval, "-s", policy.sandbox];

	return [
		...policyArgs,
		"-m",
		CODEX_MODEL,
		"-c",
		`model_reasoning_effort=${CODEX_REASONING_EFFORT}`,
		"exec",
		"--skip-git-repo-check",
		...disableArgs,
		...appsDisableArgs,
		...approveArgs,
		"-",
	];
}

function buildClaudeArgs() {
	return [
		"-p",
		"--output-format",
		"text",
		"--model",
		CLAUDE_MODEL,
		"--permission-mode",
		"default",
		"--strict-mcp-config",
		"--mcp-config",
		REVIEWER_MCP_JSON,
		"--disallowed-tools",
		"Write,Edit,NotebookEdit",
	];
}

function buildGeminiArgs() {
	const allowArgs = GEMINI_ALLOWED_MCP_SERVERS.flatMap((name) => [
		"--allowed-mcp-server-names",
		name,
	]);
	return [
		"-m",
		GEMINI_MODEL,
		"-p",
		" ",
		"--approval-mode",
		"plan",
		"--output-format",
		"text",
		...allowArgs,
	];
}

function buildDeepSeekArgs() {
	const allowArgs = DEEPSEEK_ALLOWED_MCP_SERVERS.flatMap((name) => [
		"--allowed-mcp-server-names",
		name,
	]);
	return [
		DEEPSEEK_CLI_PATH,
		"-m",
		DEEPSEEK_MODEL,
		"--thinking",
		"enabled",
		"--reasoning-effort",
		DEEPSEEK_REASONING_EFFORT,
		"--output-format",
		"text",
		"--mcp-config",
		DEEPSEEK_MCP_JSON,
		...allowArgs,
	];
}

function modelForPeer(peerAgent) {
	if (peerAgent === "codex") return CODEX_MODEL;
	if (peerAgent === "claude") return CLAUDE_MODEL;
	if (peerAgent === "gemini") return GEMINI_MODEL;
	if (peerAgent === "deepseek") return DEEPSEEK_MODEL;
	throw new Error(`modelForPeer: unknown peer agent '${peerAgent}'`);
}

// Kill a spawned child and its process tree. On Windows the `shell: true`
// child is cmd.exe which launches the real CLI; `proc.kill()` terminates
// cmd.exe but leaves the CLI orphaned. `taskkill /T /F` reaps the tree.
// On Unix we negate the pid to target the process group.
// R11 (Codex peer review F2 round 2): Windows spawn trees must be reaped
// on timeout and on retry; leaving orphans breaks wallclock budgets.
// v1.2.5 / external-audit round-4 §2 + R2 gemini fix: taskkill telemetry on
// Windows + simplified POSIX direct-PID kill. Pre-v1.2.5 behavior was
// fire-and-forget on Windows (silent failure if taskkill itself fails) and
// a process-group kill on POSIX that ALWAYS threw ESRCH (because we don't
// spawn detached, so -pid is not a valid PGID), with the swallowing catch
// preventing the fallback from ever running — guaranteed zombies on POSIX.
//
// This pass: Windows path captures taskkill stderr + exit code and emits
// telemetry to host stderr on failures. POSIX path skips the futile group
// kill and goes directly to PID kill (the only thing that works on
// non-detached spawns; orphaned grandchildren are a separate concern that
// requires `detached: true` work, deferred to v1.3+).
// v1.2.16 hotfix: cheap last-resort guard against killing self / direct
// parent at the kill primitive. The orphan sweep filters via the full
// ancestor chain (`ancestorPidSet` in `findOrphans`); this is an extra
// belt-and-braces in case any other call site (now or future) accidentally
// passes an ancestor PID. Doesn't catch grandparent without enumerating
// processes — that case is handled upstream in `findOrphans`. The taskkill
// /T flag terminates the entire tree, so killing our direct parent would
// also reap us; refusing is non-negotiable.
function killProcessTreeIsSuicide(pid) {
	if (typeof pid !== "number" || !Number.isFinite(pid)) return false;
	return pid === process.pid || pid === process.ppid;
}

function killProcessTree(proc) {
	// R2 gemini ask: also guard !proc.pid (executable failed to spawn → pid undefined).
	if (
		!proc?.pid ||
		proc.killed ||
		proc.exitCode != null ||
		proc.signalCode != null
	)
		return;
	// v1.2.16: refuse to suicide. See `killProcessTreeIsSuicide`.
	if (killProcessTreeIsSuicide(proc.pid)) {
		process.stderr.write(
			`[cross-review-v1] killProcessTree REFUSED PID=${proc.pid}: target is self (PID=${process.pid}) or direct parent (PPID=${process.ppid}); killing would suicide cross-review-v1\n`,
		);
		return;
	}
	if (process.platform === "win32") {
		let killer;
		try {
			killer = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (err) {
			// taskkill itself unavailable on PATH. Fall back to direct kill,
			// log the cleanup-tooling problem so the operator can investigate.
			// v1.2.8 caveat: same shell:true grandchild-orphan limitation as
			// the close-nonzero and error handlers below — proc IS the cmd.exe
			// shell, so SIGKILL reaps the shell handle but does NOT walk the
			// tree to the actual peer CLI grandchild. Full tree-kill is a
			// v1.3.x deferral tied to the shell:false migration.
			process.stderr.write(
				`[cross-review-v1] taskkill spawn error PID=${proc.pid}: ${err.message}; falling back to proc.kill (best-effort; on Windows shell:true, peer CLI grandchild may orphan if cmd.exe was the immediate child — see spec §6.18.3 v1.2.8 caveat)\n`,
			);
			try {
				proc.kill("SIGKILL");
			} catch {}
			return;
		}
		let stderrTail = "";
		killer.stderr.on("data", (d) => {
			stderrTail += d.toString("utf8");
			// Inline cap matches session-store.MAX_STDERR_TAIL_CHARS (2000).
			// Inlined to avoid a circular import between peer-spawn and
			// session-store; the constant is documented in session-store.js.
			if (stderrTail.length > 2000) {
				stderrTail = stderrTail.slice(-2000);
			}
		});
		killer.on("close", (code) => {
			if (code !== 0) {
				process.stderr.write(
					`[cross-review-v1] taskkill PID=${proc.pid} exit=${code}: ${stderrTail.slice(-400)}; falling back to proc.kill (best-effort; on Windows shell:true, peer CLI grandchild may orphan if cmd.exe was the immediate child — see spec §6.18.3 v1.2.8 caveat)\n`,
				);
				// v1.2.7 / external-audit round-5 F4: nonzero-exit fallback.
				// Pre-v1.2.7 we only logged. taskkill rarely fails (typical
				// causes: AV interference, permission inheritance bug, race
				// with normal exit), but when it does we'd leak the process.
				// proc.kill('SIGKILL') is a no-op on dead processes (catch
				// covers ESRCH) and a best-effort proc-handle reap on still-
				// live ones — strict improvement over log-and-leak. v1.2.8
				// caveat: under shell:true (§6.21), proc IS the cmd.exe shell
				// on Windows, so this kills the shell handle but does NOT
				// walk the tree; full tree-kill completeness is a v1.3.x
				// deferral tied to the shell:false migration.
				try {
					proc.kill("SIGKILL");
				} catch {}
			}
		});
		killer.on("error", (err) => {
			process.stderr.write(
				`[cross-review-v1] taskkill PID=${proc.pid} runtime error: ${err.message}; falling back to proc.kill (best-effort; on Windows shell:true, peer CLI grandchild may orphan if cmd.exe was the immediate child — see spec §6.18.3 v1.2.8 caveat)\n`,
			);
			// v1.2.7 / external-audit round-5 F4: same fallback for runtime errors.
			// v1.2.8 caveat: same shell:true grandchild-orphan limitation as
			// the close-nonzero path above; full tree-kill is v1.3.x.
			try {
				proc.kill("SIGKILL");
			} catch {}
		});
		return;
	}
	// POSIX: direct PID kill. The previous group-kill (-pid) attempt was
	// dead code because non-detached children aren't process group leaders,
	// so kill(-pid) always threw ESRCH and the swallowing catch returned
	// before the fallback fired (gemini R2 catch).
	try {
		process.kill(proc.pid, "SIGKILL");
	} catch (err) {
		// ESRCH = already dead, success-when-already-dead. Other errors
		// are unexpected and worth surfacing.
		if (err.code !== "ESRCH") {
			process.stderr.write(
				`[cross-review-v1] kill PID=${proc.pid}: ${err.message}\n`,
			);
		}
	}
}

// Probe stub: short-circuits probeAgent for smoke tests.
// CROSS_REVIEW_PROBE_STUB format: comma-separated "agent:tier[:model]"
// entries. Tier in {top, fallback, excluded, ok, offline}.
//   - v0.5.0-alpha legacy: {top, fallback, excluded} — kept for smoke backward compat.
//   - v0.6.0-alpha canonical: {ok, offline} — ok = responded (check passed or bypassed);
//     offline = did not respond (spawn/probe error / rate-limit).
// Model defaults to modelForPeer(agent). Unlisted agents fall through to real probe.
// Example: "gemini:ok:gemini-3.1-pro-preview,codex:offline,claude:ok:claude-opus-4-7"
function probeStubFor(agent) {
	const raw = process.env.CROSS_REVIEW_PROBE_STUB;
	if (!raw) return null;
	const entries = raw
		.split(",")
		.map((e) => e.trim())
		.filter(Boolean)
		.map((e) => e.split(":"));
	for (const parts of entries) {
		const [a, tier, model] = parts;
		if (a !== agent) continue;
		if (!["top", "fallback", "excluded", "ok", "offline"].includes(tier)) {
			return null;
		}
		const offline = tier === "excluded" || tier === "offline";
		const descriptor = buildTransportDescriptor(agent);
		const reportedModel = model || modelForPeer(agent);
		const attested = authoritativeModelAttestationAvailable(descriptor);
		const modelMatch = reportedModel === modelForPeer(agent);
		return {
			agent,
			tier,
			requested_model: modelForPeer(agent),
			model_reported: reportedModel,
			model_match: attested ? modelMatch : null,
			probe_latency_ms: 0,
			probe_budget_ms: 30000,
			exit_code: offline ? 1 : 0,
			failure_class: offline ? "probe_excluded_stub" : null,
			cli_version: null,
			timestamp: new Date().toISOString(),
			stderr_tail: "",
			transport_descriptor: descriptor,
			model_check_skipped:
				!offline && !attested
					? {
							reason: "unreliable_text_self_report_on_cli",
							auth: descriptor.auth,
							endpoint_class: descriptor.endpoint_class,
						}
					: null,
			cli_attested_model_raw: null,
		};
	}
	return null;
}

// Probe a single agent with a minimal CLI call to determine tier and
// confirm the model identity. 30s default budget; configurable via
// options.budgetMs. Returns a rich capability_snapshot entry (spec v4.8
// section 6.9.3 + F2 Q6 field schema).
function probeAgent(agent, options = {}) {
	const stubbed = probeStubFor(agent);
	if (stubbed) return Promise.resolve(stubbed);

	const budgetMs = options.budgetMs ?? 30 * 1000;
	const started = Date.now();
	const requested = modelForPeer(agent);
	// Minimal probe prompt; the peer is expected to reply tersely.
	const prompt =
		"Identify your exact model id in one short line, then stop. " +
		"No other output needed.";

	return new Promise((resolve) => {
		let resolved = false;
		const finish = (snapshot) => {
			if (resolved) return;
			resolved = true;
			resolve(snapshot);
		};

		let proc;
		try {
			let cmd;
			let args;
			if (agent === "codex") {
				cmd = "codex";
				args = buildCodexArgs();
			} else if (agent === "claude") {
				cmd = "claude";
				args = buildClaudeArgs();
			} else if (agent === "gemini") {
				cmd = "gemini";
				args = buildGeminiArgs();
			} else if (agent === "deepseek") {
				cmd = process.execPath;
				args = buildDeepSeekArgs();
			} else {
				return finish({
					agent,
					tier: "excluded",
					requested_model: null,
					model_reported: null,
					model_match: false,
					probe_latency_ms: 0,
					probe_budget_ms: budgetMs,
					exit_code: -1,
					failure_class: "unknown_agent",
					cli_version: null,
					timestamp: new Date().toISOString(),
					stderr_tail: "",
				});
			}
			const cmdLine = buildCommandLine(cmd, args);
			const spawnOptions = {
				stdio: ["pipe", "pipe", "pipe"],
				shell: true,
				windowsHide: true,
			};
			if (agent === "deepseek") {
				spawnOptions.env = buildDeepSeekEnv();
			}
			proc = spawn(cmdLine, spawnOptions);
		} catch (err) {
			return finish({
				agent,
				tier: "offline",
				requested_model: requested,
				model_reported: null,
				model_match: false,
				probe_latency_ms: Date.now() - started,
				probe_budget_ms: budgetMs,
				exit_code: -1,
				failure_class: "spawn_error",
				cli_version: null,
				timestamp: new Date().toISOString(),
				stderr_tail: String(err?.message || err).slice(-400),
				transport_descriptor: buildTransportDescriptor(agent),
				model_check_skipped: null,
				cli_attested_model_raw: null,
			});
		}

		let stdout = "";
		let stderr = "";

		// v1.2.7 / external-audit round-5 F3: same listener-detach pattern
		// as spawnPeer — halt JS-side buffer growth before the kill window
		// opens. See spawnPeer's `detachStreamListeners` for full rationale.
		const detachProbeListeners = () => {
			try {
				proc.stdout.removeAllListeners("data");
			} catch {}
			try {
				proc.stderr.removeAllListeners("data");
			} catch {}
		};

		const timer = setTimeout(() => {
			if (resolved) return;
			detachProbeListeners();
			killProcessTree(proc);
			finish({
				agent,
				tier: "offline",
				requested_model: requested,
				model_reported: null,
				model_match: false,
				probe_latency_ms: Date.now() - started,
				probe_budget_ms: budgetMs,
				exit_code: -1,
				failure_class: "probe_timeout",
				cli_version: null,
				timestamp: new Date().toISOString(),
				stderr_tail: stderr.slice(-400),
				transport_descriptor: buildTransportDescriptor(agent),
				model_check_skipped: null,
				cli_attested_model_raw: null,
			});
		}, budgetMs);

		// v1.2.5 / external-audit round-4 §4.1: per-stream byte cap on probes.
		let stdoutBytes = 0;
		let stderrBytes = 0;
		const probeOverflow = (stream) => {
			if (resolved) return;
			clearTimeout(timer);
			detachProbeListeners();
			killProcessTree(proc);
			finish({
				agent,
				tier: "offline",
				requested_model: requested,
				model_reported: null,
				model_match: false,
				probe_latency_ms: Date.now() - started,
				probe_budget_ms: budgetMs,
				exit_code: -1,
				failure_class: "probe_stream_overflow",
				cli_version: null,
				timestamp: new Date().toISOString(),
				stderr_tail: (stream === "stderr" ? stderr : stderr).slice(-400),
				transport_descriptor: buildTransportDescriptor(agent),
				model_check_skipped: null,
				cli_attested_model_raw: null,
				stream_overflow: { stream, max_bytes: PROBE_STREAM_MAX_BYTES },
			});
		};
		proc.stdout.on("data", (d) => {
			stdoutBytes += d.length;
			stdout += d.toString("utf8");
			if (stdoutBytes > PROBE_STREAM_MAX_BYTES) probeOverflow("stdout");
		});
		proc.stderr.on("data", (d) => {
			stderrBytes += d.length;
			stderr += d.toString("utf8");
			if (stderrBytes > PROBE_STREAM_MAX_BYTES) probeOverflow("stderr");
		});
		proc.on("error", (err) => {
			clearTimeout(timer);
			finish({
				agent,
				tier: "offline",
				requested_model: requested,
				model_reported: null,
				model_match: false,
				probe_latency_ms: Date.now() - started,
				probe_budget_ms: budgetMs,
				exit_code: -1,
				failure_class: "spawn_error",
				cli_version: null,
				timestamp: new Date().toISOString(),
				stderr_tail: String(err?.message || err).slice(-400),
				transport_descriptor: buildTransportDescriptor(agent),
				model_check_skipped: null,
				cli_attested_model_raw: null,
			});
		});
		proc.on("close", (code) => {
			clearTimeout(timer);
			const latency = Date.now() - started;
			const stderrTail = stderr.slice(-400);
			const descriptor = buildTransportDescriptor(agent);
			const cli_attested_model_raw =
				agent === "codex" || agent === "deepseek"
					? extractCliAttestedModelRaw(stderr)
					: null;

			// Non-zero exit: classify. Spawn-level rate-limit takes
			// precedence over generic probe_nonzero_exit.
			if (code !== 0) {
				const rl = detectSpawnRateLimit(stderrTail);
				return finish({
					agent,
					tier: "offline",
					requested_model: requested,
					model_reported: null,
					model_match: false,
					probe_latency_ms: latency,
					probe_budget_ms: budgetMs,
					exit_code: code,
					failure_class: rl
						? "rate_limit_induced_response"
						: "probe_nonzero_exit",
					retry_after_seconds: rl?.retry_after_seconds ?? null,
					lexeme_matched: rl?.lexeme_matched ?? null,
					cli_version: null,
					timestamp: new Date().toISOString(),
					stderr_tail: stderrTail,
					transport_descriptor: descriptor,
					model_check_skipped: null,
					cli_attested_model_raw,
				});
			}

			// Zero exit: apply Item A bypass gate. api-key is the only
			// transport that exposes an authoritative modelVersion;
			// cli-subscription / oauth-personal text self-report is unreliable
			// and MUST NOT trip silent_model_downgrade.
			const reported =
				agent === "deepseek" && cli_attested_model_raw
					? cli_attested_model_raw
					: extractReportedModel(stdout);
			const attested = authoritativeModelAttestationAvailable(descriptor);

			if (attested) {
				const match = reported != null && reported === requested;
				return finish({
					agent,
					tier: match ? "ok" : "offline",
					requested_model: requested,
					model_reported: reported,
					model_match: match,
					probe_latency_ms: latency,
					probe_budget_ms: budgetMs,
					exit_code: code,
					failure_class: match
						? null
						: reported
							? "silent_model_downgrade"
							: "probe_no_model_report",
					cli_version: null,
					timestamp: new Date().toISOString(),
					stderr_tail: stderrTail,
					transport_descriptor: descriptor,
					model_check_skipped: null,
					cli_attested_model_raw,
				});
			}

			// Item A bypass: responded + non-api-key transport → ok + audit
			// record. `model_match` is null (not applicable under bypass)
			// rather than false (which would imply a real mismatch).
			finish({
				agent,
				tier: "ok",
				requested_model: requested,
				model_reported: reported,
				model_match: null,
				probe_latency_ms: latency,
				probe_budget_ms: budgetMs,
				exit_code: code,
				failure_class: null,
				cli_version: null,
				timestamp: new Date().toISOString(),
				stderr_tail: stderrTail,
				transport_descriptor: descriptor,
				model_check_skipped: {
					reason: "unreliable_text_self_report_on_cli",
					auth: descriptor.auth,
					endpoint_class: descriptor.endpoint_class,
				},
				cli_attested_model_raw,
			});
		});

		proc.stdin.write(prompt);
		proc.stdin.end();
	});
}

// Heuristic extractor for a model id from the probe response. The peer
// was asked for "your exact model id in one short line"; we pick the
// last non-empty line that matches a conservative id shape (letters,
// digits, dots, hyphens, underscores; length 3-80). Returns null if no
// candidate found.
function extractReportedModel(stdout) {
	if (!stdout) return null;
	const lines = stdout
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	if (lines.length === 0) return null;
	const idShape = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const candidate = lines[i];
		if (idShape.test(candidate)) return candidate;
		// Allow a line like "I am gemini-2.5-pro." -> strip trailing
		// punctuation and extract last token.
		const tokens = candidate
			.split(/\s+/)
			.map((t) => t.replace(/[.,;:!?]+$/, ""));
		for (let j = tokens.length - 1; j >= 0; j -= 1) {
			if (idShape.test(tokens[j])) return tokens[j];
		}
	}
	return null;
}

// Probe multiple agents in parallel. Promise.allSettled preserves
// per-agent partial results; never rejects. Returns an array of
// snapshots in the same order as `agents`.
function probeChain(agents, options = {}) {
	const tasks = agents.map((a) => probeAgent(a, options));
	return Promise.allSettled(tasks).then((results) =>
		results.map((r, i) => {
			if (r.status === "fulfilled") return r.value;
			return {
				agent: agents[i],
				tier: "offline",
				requested_model: null,
				model_reported: null,
				model_match: false,
				probe_latency_ms: 0,
				probe_budget_ms: options.budgetMs ?? 30 * 1000,
				exit_code: -1,
				failure_class: "probe_rejected",
				cli_version: null,
				timestamp: new Date().toISOString(),
				stderr_tail: String(r.reason?.message || r.reason).slice(-400),
				transport_descriptor: buildTransportDescriptor(agents[i]),
				model_check_skipped: null,
				cli_attested_model_raw: null,
			};
		}),
	);
}

// Test stub. Does NOT spawn a real CLI -- returns a synthetic response so
// functional-smoke can cover ask_peer without LLM cost. Must never be set
// outside tests.
//
// Supported forms for CROSS_REVIEW_PEER_STUB:
//   READY | NOT_READY | NEEDS_EVIDENCE
//     -> body + final line "STATUS: X" as last non-empty line (legacy).
//   MISSING
//     -> body without parseable STATUS; triggers protocol_violation.
//   ERROR
//     -> rejects the promise simulating a spawn failure.
//   STRUCTURED:READY | STRUCTURED:NOT_READY | STRUCTURED:NEEDS_EVIDENCE
//     -> body + structured block as TAIL.
//   STRUCTURED_EARLY_REGEX_LAST:<STRUCTURED_STATUS>:<REGEX_STATUS>
//     -> structured block mid-body and line "STATUS: <REGEX_STATUS>" as the
//        last non-empty line. Expected semantics: regex wins
//        (anchor = last-non-empty-line).
//   STRUCTURED_LAST_REGEX_EARLY:<REGEX_STATUS>:<STRUCTURED_STATUS>
//     -> line "STATUS: <REGEX_STATUS>" mid-body and structured block as
//        TAIL. Expected semantics: structured wins.
//   MALFORMED_STRUCTURED_TAIL
//     -> tail with </cross_review_status> whose inner JSON is invalid. Must
//        NOT fall through to regex (tail is the closing tag). Expected:
//        status=null.
//   INVALID_STATUS_STRUCTURED_TAIL
//     -> tail with well-formed structured block but status outside the enum
//        (e.g. {"status":"MAYBE"}). Expected: status=null, structured=null.
//   LOWERCASE_STATUS
//     -> last line "STATUS: ready" (lowercase). Case-sensitive regex
//        rejects. Expected: status=null.
//   PROSE_MENTION_STATUS
//     -> body with "STATUS: READY" cited in prose (e.g. inside backticks)
//        and a different last non-empty line. Expected: status=null
//        (false-positive protection).
//   PROSE_MENTION_BLOCK
//     -> body with "<cross_review_status>..." cited in prose and tail
//        ending in free text. Expected: status=null.
//   DOUBLE_STRUCTURED:<EARLY>:<LAST>
//     -> two structured blocks; the LAST (tail) wins. Expected: status=LAST.
const LEGACY_STATUSES = new Set(["READY", "NOT_READY", "NEEDS_EVIDENCE"]);

function assertLegacy(status, label) {
	if (!LEGACY_STATUSES.has(status)) {
		throw new Error(
			`stub: invalid status '${status}' for ${label} (need one of {READY,NOT_READY,NEEDS_EVIDENCE})`,
		);
	}
}

function resolveStub(stub) {
	const body = `[stub peer response; CROSS_REVIEW_PEER_STUB=${stub}]`;
	const stderr = "[stub] peer spawn skipped\n";
	const peer_model = "stub";
	// Stubs bypass the model-check entirely via peer_model==='stub' — the
	// isStub short-circuit in parsePeerOutputs fires first. For the REAL_*
	// stubs that DO exercise the model-check defense end-to-end (REAL_MATCH /
	// REAL_DOWNGRADE / REAL_MISSING_MODEL return a real `peer_model`), we set
	// auth='api-key' so the v4.9 transport-aware bypass does NOT skip the
	// check — the defense must still fire in those tests. Coverage of the
	// v4.9 bypass behavior lives in dedicated unit steps that call
	// parsePeerOutputs directly with a non-api-key descriptor.
	const transport_descriptor = {
		agent: "stub",
		auth: "api-key",
		endpoint_class: "stub",
	};
	const cli_attested_model_raw = null;

	if (stub === "MISSING") {
		return {
			stdout: `${body}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (LEGACY_STATUSES.has(stub)) {
		return {
			stdout: `${body}\n\nSTATUS: ${stub}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub.startsWith("STRUCTURED:")) {
		const status = stub.slice("STRUCTURED:".length);
		assertLegacy(status, "STRUCTURED");
		const block = `<cross_review_status>${JSON.stringify({ status })}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub.startsWith("STRUCTURED_EARLY_REGEX_LAST:")) {
		const rest = stub.slice("STRUCTURED_EARLY_REGEX_LAST:".length);
		const [structured, regex] = rest.split(":");
		assertLegacy(structured, "STRUCTURED_EARLY_REGEX_LAST structured");
		assertLegacy(regex, "STRUCTURED_EARLY_REGEX_LAST regex");
		const block = `<cross_review_status>${JSON.stringify({ status: structured })}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n\nmore prose here\n\nSTATUS: ${regex}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub.startsWith("STRUCTURED_LAST_REGEX_EARLY:")) {
		const rest = stub.slice("STRUCTURED_LAST_REGEX_EARLY:".length);
		const [regex, structured] = rest.split(":");
		assertLegacy(regex, "STRUCTURED_LAST_REGEX_EARLY regex");
		assertLegacy(structured, "STRUCTURED_LAST_REGEX_EARLY structured");
		const block = `<cross_review_status>${JSON.stringify({ status: structured })}</cross_review_status>`;
		return {
			stdout: `${body}\n\nSTATUS: ${regex}\n\nmore prose here\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "MALFORMED_STRUCTURED_TAIL") {
		const malformedBlock =
			"<cross_review_status>{not valid json</cross_review_status>";
		return {
			stdout: `${body}\n\n${malformedBlock}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "INVALID_STATUS_STRUCTURED_TAIL") {
		const block = `<cross_review_status>${JSON.stringify({ status: "MAYBE" })}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "LOWERCASE_STATUS") {
		return {
			stdout: `${body}\n\nSTATUS: ready\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "PROSE_MENTION_STATUS") {
		return {
			stdout: `${body}\n\nFor example, the peer could write \`STATUS: READY\` at the end.\n\nBut this response is not ended with the canonical marker.\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "PROSE_MENTION_BLOCK") {
		return {
			stdout: `${body}\n\nExample of the canonical tag: <cross_review_status>{"status":"READY"}</cross_review_status>\n\nThis response ends with prose and does not terminate with the canonical tag.\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub.startsWith("DOUBLE_STRUCTURED:")) {
		const rest = stub.slice("DOUBLE_STRUCTURED:".length);
		const [early, last] = rest.split(":");
		assertLegacy(early, "DOUBLE_STRUCTURED early");
		assertLegacy(last, "DOUBLE_STRUCTURED last");
		const b1 = `<cross_review_status>${JSON.stringify({ status: early })}</cross_review_status>`;
		const b2 = `<cross_review_status>${JSON.stringify({ status: last })}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${b1}\n\nintermediate prose\n\n${b2}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub.startsWith("MULTILINE_STRUCTURED:")) {
		const status = stub.slice("MULTILINE_STRUCTURED:".length);
		assertLegacy(status, "MULTILINE_STRUCTURED");
		// Pretty-printed JSON payload between multi-line tags. Parser must
		// extract body via slice and JSON.parse must tolerate the whitespace.
		const prettyPayload = `{\n  "status": ${JSON.stringify(status)}\n}`;
		return {
			stdout: `${body}\n\n<cross_review_status>\n${prettyPayload}\n</cross_review_status>\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	// v0.4.0 stubs -- expanded schema and missing-close-tag gap.
	if (stub === "STRUCTURED_V4_FULL") {
		const block = `<cross_review_status>${JSON.stringify({
			status: "READY",
			uncertainty: "low",
			caller_requests: ["verify X", "confirm Y"],
			follow_ups: ["cleanup Z in future session"],
		})}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "STRUCTURED_V4_BAD_UNCERTAINTY") {
		const block = `<cross_review_status>${JSON.stringify({
			status: "READY",
			uncertainty: "super-high",
		})}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "STRUCTURED_V4_BAD_CALLER_REQUESTS_SHAPE") {
		const block = `<cross_review_status>${JSON.stringify({
			status: "NEEDS_EVIDENCE",
			caller_requests: "this should be an array",
		})}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "STRUCTURED_V4_NON_STRING_ITEM") {
		const block = `<cross_review_status>${JSON.stringify({
			status: "READY",
			follow_ups: ["ok", 123, "also ok"],
		})}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "STRUCTURED_V4_TOO_MANY_CALLER_REQUESTS") {
		const requests = Array.from({ length: 21 }, (_, i) => `req ${i + 1}`);
		const block = `<cross_review_status>${JSON.stringify({
			status: "NEEDS_EVIDENCE",
			caller_requests: requests,
		})}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "STRUCTURED_V4_OVERSIZED_ITEM") {
		const bigString = "x".repeat(501);
		const block = `<cross_review_status>${JSON.stringify({
			status: "NEEDS_EVIDENCE",
			caller_requests: ["ok", bigString],
		})}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "STRUCTURED_V4_UNKNOWN_FIELD") {
		const block = `<cross_review_status>${JSON.stringify({
			status: "READY",
			extra: "not in whitelist",
			another_unknown: 42,
		})}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "STRUCTURED_V4_EMPTY_ARRAYS") {
		const block = `<cross_review_status>${JSON.stringify({
			status: "READY",
			caller_requests: [],
			follow_ups: [],
		})}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${block}\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	// v0.5.0-alpha stubs for server-level model-check (W8). Unlike the
	// other stubs that all return peer_model='stub' to bypass the
	// model-check entirely, these return a REAL-looking peer_model so
	// the server activates parseDeclaredModel + classifyModelMatch.
	// Used by smoke tests to exercise the silent-downgrade defense
	// end-to-end via the MCP surface.
	if (stub.startsWith("REAL_MATCH:")) {
		// REAL_MATCH:<model_id>:<status>
		const parts = stub.split(":");
		const modelId = parts[1];
		const status = parts[2];
		assertLegacy(status, "REAL_MATCH");
		const modelBlock = `<cross_review_peer_model>${JSON.stringify({ model_id: modelId })}</cross_review_peer_model>`;
		const statusBlock = `<cross_review_status>${JSON.stringify({ status })}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${modelBlock}\n${statusBlock}\n`,
			stderr,
			peer_model: modelId,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub.startsWith("REAL_DOWNGRADE:")) {
		// REAL_DOWNGRADE:<requested>:<reported>:<status>
		const parts = stub.split(":");
		const requested = parts[1];
		const reported = parts[2];
		const status = parts[3];
		assertLegacy(status, "REAL_DOWNGRADE");
		const modelBlock = `<cross_review_peer_model>${JSON.stringify({ model_id: reported })}</cross_review_peer_model>`;
		const statusBlock = `<cross_review_status>${JSON.stringify({ status })}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${modelBlock}\n${statusBlock}\n`,
			stderr,
			peer_model: requested,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub.startsWith("REAL_MISSING_MODEL:")) {
		// REAL_MISSING_MODEL:<requested>:<status>
		const parts = stub.split(":");
		const requested = parts[1];
		const status = parts[2];
		assertLegacy(status, "REAL_MISSING_MODEL");
		const statusBlock = `<cross_review_status>${JSON.stringify({ status })}</cross_review_status>`;
		return {
			stdout: `${body}\n\n${statusBlock}\n`,
			stderr,
			peer_model: requested,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	if (stub === "STRUCTURED_OPEN_NO_CLOSE") {
		// Open tag present but no close tag. Tail does not end with close,
		// falls through to tryLegacyLastLine; without a canonical
		// "STATUS: X" on the last line, returns null (protocol_violation
		// expected).
		const fakeOpen = '<cross_review_status>{"status":"READY"}';
		return {
			stdout: `${body}\n\n${fakeOpen}\n\nprose after the unclosed opening.\n`,
			stderr,
			peer_model,
			transport_descriptor,
			cli_attested_model_raw,
		};
	}
	throw new Error(`stub: unknown CROSS_REVIEW_PEER_STUB form '${stub}'`);
}

function peerStub() {
	const stub = process.env.CROSS_REVIEW_PEER_STUB;
	if (!stub) return null;
	if (stub === "ERROR") {
		return Promise.reject(new Error("stub: simulated peer failure"));
	}
	try {
		return Promise.resolve(resolveStub(stub));
	} catch (err) {
		return Promise.reject(err);
	}
}

// Build a quoted command line to pass to the shell. Avoids the pattern
// spawn(cmd, args, {shell: true}) that Node 20+ flags as unsafe for args
// with special chars. Our args are internal (not user input), but the safe
// pattern is still worth following.
function buildCommandLine(cmd, args) {
	const quote = (s) => {
		const str = String(s);
		if (str.length && !/[\s"'$`\\]/.test(str)) return str;
		return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	};
	return [quote(cmd), ...args.map(quote)].join(" ");
}

function spawnPeer(peerAgent, prompt, options = {}) {
	const stubbed = peerStub();
	if (stubbed) return stubbed;
	const started = Date.now();

	// v1.2.15 / spec §6.22 Item F — per-peer timeout configurable.
	// Default reduced from 30min (pre-v1.2.15) to 8min, aligned with
	// observed real-world peer latency (3-9min typical for trilateral
	// review prompts). Operator override via `CROSS_REVIEW_PEER_TIMEOUT_MS`
	// env var, or per-call `options.timeoutMs`. The round-level timeout
	// (CROSS_REVIEW_ROUND_TIMEOUT_MS, default 12min) acts as the wall-clock
	// backstop when per-peer wedges entirely.
	const peerTimeoutEnv = Number.parseInt(
		process.env.CROSS_REVIEW_PEER_TIMEOUT_MS || "",
		10,
	);
	const timeoutMs =
		options.timeoutMs ??
		(Number.isInteger(peerTimeoutEnv) && peerTimeoutEnv > 0
			? peerTimeoutEnv
			: 8 * 60 * 1000);
	let cmd;
	let args;
	if (peerAgent === "codex") {
		cmd = "codex";
		args = buildCodexArgs();
	} else if (peerAgent === "claude") {
		cmd = "claude";
		args = buildClaudeArgs();
	} else if (peerAgent === "gemini") {
		cmd = "gemini";
		args = buildGeminiArgs();
	} else if (peerAgent === "deepseek") {
		cmd = process.execPath;
		args = buildDeepSeekArgs();
	} else {
		return Promise.reject(
			new Error(`spawnPeer: unknown peer agent '${peerAgent}'`),
		);
	}
	const cmdLine = buildCommandLine(cmd, args);

	return new Promise((resolve, reject) => {
		const spawnOptions = {
			stdio: ["pipe", "pipe", "pipe"],
			shell: true,
			windowsHide: true,
		};
		if (peerAgent === "deepseek") {
			spawnOptions.env = buildDeepSeekEnv();
		}
		const proc = spawn(cmdLine, spawnOptions);
		let stdout = "";
		let stderr = "";
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let finished = false;

		// v1.2.7 / external-audit round-5 F3: detach data listeners BEFORE
		// killProcessTree to halt JS-side buffer growth during the kill window
		// (Windows taskkill is async and can take 50-200ms; without this,
		// buffers keep accumulating from in-flight `data` events and a hostile
		// peer can push the soft cap to 8-16+ MiB). removeAllListeners is
		// pure JS-land — it doesn't race with taskkill the way destroy() can.
		// A single `data` event already in the microtask queue may still fire
		// once after detach (single-chunk-bounded leak ≤64 KiB per event).
		const detachStreamListeners = () => {
			try {
				proc.stdout.removeAllListeners("data");
			} catch {}
			try {
				proc.stderr.removeAllListeners("data");
			} catch {}
		};

		const timer = setTimeout(() => {
			if (finished) return;
			finished = true;
			detachStreamListeners();
			killProcessTree(proc);
			const err = new Error(
				`peer ${peerAgent} timed out after ${timeoutMs / 1000}s`,
			);
			err.duration_ms = Date.now() - started;
			err.stdout_tail = stdout.slice(-400);
			err.stderr_tail = stderr.slice(-400);
			err.transport_descriptor = buildTransportDescriptor(peerAgent);
			reject(err);
		}, timeoutMs);

		// v1.2.5 / external-audit round-4 §4.1: per-stream byte cap.
		// Bounds RAM accumulation independently of the disk cap (F8 in
		// v1.2.4). On overflow: detach listeners + kill the process tree +
		// reject with a structured `err.stream_overflow = { stream, max_bytes,
		// tail }` so the server.js handler can classify
		// failure_class='stream_overflow'.
		const overflow = (stream) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			detachStreamListeners();
			killProcessTree(proc);
			const err = new Error(
				`peer ${peerAgent} ${stream} overflow: exceeded ${PEER_STREAM_MAX_BYTES} bytes`,
			);
			err.duration_ms = Date.now() - started;
			err.stdout_tail = stdout.slice(-400);
			err.stderr_tail = stderr.slice(-400);
			err.transport_descriptor = buildTransportDescriptor(peerAgent);
			err.stream_overflow = {
				stream,
				max_bytes: PEER_STREAM_MAX_BYTES,
				tail: (stream === "stdout" ? stdout : stderr).slice(-400),
			};
			reject(err);
		};

		proc.stdout.on("data", (d) => {
			stdoutBytes += d.length;
			stdout += d.toString("utf8");
			if (stdoutBytes > PEER_STREAM_MAX_BYTES) overflow("stdout");
		});
		proc.stderr.on("data", (d) => {
			stderrBytes += d.length;
			stderr += d.toString("utf8");
			if (stderrBytes > PEER_STREAM_MAX_BYTES) overflow("stderr");
		});
		proc.on("error", (err) => {
			finished = true;
			clearTimeout(timer);
			const wrapped = new Error(`spawn ${cmd} failed: ${err.message}`);
			wrapped.duration_ms = Date.now() - started;
			wrapped.stdout_tail = stdout.slice(-400);
			wrapped.stderr_tail = stderr.slice(-400);
			wrapped.transport_descriptor = buildTransportDescriptor(peerAgent);
			reject(wrapped);
		});
		proc.on("close", (code) => {
			finished = true;
			clearTimeout(timer);
			const descriptor = buildTransportDescriptor(peerAgent);
			const cli_attested_model_raw =
				peerAgent === "codex" || peerAgent === "deepseek"
					? extractCliAttestedModelRaw(stderr)
					: null;
			if (code !== 0) {
				// v0.6.0-alpha / spec v4.9: attach structured rate-limit hint
				// to the rejection error so the ask_peers handler can
				// classify via saveFailedAttempt with failure_class =
				// 'rate_limit_induced_response' + retry_after_seconds.
				const rl = detectSpawnRateLimit(stderr);
				const flagged = detectPromptModerationFlag(stderr);
				const stdoutTail = stdout.slice(-400);
				const stderrTail = stderr.slice(-400);
				const diagnosticTail = stderrTail || stdoutTail;
				const err = new Error(
					`peer ${peerAgent} exit ${code}: ${diagnosticTail}`,
				);
				err.exit_code = code;
				err.stdout_tail = stdoutTail;
				err.stderr_tail = stderrTail;
				err.duration_ms = Date.now() - started;
				err.transport_descriptor = descriptor;
				if (rl) err.spawn_rate_limit = rl;
				if (flagged) err.prompt_flagged = flagged;
				return reject(err);
			}
			// spec v4 section 6.9.2: peer_model must be persisted per
			// round for auditability. Stub path sets it via resolveStub;
			// real path must set it here using the pinned ID for the
			// actual peer agent. Missing peer_model in the real resolve
			// path was a bug flagged by peer review 2026-04-24.
			// v0.6.0-alpha additions: transport_descriptor + cli_attested_model_raw.
			resolve({
				stdout,
				stderr,
				peer_model: modelForPeer(peerAgent),
				transport_descriptor: descriptor,
				cli_attested_model_raw,
			});
		});

		proc.stdin.write(String(prompt));
		proc.stdin.end();
	});
}

// Spawn multiple peers in parallel preserving per-peer partial results
// and explicit agent identity (R12 from F2 round 2: never infer agent
// from array index). Never rejects; each item carries either
// {agent, status: 'fulfilled', value} or {agent, status: 'rejected',
// reason}. `value` is the raw spawnPeer resolution; callers layer the
// statusParser + silent-downgrade check on top.
//
// v1.2.15 / spec §6.22 Item F — round-level timeout.
// `options.roundTimeoutMs` (or env CROSS_REVIEW_ROUND_TIMEOUT_MS, default
// 12min) caps the wall-clock duration of the entire batch. When the round
// timeout fires before all per-peer Promises have settled, this function
// resolves with whatever partial state exists; unresolved peers are
// represented as rejected entries with reason.failure_class='round_timeout'.
// The per-peer timeout (default 30min, also configurable via
// CROSS_REVIEW_PEER_TIMEOUT_MS) remains the primary cap on individual
// peer latency; the round timeout is the backstop when the per-peer
// machinery itself wedges.
function spawnPeers(agents, prompt, options = {}) {
	const roundTimeoutMs = (() => {
		if (
			Number.isInteger(options.roundTimeoutMs) &&
			options.roundTimeoutMs > 0
		) {
			return options.roundTimeoutMs;
		}
		const raw = Number.parseInt(
			process.env.CROSS_REVIEW_ROUND_TIMEOUT_MS || "",
			10,
		);
		if (Number.isInteger(raw) && raw > 0) return raw;
		return 12 * 60 * 1000; // 12 min default
	})();

	const settled = new Map(); // agent -> {status, value|reason}
	const perAgentResolvers = new Map(); // agent -> resolver function

	// v1.2.18 / Finding 1+2: support per-agent prompt overrides so concurrence
	// auto-injection can give each peer ONLY its own prior artifact (not other
	// peers' artifacts). When `options.perAgentPrompts[agent]` is a non-empty
	// string, that string replaces the broadcast `prompt` for that specific
	// agent. Falls back to the broadcast prompt for any agent without an
	// override. Backward-compatible: callers passing only `prompt` still work.
	const perAgentPrompts =
		options.perAgentPrompts && typeof options.perAgentPrompts === "object"
			? options.perAgentPrompts
			: null;

	const tasks = agents.map((a) => {
		return new Promise((resolve) => {
			perAgentResolvers.set(a, resolve);
			const agentPrompt =
				perAgentPrompts &&
				typeof perAgentPrompts[a] === "string" &&
				perAgentPrompts[a].length > 0
					? perAgentPrompts[a]
					: prompt;
			spawnPeer(a, agentPrompt, options).then(
				(value) => {
					if (settled.has(a)) return;
					const entry = { agent: a, status: "fulfilled", value };
					settled.set(a, entry);
					resolve(entry);
				},
				(reason) => {
					if (settled.has(a)) return;
					const entry = { agent: a, status: "rejected", reason };
					settled.set(a, entry);
					resolve(entry);
				},
			);
		});
	});

	const roundTimer = setTimeout(() => {
		// Force-resolve any agent that hasn't reported yet.
		for (const a of agents) {
			if (settled.has(a)) continue;
			const entry = {
				agent: a,
				status: "rejected",
				reason: Object.assign(
					new Error(
						`round timed out after ${Math.round(roundTimeoutMs / 1000)}s before ${a} reported`,
					),
					{
						failure_class: "round_timeout",
						recovery_hint: "retry_round",
						round_timeout_ms: roundTimeoutMs,
					},
				),
			};
			settled.set(a, entry);
			const resolver = perAgentResolvers.get(a);
			if (typeof resolver === "function") resolver(entry);
		}
	}, roundTimeoutMs);
	if (typeof roundTimer.unref === "function") roundTimer.unref();

	return Promise.all(tasks).finally(() => clearTimeout(roundTimer));
}

// v1.2.15 / spec §6.22 Item H — orphan peer-CLI sweep at boot.
//
// When the cross-review-v1 parent process is killed (host reload, crash,
// SIGKILL) BEFORE the per-peer timeout fires, the spawned peer-CLI
// subprocess (codex / gemini / claude exec) becomes an orphan: it
// continues consuming API tokens and CPU until the LLM call finishes,
// with no caller waiting on its output. Recovery is impossible (the pipe
// to the dead parent is broken); the only sensible action is to kill
// the orphan tree.
//
// Detection strategy (Windows + POSIX cross-platform):
//   1. Enumerate processes whose command line contains a peer-spawn
//      argv signature: "codex exec", "gemini -p" / "gemini --prompt",
//      or "claude code".
//   2. For each match, look up its parent PID.
//   3. If parent PID is dead OR alive but is NOT a Node process running
//      cross-review-v1/src/server.js, classify as orphan.
//   4. Kill the orphan + its children via killProcessTree (already
//      taskkill /T /F on Windows, kill -- -<pgid> on POSIX).
//
// Best-effort: errors are logged to stderr but never propagate (boot
// continues). Conservative on ambiguity — if the parent walk fails or
// the subprocess metadata is unreadable, treat as legitimate (operator's
// own usage) and leave alone. The per-peer timeout still bounds future
// orphan windows; this sweep cleans up the historical residue.
//
// Returns Promise<{ scanned, killed }> for telemetry. Async — uses
// non-blocking child_process.exec under the hood so the boot path
// stays responsive while the OS-level enumeration is in flight.
async function sweepOrphanPeerProcesses() {
	const result = { scanned: 0, killed: 0, candidates: [] };
	try {
		const procs = await enumerateProcesses();
		const ourPid = process.pid;
		// v1.2.16: classification core moved to `findOrphans` (pure helper)
		// so smoke can exercise filters with synthetic procs without spawning.
		// `scanned` = procs whose argv[0] basename matched a peer-CLI shape;
		// `findOrphans` filters out our ancestors / descendants / sibling-
		// cross-review-v1 peers. Kill loop only touches the residue.
		for (const p of procs) {
			if (isPeerCliCommand(p.command)) result.scanned += 1;
		}
		const orphans = findOrphans(procs, ourPid);
		for (const o of orphans) {
			try {
				killProcessTree({ pid: o.pid });
				process.stderr.write(
					`[cross-review-v1] orphan-sweep killed peer pid=${o.pid} agent=${o.agent || "unknown"} parent=${o.parentPid}\n`,
				);
				result.killed += 1;
				result.candidates.push({
					pid: o.pid,
					agent: o.agent,
					parent_pid: o.parentPid,
					killed: true,
				});
			} catch (err) {
				process.stderr.write(
					`[cross-review-v1] orphan-sweep failed to kill pid=${o.pid}: ${err?.message || err}\n`,
				);
				result.candidates.push({
					pid: o.pid,
					agent: o.agent,
					parent_pid: o.parentPid,
					killed: false,
					error: err?.message || String(err),
				});
			}
		}
	} catch (err) {
		process.stderr.write(
			`[cross-review-v1] orphan-sweep aborted: ${err?.message || err}\n`,
		);
	}
	return result;
}

// Process enumeration: returns Promise<[{ pid, parentPid, command }]>
// cross-platform. Windows: PowerShell `Get-CimInstance Win32_Process`
// (more reliable than `wmic` which is deprecated). POSIX: `ps -eo
// pid,ppid,args`. Each row has the full command line so callers can
// pattern-match the argv shape. Async via util.promisify(exec) so the
// caller (orphan sweep) doesn't block the Node event loop while the OS
// enumeration is running — critical for not delaying MCP initialize
// handshake responses on host startup.
function enumerateProcesses() {
	const { exec } = require("node:child_process");
	const { promisify } = require("node:util");
	const execP = promisify(exec);
	if (process.platform === "win32") {
		const psCommand =
			"Get-CimInstance Win32_Process | " +
			"Select-Object ProcessId,ParentProcessId,CommandLine | " +
			"ConvertTo-Json -Compress";
		return execP(
			`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`,
			{
				timeout: 8000,
				windowsHide: true,
				maxBuffer: 16 * 1024 * 1024,
			},
		).then(({ stdout }) => {
			const parsed = JSON.parse(stdout);
			const arr = Array.isArray(parsed) ? parsed : [parsed];
			return arr
				.filter((p) => p && Number.isInteger(p.ProcessId))
				.map((p) => ({
					pid: p.ProcessId,
					parentPid: Number.isInteger(p.ParentProcessId)
						? p.ParentProcessId
						: 0,
					command: typeof p.CommandLine === "string" ? p.CommandLine : "",
				}));
		});
	}
	return execP("ps -eo pid,ppid,args", {
		timeout: 4000,
		maxBuffer: 16 * 1024 * 1024,
	}).then(({ stdout }) => {
		const lines = stdout.split("\n").slice(1); // strip header
		const result = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
			if (!m) continue;
			result.push({
				pid: Number.parseInt(m[1], 10),
				parentPid: Number.parseInt(m[2], 10),
				command: m[3],
			});
		}
		return result;
	});
}

// v1.2.16 hotfix: parse a Win32_Process.CommandLine / `ps -eo args` line
// into argv[0]'s basename + the rest of the command line. Pre-v1.2.16,
// `isPeerCliCommand` used `\bclaude\b.*\b(code|--print|-p)\b` against the
// full command line; `\bcode\b` matched the literal substring "code"
// inside every Claude Code install path (`\anthropic.claude-code-X.Y.Z\
// claude.exe`), so the boot orphan sweep classified the host Claude Code
// process as a peer-CLI orphan and SIGKILL-tree'd it — suiciding
// cross-review-v1 itself in the process. Anchoring matches to argv[0]'s
// basename eliminates the substring escape hatch. See spec §6.22.1.
function parseArgv0AndRest(cmdLine) {
	if (typeof cmdLine !== "string" || cmdLine.length === 0) {
		return { argv0Basename: "", rest: "" };
	}
	let argv0;
	let rest;
	if (cmdLine.startsWith('"')) {
		const end = cmdLine.indexOf('"', 1);
		if (end < 0) return { argv0Basename: "", rest: "" };
		argv0 = cmdLine.slice(1, end);
		rest = cmdLine.slice(end + 1);
	} else {
		const sp = cmdLine.search(/\s/);
		if (sp < 0) {
			argv0 = cmdLine;
			rest = "";
		} else {
			argv0 = cmdLine.slice(0, sp);
			rest = cmdLine.slice(sp);
		}
	}
	const baseMatch = argv0.match(/[^\\/]+$/);
	const argv0Basename = (baseMatch ? baseMatch[0] : argv0).toLowerCase();
	return { argv0Basename, rest: rest.toLowerCase() };
}

// Heuristic: argv shape that cross-review-v1 uses for peer-CLI spawns.
// Conservative — argv[0] basename must be the exact peer CLI binary AND
// the argv tail must contain a peer-spawn-only flag.
//
// v1.2.16 hotfix: anchor to argv[0] basename only; remove the `code`
// subcommand alternation from the claude pattern (peer claude uses
// `-p --output-format text ...`, see buildClaudeArgs; `claude code` is
// the *interactive* host invocation, never a peer spawn).
//
// v1.2.17 expansion: accept Windows npm-shim shapes that wrap a peer
// CLI through cmd.exe and/or node.exe. `spawnPeer` runs with
// `shell: true` (per spec §6.21), so on Windows an npm-installed peer
// surfaces as TWO descendant processes:
//   1. cmd.exe /d /s /c "<peer> <args>"           ← shell wrapper
//   2. node.exe "<path>\<peer>.js" <args>         ← actual worker
// `parseArgv0AndRest` extracts `cmd.exe` and `node.exe` as basenames
// for these processes — pre-v1.2.17, both bypassed the strict basename
// check, leaving npm-installed peers uncovered by the orphan sweep
// (gemini R1 catch in retro session `cb41f835`). v1.2.17 adds two
// `argv-tail-recurse` patterns that recognize peer-CLI invocations
// inside cmd.exe / node.exe argv tails. The argv[0] ancestor guard
// in `findOrphans` continues to protect the host (Bug #2 fix is
// independent of this matcher).
function isPeerCliCommand(cmdLine) {
	const { argv0Basename, rest } = parseArgv0AndRest(cmdLine);
	if (!argv0Basename) return false;
	if (
		(argv0Basename === "codex" || argv0Basename === "codex.exe") &&
		/(?:^|\s)exec(?:\s|$)/.test(rest)
	) {
		return true;
	}
	if (
		(argv0Basename === "gemini" || argv0Basename === "gemini.exe") &&
		/(?:^|\s)(-p|--prompt)(?:\s|$)/.test(rest)
	) {
		return true;
	}
	if (
		(argv0Basename === "claude" || argv0Basename === "claude.exe") &&
		/(?:^|\s)(-p|--print)(?:\s|$)/.test(rest)
	) {
		return true;
	}
	// v1.2.17 npm-shim recognition: cmd.exe wrapper invoking a peer CLI.
	// Match shape: `cmd.exe /d /s /c "<peer-name>(.cmd|.exe) ... <peer-flag> ..."`
	// or `cmd.exe /c <peer-name> ... <peer-flag> ...`. The peer name must
	// appear as a token (preceded by whitespace, quote, or slash) and the
	// peer-spawn-only flag must follow somewhere in the same rest string.
	// Flag terminator accepts whitespace, quote, or end-of-string because
	// cmd.exe wrappers commonly close the inner quote right after the flag.
	if (argv0Basename === "cmd.exe" || argv0Basename === "cmd") {
		if (
			/(?:[\s"'\\/]|^)codex(?:\.cmd|\.exe)?(?:[\s"']|$)/.test(rest) &&
			/(?:^|\s)exec(?:[\s"']|$)/.test(rest)
		) {
			return true;
		}
		if (
			/(?:[\s"'\\/]|^)gemini(?:\.cmd|\.exe)?(?:[\s"']|$)/.test(rest) &&
			/(?:^|\s)(-p|--prompt)(?:[\s"']|$)/.test(rest)
		) {
			return true;
		}
		if (
			/(?:[\s"'\\/]|^)claude(?:\.cmd|\.exe)?(?:[\s"']|$)/.test(rest) &&
			/(?:^|\s)(-p|--print)(?:[\s"']|$)/.test(rest)
		) {
			return true;
		}
		if (
			/[\\/]cross-review-v1[\\/]src[\\/]deepseek-cli\.js(?:["']|\s|$)/.test(
				rest,
			) &&
			/(?:^|\s)--reasoning-effort(?:[\s"']|$)/.test(rest)
		) {
			return true;
		}
		return false;
	}
	// v1.2.17 npm-shim recognition: node.exe worker invoking a peer CLI's
	// JavaScript entrypoint. Match shape: `node.exe "<path>\<peer>(-cli)?\
	// (bin\)?<peer>.js" ... <peer-flag> ...`. Restricted to argv1 path
	// components named after a peer (in path segment or basename) so we
	// don't false-positive on arbitrary `node script.js` invocations.
	if (argv0Basename === "node.exe" || argv0Basename === "node") {
		if (
			/[\s"'][^\s"']*[\\/]codex[^\s"']*\.(?:js|cjs|mjs)(?:["']|\s|$)/.test(
				rest,
			) &&
			/(?:^|\s)exec(?:[\s"']|$)/.test(rest)
		) {
			return true;
		}
		if (
			/[\s"'][^\s"']*[\\/]gemini[^\s"']*\.(?:js|cjs|mjs)(?:["']|\s|$)/.test(
				rest,
			) &&
			/(?:^|\s)(-p|--prompt)(?:[\s"']|$)/.test(rest)
		) {
			return true;
		}
		if (
			/[\s"'][^\s"']*[\\/]claude[^\s"']*\.(?:js|cjs|mjs)(?:["']|\s|$)/.test(
				rest,
			) &&
			/(?:^|\s)(-p|--print)(?:[\s"']|$)/.test(rest)
		) {
			return true;
		}
		if (
			/[\s"'][^\s"']*[\\/]cross-review-v1[\\/]src[\\/]deepseek-cli\.js(?:["']|\s|$)/.test(
				rest,
			) &&
			/(?:^|\s)--reasoning-effort(?:[\s"']|$)/.test(rest)
		) {
			return true;
		}
		return false;
	}
	return false;
}

// Walk up the parent chain to determine if `proc` is a descendant of `ancestorPid`.
function isDescendantOfPid(proc, ancestorPid, allProcs, depth = 0) {
	if (depth > 10) return false; // cycle guard
	if (proc.parentPid === ancestorPid) return true;
	if (proc.parentPid === 0 || proc.parentPid === proc.pid) return false;
	const parent = allProcs.find((p) => p.pid === proc.parentPid);
	if (!parent) return false;
	return isDescendantOfPid(parent, ancestorPid, allProcs, depth + 1);
}

// v1.2.16 hotfix: build the set of PIDs that are ancestors of `ofPid`
// (inclusive of `ofPid` itself). Used by `findOrphans` to refuse to ever
// classify an ancestor of cross-review-v1's own process as an orphan,
// independent of the argv-shape match. Defense in depth alongside the
// `isPeerCliCommand` argv[0] tightening.
function ancestorPidSet(ofPid, allProcs) {
	const ancestors = new Set();
	let current = ofPid;
	let depth = 0;
	while (current && depth < 32) {
		ancestors.add(current);
		const node = allProcs.find((p) => p.pid === current);
		if (!node?.parentPid || node.parentPid === current) break;
		current = node.parentPid;
		depth += 1;
	}
	return ancestors;
}

// v1.2.16 hotfix: pure orphan-classification core extracted from
// `sweepOrphanPeerProcesses` so regression smoke can exercise the filter
// against synthetic process trees without spawning real subprocesses.
//
// Filters applied (in order):
//   1. argv[0] basename + flag shape match via `isPeerCliCommand`;
//   2. NEVER classify an ancestor of `ourPid` as orphan (Bug #2 guard);
//   3. NEVER classify a descendant of `ourPid` as orphan (our own child);
//   4. sibling-parent rescue: if parent is a live cross-review-v1 Node
//      process (matches `node ... cross-review-v1/src/server.js`), the
//      peer is being managed by another instance — skip.
function findOrphans(procs, ourPid) {
	const ancestors = ancestorPidSet(ourPid, procs);
	const orphans = [];
	for (const p of procs) {
		if (!isPeerCliCommand(p.command)) continue;
		// (2) ancestor guard. Catches the Claude Code parent case directly,
		// even if a future regex regression re-introduced the false-positive.
		if (ancestors.has(p.pid)) continue;
		// (3) own-descendant skip.
		if (isDescendantOfPid(p, ourPid, procs)) continue;
		// (4) sibling cross-review-v1 parent — leave alone.
		const parent = procs.find((x) => x.pid === p.parentPid);
		if (parent) {
			const parentArgv0 = parent.command.split(/\s+/)[0] || "";
			if (/node(?:\.exe)?$/i.test(parentArgv0)) {
				if (/cross-review-v1[\\/]src[\\/]server\.js/i.test(parent.command)) {
					continue;
				}
			}
		}
		// Optional agent label for logging.
		let agent = null;
		if (/\bcodex\b/i.test(p.command) && /\bexec\b/i.test(p.command))
			agent = "codex";
		else if (/\bgemini\b/i.test(p.command)) agent = "gemini";
		else if (
			/\bclaude\b/i.test(p.command) &&
			/\b(-p|--print)\b/i.test(p.command)
		)
			agent = "claude";
		else if (/[\\/]cross-review-v1[\\/]src[\\/]deepseek-cli\.js/i.test(p.command))
			agent = "deepseek";
		orphans.push({ ...p, agent });
	}
	return orphans;
}

module.exports = {
	spawnPeer,
	spawnPeers,
	probeAgent,
	probeChain,
	killProcessTree,
	extractReportedModel,
	buildCodexArgs,
	buildClaudeArgs,
	buildGeminiArgs,
	buildDeepSeekArgs,
	// v1.4.0 §6.25: Codex sandbox/approval policy is configurable.
	resolveCodexSandboxPolicy,
	logCodexSandboxPolicy,
	CODEX_SANDBOX_VALID,
	CODEX_APPROVAL_VALID,
	CODEX_SANDBOX_DEFAULT,
	CODEX_APPROVAL_DEFAULT,
	_resetCodexSandboxPolicyLogForTests,
	listCodexConfiguredServers,
	loadExclusions,
	// v1.2.15 / spec §6.22 Item H additions.
	sweepOrphanPeerProcesses,
	enumerateProcesses,
	isPeerCliCommand,
	isDescendantOfPid,
	// v1.2.16 / spec §6.22.1 hotfix exports — orphan-sweep correctness.
	parseArgv0AndRest,
	ancestorPidSet,
	findOrphans,
	killProcessTreeIsSuicide,
	// Exported for audit/test use only. Exposes the pinned top-level
	// model IDs per spec section 6.9.2 + 6.9.2.1.
	modelForPeer,
	CODEX_MODEL,
	CODEX_REASONING_EFFORT,
	CLAUDE_MODEL,
	GEMINI_MODEL,
	DEEPSEEK_MODEL,
	DEEPSEEK_REASONING_EFFORT,
	DEEPSEEK_CLI_PATH,
	DEEPSEEK_MCP_JSON,
	GEMINI_ALLOWED_MCP_SERVERS,
	DEEPSEEK_ALLOWED_MCP_SERVERS,
	buildDeepSeekEnv,
	// v0.6.0-alpha / spec v4.9 additions.
	detectGeminiAuth,
	geminiAuthFromSignals,
	buildTransportDescriptor,
	authoritativeModelAttestationAvailable,
	RATE_LIMIT_LEXEMES,
	matchRateLimitLexeme,
	extractRetryAfterSeconds,
	detectSpawnRateLimit,
	extractCliAttestedModelRaw,
	extractCodexAttestedModelRaw,
	// v1.0.5 additions: prompt-moderation flag detection + recovery contract.
	PROMPT_FLAG_LEXEMES,
	matchPromptFlagLexeme,
	detectPromptModerationFlag,
	// v1.2.5 / external-audit round-4 §4.1: per-stream byte cap thresholds.
	PEER_STREAM_MAX_BYTES,
	PROBE_STREAM_MAX_BYTES,
};
