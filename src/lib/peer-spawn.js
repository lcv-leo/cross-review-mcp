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
//   - Forensic-only `cli_attested_model_raw`: extracts the Codex CLI stderr
//     banner line `model: <id>` (unparsed, non-authoritative). CLI banner as
//     authoritative attestation is DEFERRED to v0.7+.
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
// Model change requires explicit spec/config bump/edit; no silent fallback.
// `spawnPeer` returns `peer_model` for persistence in
// meta.json.rounds[i].peer_model, meeting the normative auditability
// requirement.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIGS_DIR = path.resolve(__dirname, '..', '..', 'reviewer-configs');
const EXCLUSIONS_PATH = path.join(CONFIGS_DIR, 'peer-exclusions.json');
const REVIEWER_MCP_JSON = path.join(CONFIGS_DIR, 'reviewer-minimal.mcp.json');

// Normative IDs for v0.5.0-alpha (spec v4 section 6.9.2, extended by v4.7
// triangular + v4.8 resilience).
const CODEX_MODEL = 'gpt-5.5';
const CODEX_REASONING_EFFORT = 'xhigh';
const CLAUDE_MODEL = 'claude-opus-4-7';
const GEMINI_MODEL = 'gemini-3.1-pro-preview';

// Gemini peer containment: allowlist of MCP servers the peer may use while
// analyzing. Deliberately excludes cross-review-mcp to prevent recursion
// (spec v4 section 6.9.2). Includes the canonical reasoning stack so the
// peer can honor the tri-tool mandate (spec v4 section 6.2 per
// feedback_tri_tool_cross_review).
const GEMINI_ALLOWED_MCP_SERVERS = ['memory', 'ultrathink', 'code-reasoning'];

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
function geminiAuthFromSignals({ settingsSelectedType, hasApiKeyEnv, hasOauthCreds }) {
    if (settingsSelectedType === 'oauth-personal') return 'oauth-personal';
    if (settingsSelectedType === 'api-key' || settingsSelectedType === 'gemini-api-key') {
        return 'api-key';
    }
    // settingsSelectedType absent, null, or unrecognized → fall through to
    // env + fs signals.
    if (hasApiKeyEnv) return 'api-key';
    if (hasOauthCreds) return 'oauth-personal';
    return 'oauth-personal';
}

// Production wrapper: reads fs + env, delegates the pure decision.
function detectGeminiAuth() {
    const home = os.homedir() || '';
    let settingsSelectedType = null;
    if (home) {
        const settingsPath = path.join(home, '.gemini', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            try {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                settingsSelectedType = settings?.security?.auth?.selectedType ?? null;
            } catch {
                // Malformed settings.json: fall through to env + fs signals.
                settingsSelectedType = null;
            }
        }
    }
    const hasApiKeyEnv = Boolean(process.env.GEMINI_API_KEY);
    const hasOauthCreds = Boolean(
        home && fs.existsSync(path.join(home, '.gemini', 'oauth_creds.json'))
    );
    return geminiAuthFromSignals({ settingsSelectedType, hasApiKeyEnv, hasOauthCreds });
}

// Build a transport descriptor for the peer. The `auth` field gates the
// Item A model-check bypass in parsePeerOutputs: only 'api-key' exposes an
// authoritative modelVersion; cli-subscription / oauth-personal do not.
function buildTransportDescriptor(agent) {
    if (agent === 'codex') {
        return {
            agent: 'codex',
            auth: 'cli-subscription',
            endpoint_class: 'chatgpt-pro-backend',
        };
    }
    if (agent === 'claude') {
        return {
            agent: 'claude',
            auth: 'cli-subscription',
            endpoint_class: 'claude-pro-backend',
        };
    }
    if (agent === 'gemini') {
        const auth = detectGeminiAuth();
        return {
            agent: 'gemini',
            auth,
            endpoint_class: auth === 'api-key' ? 'generativelanguage-v1beta' : 'v1internal',
        };
    }
    return { agent: String(agent), auth: 'unknown', endpoint_class: 'unknown' };
}

// Gate: Item A bypass applies whenever the transport does NOT expose an
// authoritative modelVersion attestation (anything except api-key SDK path).
function authoritativeModelAttestationAvailable(descriptor) {
    return descriptor?.auth === 'api-key';
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

const RATE_LIMIT_LEXEMES = Object.freeze([
    '429',
    'rate limit',
    'usage limit',
    'quota exceeded',
    'insufficient_quota',
    'RESOURCE_EXHAUSTED',
    'Retry-After',
]);

function matchRateLimitLexeme(text) {
    if (typeof text !== 'string' || !text.length) return null;
    const lower = text.toLowerCase();
    for (const lex of RATE_LIMIT_LEXEMES) {
        if (lower.includes(lex.toLowerCase())) return lex;
    }
    return null;
}

function extractRetryAfterSeconds(text) {
    if (typeof text !== 'string') return null;
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
        detection_source: 'spawn',
        retry_after_seconds: extractRetryAfterSeconds(stderr),
        lexeme_matched: lexeme,
    };
}

// Provider-shaped moderation-flag lexemes. Distinct from rate-limit because
// the recovery is "reformulate the prompt and retry", not "wait and retry".
// OpenAI Codex CLI emits these on reasoning-model moderation rejections.
const PROMPT_FLAG_LEXEMES = Object.freeze([
    'your prompt was flagged as potentially violating',
    'flagged as potentially violating our usage policy',
    'invalid prompt: your prompt was flagged',
]);

function matchPromptFlagLexeme(text) {
    if (typeof text !== 'string' || !text.length) return null;
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
        detection_source: 'spawn',
        lexeme_matched: lexeme,
        docs_url: 'https://platform.openai.com/docs/guides/reasoning#advice-on-prompting',
    };
}

// Forensic-only (v0.6.0-alpha): extract Codex CLI stderr banner line
// `model: <id>`. Unparsed beyond the trim; non-authoritative. CLI banner as
// authoritative attestation is deferred to v0.7+.
function extractCodexAttestedModelRaw(stderr) {
    if (typeof stderr !== 'string' || !stderr.length) return null;
    const m = stderr.match(/^model:\s*(\S[^\r\n]*)/m);
    return m ? m[1].trim() : null;
}

function loadExclusions() {
    return JSON.parse(fs.readFileSync(EXCLUSIONS_PATH, 'utf8'));
}

function listCodexConfiguredServers() {
    const configPath = path.join(
        process.env.USERPROFILE || process.env.HOME || '',
        '.codex',
        'config.toml'
    );
    if (!fs.existsSync(configPath)) return [];
    const content = fs.readFileSync(configPath, 'utf8');
    const names = new Set();
    const re = /^\[mcp_servers\.([^\].]+)\]/gm;
    for (;;) {
        const m = re.exec(content);
        if (m === null) break;
        names.add(m[1]);
    }
    return [...names];
}

function buildCodexArgs() {
    const ex = loadExclusions();
    const configured = listCodexConfiguredServers();

    // Intersection: only override mcp_servers.* if it exists in config.toml,
    // otherwise the CLI yields "invalid transport".
    const effectiveDisable = (ex.codex_disable || []).filter((n) =>
        configured.includes(n)
    );
    const disableArgs = effectiveDisable.flatMap((n) => [
        '-c',
        `mcp_servers.${n}.enabled=false`,
    ]);

    const appsDisableArgs = (ex.codex_apps_disable || []).flatMap((id) => [
        '-c',
        `apps.${id}.enabled=false`,
    ]);

    const approveArgs = (ex.codex_approve_tools || []).flatMap(
        ({ server, tool }) => [
            '-c',
            `mcp_servers.${server}.tools.${tool}.approval_mode=approve`,
        ]
    );

    return [
        '-a',
        'never',
        '-s',
        'read-only',
        '-m',
        CODEX_MODEL,
        '-c',
        `model_reasoning_effort=${CODEX_REASONING_EFFORT}`,
        'exec',
        '--skip-git-repo-check',
        ...disableArgs,
        ...appsDisableArgs,
        ...approveArgs,
        '-',
    ];
}

function buildClaudeArgs() {
    return [
        '-p',
        '--output-format',
        'text',
        '--model',
        CLAUDE_MODEL,
        '--permission-mode',
        'default',
        '--strict-mcp-config',
        '--mcp-config',
        REVIEWER_MCP_JSON,
        '--disallowed-tools',
        'Write,Edit,NotebookEdit',
    ];
}

function buildGeminiArgs() {
    const allowArgs = GEMINI_ALLOWED_MCP_SERVERS.flatMap((name) => [
        '--allowed-mcp-server-names',
        name,
    ]);
    return [
        '-m',
        GEMINI_MODEL,
        '-p',
        ' ',
        '--approval-mode',
        'plan',
        '--output-format',
        'text',
        ...allowArgs,
    ];
}

function modelForPeer(peerAgent) {
    if (peerAgent === 'codex') return CODEX_MODEL;
    if (peerAgent === 'claude') return CLAUDE_MODEL;
    if (peerAgent === 'gemini') return GEMINI_MODEL;
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
function killProcessTree(proc) {
    // R2 gemini ask: also guard !proc.pid (executable failed to spawn → pid undefined).
    if (!proc || !proc.pid || proc.killed || proc.exitCode != null || proc.signalCode != null) return;
    if (process.platform === 'win32') {
        let killer;
        try {
            killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (err) {
            // taskkill itself unavailable on PATH. Fall back to direct kill,
            // log the cleanup-tooling problem so the operator can investigate.
            process.stderr.write(
                `[cross-review-mcp] taskkill spawn error PID=${proc.pid}: ${err.message}; falling back to proc.kill\n`
            );
            try { proc.kill('SIGKILL'); } catch {}
            return;
        }
        let stderrTail = '';
        killer.stderr.on('data', (d) => {
            stderrTail += d.toString('utf8');
            // Inline cap matches session-store.MAX_STDERR_TAIL_CHARS (2000).
            // Inlined to avoid a circular import between peer-spawn and
            // session-store; the constant is documented in session-store.js.
            if (stderrTail.length > 2000) {
                stderrTail = stderrTail.slice(-2000);
            }
        });
        killer.on('close', (code) => {
            if (code !== 0) {
                process.stderr.write(
                    `[cross-review-mcp] taskkill PID=${proc.pid} exit=${code}: ${stderrTail.slice(-400)}\n`
                );
            }
        });
        killer.on('error', (err) => {
            process.stderr.write(
                `[cross-review-mcp] taskkill PID=${proc.pid} runtime error: ${err.message}\n`
            );
        });
        return;
    }
    // POSIX: direct PID kill. The previous group-kill (-pid) attempt was
    // dead code because non-detached children aren't process group leaders,
    // so kill(-pid) always threw ESRCH and the swallowing catch returned
    // before the fallback fired (gemini R2 catch).
    try {
        process.kill(proc.pid, 'SIGKILL');
    } catch (err) {
        // ESRCH = already dead, success-when-already-dead. Other errors
        // are unexpected and worth surfacing.
        if (err.code !== 'ESRCH') {
            process.stderr.write(`[cross-review-mcp] kill PID=${proc.pid}: ${err.message}\n`);
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
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
        .map((e) => e.split(':'));
    for (const parts of entries) {
        const [a, tier, model] = parts;
        if (a !== agent) continue;
        if (!['top', 'fallback', 'excluded', 'ok', 'offline'].includes(tier)) {
            return null;
        }
        const offline = tier === 'excluded' || tier === 'offline';
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
            failure_class: offline ? 'probe_excluded_stub' : null,
            cli_version: null,
            timestamp: new Date().toISOString(),
            stderr_tail: '',
            transport_descriptor: descriptor,
            model_check_skipped: (!offline && !attested) ? {
                reason: 'unreliable_text_self_report_on_cli',
                auth: descriptor.auth,
                endpoint_class: descriptor.endpoint_class,
            } : null,
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
        'Identify your exact model id in one short line, then stop. ' +
        'No other output needed.';

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
            if (agent === 'codex') {
                cmd = 'codex';
                args = buildCodexArgs();
            } else if (agent === 'claude') {
                cmd = 'claude';
                args = buildClaudeArgs();
            } else if (agent === 'gemini') {
                cmd = 'gemini';
                args = buildGeminiArgs();
            } else {
                return finish({
                    agent,
                    tier: 'excluded',
                    requested_model: null,
                    model_reported: null,
                    model_match: false,
                    probe_latency_ms: 0,
                    probe_budget_ms: budgetMs,
                    exit_code: -1,
                    failure_class: 'unknown_agent',
                    cli_version: null,
                    timestamp: new Date().toISOString(),
                    stderr_tail: '',
                });
            }
            const cmdLine = buildCommandLine(cmd, args);
            proc = spawn(cmdLine, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,
                windowsHide: true,
            });
        } catch (err) {
            return finish({
                agent,
                tier: 'offline',
                requested_model: requested,
                model_reported: null,
                model_match: false,
                probe_latency_ms: Date.now() - started,
                probe_budget_ms: budgetMs,
                exit_code: -1,
                failure_class: 'spawn_error',
                cli_version: null,
                timestamp: new Date().toISOString(),
                stderr_tail: String(err?.message || err).slice(-400),
                transport_descriptor: buildTransportDescriptor(agent),
                model_check_skipped: null,
                cli_attested_model_raw: null,
            });
        }

        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            killProcessTree(proc);
            finish({
                agent,
                tier: 'offline',
                requested_model: requested,
                model_reported: null,
                model_match: false,
                probe_latency_ms: Date.now() - started,
                probe_budget_ms: budgetMs,
                exit_code: -1,
                failure_class: 'probe_timeout',
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
            killProcessTree(proc);
            finish({
                agent,
                tier: 'offline',
                requested_model: requested,
                model_reported: null,
                model_match: false,
                probe_latency_ms: Date.now() - started,
                probe_budget_ms: budgetMs,
                exit_code: -1,
                failure_class: 'probe_stream_overflow',
                cli_version: null,
                timestamp: new Date().toISOString(),
                stderr_tail: (stream === 'stderr' ? stderr : stderr).slice(-400),
                transport_descriptor: buildTransportDescriptor(agent),
                model_check_skipped: null,
                cli_attested_model_raw: null,
                stream_overflow: { stream, max_bytes: PROBE_STREAM_MAX_BYTES },
            });
        };
        proc.stdout.on('data', (d) => {
            stdoutBytes += d.length;
            stdout += d.toString('utf8');
            if (stdoutBytes > PROBE_STREAM_MAX_BYTES) probeOverflow('stdout');
        });
        proc.stderr.on('data', (d) => {
            stderrBytes += d.length;
            stderr += d.toString('utf8');
            if (stderrBytes > PROBE_STREAM_MAX_BYTES) probeOverflow('stderr');
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            finish({
                agent,
                tier: 'offline',
                requested_model: requested,
                model_reported: null,
                model_match: false,
                probe_latency_ms: Date.now() - started,
                probe_budget_ms: budgetMs,
                exit_code: -1,
                failure_class: 'spawn_error',
                cli_version: null,
                timestamp: new Date().toISOString(),
                stderr_tail: String(err?.message || err).slice(-400),
                transport_descriptor: buildTransportDescriptor(agent),
                model_check_skipped: null,
                cli_attested_model_raw: null,
            });
        });
        proc.on('close', (code) => {
            clearTimeout(timer);
            const latency = Date.now() - started;
            const stderrTail = stderr.slice(-400);
            const descriptor = buildTransportDescriptor(agent);
            const cli_attested_model_raw = agent === 'codex'
                ? extractCodexAttestedModelRaw(stderr)
                : null;

            // Non-zero exit: classify. Spawn-level rate-limit takes
            // precedence over generic probe_nonzero_exit.
            if (code !== 0) {
                const rl = detectSpawnRateLimit(stderrTail);
                return finish({
                    agent,
                    tier: 'offline',
                    requested_model: requested,
                    model_reported: null,
                    model_match: false,
                    probe_latency_ms: latency,
                    probe_budget_ms: budgetMs,
                    exit_code: code,
                    failure_class: rl ? 'rate_limit_induced_response' : 'probe_nonzero_exit',
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
            const reported = extractReportedModel(stdout);
            const attested = authoritativeModelAttestationAvailable(descriptor);

            if (attested) {
                const match = reported != null && reported === requested;
                return finish({
                    agent,
                    tier: match ? 'ok' : 'offline',
                    requested_model: requested,
                    model_reported: reported,
                    model_match: match,
                    probe_latency_ms: latency,
                    probe_budget_ms: budgetMs,
                    exit_code: code,
                    failure_class: match
                        ? null
                        : (reported ? 'silent_model_downgrade' : 'probe_no_model_report'),
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
                tier: 'ok',
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
                    reason: 'unreliable_text_self_report_on_cli',
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
        const tokens = candidate.split(/\s+/).map((t) => t.replace(/[.,;:!?]+$/, ''));
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
            if (r.status === 'fulfilled') return r.value;
            return {
                agent: agents[i],
                tier: 'offline',
                requested_model: null,
                model_reported: null,
                model_match: false,
                probe_latency_ms: 0,
                probe_budget_ms: options.budgetMs ?? 30 * 1000,
                exit_code: -1,
                failure_class: 'probe_rejected',
                cli_version: null,
                timestamp: new Date().toISOString(),
                stderr_tail: String(r.reason?.message || r.reason).slice(-400),
                transport_descriptor: buildTransportDescriptor(agents[i]),
                model_check_skipped: null,
                cli_attested_model_raw: null,
            };
        })
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
const LEGACY_STATUSES = new Set(['READY', 'NOT_READY', 'NEEDS_EVIDENCE']);

function assertLegacy(status, label) {
    if (!LEGACY_STATUSES.has(status)) {
        throw new Error(
            `stub: invalid status '${status}' for ${label} (need one of {READY,NOT_READY,NEEDS_EVIDENCE})`
        );
    }
}

function resolveStub(stub) {
    const body = `[stub peer response; CROSS_REVIEW_PEER_STUB=${stub}]`;
    const stderr = '[stub] peer spawn skipped\n';
    const peer_model = 'stub';
    // Stubs bypass the model-check entirely via peer_model==='stub' — the
    // isStub short-circuit in parsePeerOutputs fires first. For the REAL_*
    // stubs that DO exercise the model-check defense end-to-end (REAL_MATCH /
    // REAL_DOWNGRADE / REAL_MISSING_MODEL return a real `peer_model`), we set
    // auth='api-key' so the v4.9 transport-aware bypass does NOT skip the
    // check — the defense must still fire in those tests. Coverage of the
    // v4.9 bypass behavior lives in dedicated unit steps that call
    // parsePeerOutputs directly with a non-api-key descriptor.
    const transport_descriptor = { agent: 'stub', auth: 'api-key', endpoint_class: 'stub' };
    const cli_attested_model_raw = null;

    if (stub === 'MISSING') {
        return { stdout: `${body}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (LEGACY_STATUSES.has(stub)) {
        return { stdout: `${body}\n\nSTATUS: ${stub}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub.startsWith('STRUCTURED:')) {
        const status = stub.slice('STRUCTURED:'.length);
        assertLegacy(status, 'STRUCTURED');
        const block = `<cross_review_status>${JSON.stringify({ status })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub.startsWith('STRUCTURED_EARLY_REGEX_LAST:')) {
        const rest = stub.slice('STRUCTURED_EARLY_REGEX_LAST:'.length);
        const [structured, regex] = rest.split(':');
        assertLegacy(structured, 'STRUCTURED_EARLY_REGEX_LAST structured');
        assertLegacy(regex, 'STRUCTURED_EARLY_REGEX_LAST regex');
        const block = `<cross_review_status>${JSON.stringify({ status: structured })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n\nmore prose here\n\nSTATUS: ${regex}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub.startsWith('STRUCTURED_LAST_REGEX_EARLY:')) {
        const rest = stub.slice('STRUCTURED_LAST_REGEX_EARLY:'.length);
        const [regex, structured] = rest.split(':');
        assertLegacy(regex, 'STRUCTURED_LAST_REGEX_EARLY regex');
        assertLegacy(structured, 'STRUCTURED_LAST_REGEX_EARLY structured');
        const block = `<cross_review_status>${JSON.stringify({ status: structured })}</cross_review_status>`;
        return { stdout: `${body}\n\nSTATUS: ${regex}\n\nmore prose here\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'MALFORMED_STRUCTURED_TAIL') {
        const malformedBlock = '<cross_review_status>{not valid json</cross_review_status>';
        return { stdout: `${body}\n\n${malformedBlock}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'INVALID_STATUS_STRUCTURED_TAIL') {
        const block = `<cross_review_status>${JSON.stringify({ status: 'MAYBE' })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'LOWERCASE_STATUS') {
        return { stdout: `${body}\n\nSTATUS: ready\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'PROSE_MENTION_STATUS') {
        return { stdout: `${body}\n\nFor example, the peer could write \`STATUS: READY\` at the end.\n\nBut this response is not ended with the canonical marker.\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'PROSE_MENTION_BLOCK') {
        return { stdout: `${body}\n\nExample of the canonical tag: <cross_review_status>{"status":"READY"}</cross_review_status>\n\nThis response ends with prose and does not terminate with the canonical tag.\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub.startsWith('DOUBLE_STRUCTURED:')) {
        const rest = stub.slice('DOUBLE_STRUCTURED:'.length);
        const [early, last] = rest.split(':');
        assertLegacy(early, 'DOUBLE_STRUCTURED early');
        assertLegacy(last, 'DOUBLE_STRUCTURED last');
        const b1 = `<cross_review_status>${JSON.stringify({ status: early })}</cross_review_status>`;
        const b2 = `<cross_review_status>${JSON.stringify({ status: last })}</cross_review_status>`;
        return { stdout: `${body}\n\n${b1}\n\nintermediate prose\n\n${b2}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub.startsWith('MULTILINE_STRUCTURED:')) {
        const status = stub.slice('MULTILINE_STRUCTURED:'.length);
        assertLegacy(status, 'MULTILINE_STRUCTURED');
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
    if (stub === 'STRUCTURED_V4_FULL') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'READY',
            uncertainty: 'low',
            caller_requests: ['verify X', 'confirm Y'],
            follow_ups: ['cleanup Z in future session'],
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'STRUCTURED_V4_BAD_UNCERTAINTY') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'READY',
            uncertainty: 'super-high',
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'STRUCTURED_V4_BAD_CALLER_REQUESTS_SHAPE') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'NEEDS_EVIDENCE',
            caller_requests: 'this should be an array',
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'STRUCTURED_V4_NON_STRING_ITEM') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'READY',
            follow_ups: ['ok', 123, 'also ok'],
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'STRUCTURED_V4_TOO_MANY_CALLER_REQUESTS') {
        const requests = Array.from({ length: 21 }, (_, i) => `req ${i + 1}`);
        const block = `<cross_review_status>${JSON.stringify({
            status: 'NEEDS_EVIDENCE',
            caller_requests: requests,
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'STRUCTURED_V4_OVERSIZED_ITEM') {
        const bigString = 'x'.repeat(501);
        const block = `<cross_review_status>${JSON.stringify({
            status: 'NEEDS_EVIDENCE',
            caller_requests: ['ok', bigString],
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'STRUCTURED_V4_UNKNOWN_FIELD') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'READY',
            extra: 'not in whitelist',
            another_unknown: 42,
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    if (stub === 'STRUCTURED_V4_EMPTY_ARRAYS') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'READY',
            caller_requests: [],
            follow_ups: [],
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    // v0.5.0-alpha stubs for server-level model-check (W8). Unlike the
    // other stubs that all return peer_model='stub' to bypass the
    // model-check entirely, these return a REAL-looking peer_model so
    // the server activates parseDeclaredModel + classifyModelMatch.
    // Used by smoke tests to exercise the silent-downgrade defense
    // end-to-end via the MCP surface.
    if (stub.startsWith('REAL_MATCH:')) {
        // REAL_MATCH:<model_id>:<status>
        const parts = stub.split(':');
        const modelId = parts[1];
        const status = parts[2];
        assertLegacy(status, 'REAL_MATCH');
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
    if (stub.startsWith('REAL_DOWNGRADE:')) {
        // REAL_DOWNGRADE:<requested>:<reported>:<status>
        const parts = stub.split(':');
        const requested = parts[1];
        const reported = parts[2];
        const status = parts[3];
        assertLegacy(status, 'REAL_DOWNGRADE');
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
    if (stub.startsWith('REAL_MISSING_MODEL:')) {
        // REAL_MISSING_MODEL:<requested>:<status>
        const parts = stub.split(':');
        const requested = parts[1];
        const status = parts[2];
        assertLegacy(status, 'REAL_MISSING_MODEL');
        const statusBlock = `<cross_review_status>${JSON.stringify({ status })}</cross_review_status>`;
        return {
            stdout: `${body}\n\n${statusBlock}\n`,
            stderr,
            peer_model: requested,
            transport_descriptor,
            cli_attested_model_raw,
        };
    }
    if (stub === 'STRUCTURED_OPEN_NO_CLOSE') {
        // Open tag present but no close tag. Tail does not end with close,
        // falls through to tryLegacyLastLine; without a canonical
        // "STATUS: X" on the last line, returns null (protocol_violation
        // expected).
        const fakeOpen = '<cross_review_status>{"status":"READY"}';
        return { stdout: `${body}\n\n${fakeOpen}\n\nprose after the unclosed opening.\n`, stderr, peer_model, transport_descriptor, cli_attested_model_raw };
    }
    throw new Error(`stub: unknown CROSS_REVIEW_PEER_STUB form '${stub}'`);
}

function peerStub() {
    const stub = process.env.CROSS_REVIEW_PEER_STUB;
    if (!stub) return null;
    if (stub === 'ERROR') {
        return Promise.reject(new Error('stub: simulated peer failure'));
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
        return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    };
    return [quote(cmd), ...args.map(quote)].join(' ');
}

function spawnPeer(peerAgent, prompt, options = {}) {
    const stubbed = peerStub();
    if (stubbed) return stubbed;

    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000; // 30 min
    let cmd;
    let args;
    if (peerAgent === 'codex') {
        cmd = 'codex';
        args = buildCodexArgs();
    } else if (peerAgent === 'claude') {
        cmd = 'claude';
        args = buildClaudeArgs();
    } else if (peerAgent === 'gemini') {
        cmd = 'gemini';
        args = buildGeminiArgs();
    } else {
        return Promise.reject(
            new Error(`spawnPeer: unknown peer agent '${peerAgent}'`)
        );
    }
    const cmdLine = buildCommandLine(cmd, args);

    return new Promise((resolve, reject) => {
        const proc = spawn(cmdLine, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
        });
        let stdout = '';
        let stderr = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let finished = false;

        const timer = setTimeout(() => {
            if (finished) return;
            killProcessTree(proc);
            reject(new Error(`peer ${peerAgent} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        // v1.2.5 / external-audit round-4 §4.1: per-stream byte cap.
        // Bounds RAM accumulation independently of the disk cap (F8 in
        // v1.2.4). On overflow: kill the process tree + reject with a
        // structured `err.stream_overflow = { stream, max_bytes, tail }`
        // so the server.js handler can classify failure_class='stream_overflow'.
        const overflow = (stream) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            killProcessTree(proc);
            const err = new Error(
                `peer ${peerAgent} ${stream} overflow: exceeded ${PEER_STREAM_MAX_BYTES} bytes`
            );
            err.stream_overflow = {
                stream,
                max_bytes: PEER_STREAM_MAX_BYTES,
                tail: (stream === 'stdout' ? stdout : stderr).slice(-400),
            };
            reject(err);
        };

        proc.stdout.on('data', (d) => {
            stdoutBytes += d.length;
            stdout += d.toString('utf8');
            if (stdoutBytes > PEER_STREAM_MAX_BYTES) overflow('stdout');
        });
        proc.stderr.on('data', (d) => {
            stderrBytes += d.length;
            stderr += d.toString('utf8');
            if (stderrBytes > PEER_STREAM_MAX_BYTES) overflow('stderr');
        });
        proc.on('error', (err) => {
            finished = true;
            clearTimeout(timer);
            reject(new Error(`spawn ${cmd} failed: ${err.message}`));
        });
        proc.on('close', (code) => {
            finished = true;
            clearTimeout(timer);
            const descriptor = buildTransportDescriptor(peerAgent);
            const cli_attested_model_raw = peerAgent === 'codex'
                ? extractCodexAttestedModelRaw(stderr)
                : null;
            if (code !== 0) {
                // v0.6.0-alpha / spec v4.9: attach structured rate-limit hint
                // to the rejection error so the ask_peers handler can
                // classify via saveFailedAttempt with failure_class =
                // 'rate_limit_induced_response' + retry_after_seconds.
                const rl = detectSpawnRateLimit(stderr);
                const flagged = detectPromptModerationFlag(stderr);
                const err = new Error(
                    `peer ${peerAgent} exit ${code}: ${stderr.slice(-400)}`
                );
                err.exit_code = code;
                err.stderr_tail = stderr.slice(-400);
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
function spawnPeers(agents, prompt, options = {}) {
    const tasks = agents.map((a) =>
        spawnPeer(a, prompt, options).then(
            (value) => ({ agent: a, status: 'fulfilled', value }),
            (reason) => ({ agent: a, status: 'rejected', reason })
        )
    );
    return Promise.all(tasks);
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
    listCodexConfiguredServers,
    loadExclusions,
    // Exported for audit/test use only. Exposes the pinned top-level
    // model IDs per spec section 6.9.2 + 6.9.2.1.
    modelForPeer,
    CODEX_MODEL,
    CODEX_REASONING_EFFORT,
    CLAUDE_MODEL,
    GEMINI_MODEL,
    GEMINI_ALLOWED_MCP_SERVERS,
    // v0.6.0-alpha / spec v4.9 additions.
    detectGeminiAuth,
    geminiAuthFromSignals,
    buildTransportDescriptor,
    authoritativeModelAttestationAvailable,
    RATE_LIMIT_LEXEMES,
    matchRateLimitLexeme,
    extractRetryAfterSeconds,
    detectSpawnRateLimit,
    extractCodexAttestedModelRaw,
    // v1.0.5 additions: prompt-moderation flag detection + recovery contract.
    PROMPT_FLAG_LEXEMES,
    matchPromptFlagLexeme,
    detectPromptModerationFlag,
    // v1.2.5 / external-audit round-4 §4.1: per-stream byte cap thresholds.
    PEER_STREAM_MAX_BYTES,
    PROBE_STREAM_MAX_BYTES,
};
