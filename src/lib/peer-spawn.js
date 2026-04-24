// Spawn of the peer CLI with the definitive flag tree from the canonical
// README.
// - Codex: -a never -s read-only + mcp_servers.*.enabled=false (intersected
//   with configured) + apps.*.enabled=false + approval_mode=approve for
//   essential read-only tools + recursion prevented (cross-review stays
//   disabled if configured in config.toml).
// - Claude: --permission-mode default + --strict-mcp-config + minimal MCP +
//   write/edit tools disabled.
//
// Since v0.4.0-alpha (spec v4 section 6.9.2), both paths pass an EXPLICIT
// model flag targeting the top-tier model available in the user's
// subscription -- never rely on CLI defaults (which may regress to smaller
// variants in future releases). IDs pinned in v0.4.0:
//   - Codex: model `gpt-5.5` + reasoning_effort `xhigh` (via -c override,
//            equivalent to a dedicated high-reasoning flag where available).
//   - Claude: model `claude-opus-4-7` (full ID, not an alias, for
//             auditability).
// Model change requires explicit spec/config bump/edit; no silent fallback.
// `spawnPeer` returns `peer_model` for persistence in
// meta.json.rounds[i].peer_model, meeting the normative auditability
// requirement.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIGS_DIR = path.resolve(__dirname, '..', '..', 'reviewer-configs');
const EXCLUSIONS_PATH = path.join(CONFIGS_DIR, 'peer-exclusions.json');
const REVIEWER_MCP_JSON = path.join(CONFIGS_DIR, 'reviewer-minimal.mcp.json');

// Normative IDs for v0.4.0 (spec v4 section 6.9.2).
const CODEX_MODEL = 'gpt-5.5';
const CODEX_REASONING_EFFORT = 'xhigh';
const CLAUDE_MODEL = 'claude-opus-4-7';

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
    let m;
    while ((m = re.exec(content)) !== null) names.add(m[1]);
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

function modelForPeer(peerAgent) {
    return peerAgent === 'codex' ? CODEX_MODEL : CLAUDE_MODEL;
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

    if (stub === 'MISSING') {
        return { stdout: body + '\n', stderr, peer_model };
    }
    if (LEGACY_STATUSES.has(stub)) {
        return { stdout: `${body}\n\nSTATUS: ${stub}\n`, stderr, peer_model };
    }
    if (stub.startsWith('STRUCTURED:')) {
        const status = stub.slice('STRUCTURED:'.length);
        assertLegacy(status, 'STRUCTURED');
        const block = `<cross_review_status>${JSON.stringify({ status })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub.startsWith('STRUCTURED_EARLY_REGEX_LAST:')) {
        const rest = stub.slice('STRUCTURED_EARLY_REGEX_LAST:'.length);
        const [structured, regex] = rest.split(':');
        assertLegacy(structured, 'STRUCTURED_EARLY_REGEX_LAST structured');
        assertLegacy(regex, 'STRUCTURED_EARLY_REGEX_LAST regex');
        const block = `<cross_review_status>${JSON.stringify({ status: structured })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n\nmore prose here\n\nSTATUS: ${regex}\n`, stderr, peer_model };
    }
    if (stub.startsWith('STRUCTURED_LAST_REGEX_EARLY:')) {
        const rest = stub.slice('STRUCTURED_LAST_REGEX_EARLY:'.length);
        const [regex, structured] = rest.split(':');
        assertLegacy(regex, 'STRUCTURED_LAST_REGEX_EARLY regex');
        assertLegacy(structured, 'STRUCTURED_LAST_REGEX_EARLY structured');
        const block = `<cross_review_status>${JSON.stringify({ status: structured })}</cross_review_status>`;
        return { stdout: `${body}\n\nSTATUS: ${regex}\n\nmore prose here\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'MALFORMED_STRUCTURED_TAIL') {
        const malformedBlock = '<cross_review_status>{not valid json</cross_review_status>';
        return { stdout: `${body}\n\n${malformedBlock}\n`, stderr, peer_model };
    }
    if (stub === 'INVALID_STATUS_STRUCTURED_TAIL') {
        const block = `<cross_review_status>${JSON.stringify({ status: 'MAYBE' })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'LOWERCASE_STATUS') {
        return { stdout: `${body}\n\nSTATUS: ready\n`, stderr, peer_model };
    }
    if (stub === 'PROSE_MENTION_STATUS') {
        return { stdout: `${body}\n\nFor example, the peer could write \`STATUS: READY\` at the end.\n\nBut this response is not ended with the canonical marker.\n`, stderr, peer_model };
    }
    if (stub === 'PROSE_MENTION_BLOCK') {
        return { stdout: `${body}\n\nExample of the canonical tag: <cross_review_status>{"status":"READY"}</cross_review_status>\n\nThis response ends with prose and does not terminate with the canonical tag.\n`, stderr, peer_model };
    }
    if (stub.startsWith('DOUBLE_STRUCTURED:')) {
        const rest = stub.slice('DOUBLE_STRUCTURED:'.length);
        const [early, last] = rest.split(':');
        assertLegacy(early, 'DOUBLE_STRUCTURED early');
        assertLegacy(last, 'DOUBLE_STRUCTURED last');
        const b1 = `<cross_review_status>${JSON.stringify({ status: early })}</cross_review_status>`;
        const b2 = `<cross_review_status>${JSON.stringify({ status: last })}</cross_review_status>`;
        return { stdout: `${body}\n\n${b1}\n\nintermediate prose\n\n${b2}\n`, stderr, peer_model };
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
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'STRUCTURED_V4_BAD_UNCERTAINTY') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'READY',
            uncertainty: 'super-high',
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'STRUCTURED_V4_BAD_CALLER_REQUESTS_SHAPE') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'NEEDS_EVIDENCE',
            caller_requests: 'this should be an array',
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'STRUCTURED_V4_NON_STRING_ITEM') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'READY',
            follow_ups: ['ok', 123, 'also ok'],
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'STRUCTURED_V4_TOO_MANY_CALLER_REQUESTS') {
        const requests = Array.from({ length: 21 }, (_, i) => `req ${i + 1}`);
        const block = `<cross_review_status>${JSON.stringify({
            status: 'NEEDS_EVIDENCE',
            caller_requests: requests,
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'STRUCTURED_V4_OVERSIZED_ITEM') {
        const bigString = 'x'.repeat(501);
        const block = `<cross_review_status>${JSON.stringify({
            status: 'NEEDS_EVIDENCE',
            caller_requests: ['ok', bigString],
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'STRUCTURED_V4_UNKNOWN_FIELD') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'READY',
            extra: 'not in whitelist',
            another_unknown: 42,
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'STRUCTURED_V4_EMPTY_ARRAYS') {
        const block = `<cross_review_status>${JSON.stringify({
            status: 'READY',
            caller_requests: [],
            follow_ups: [],
        })}</cross_review_status>`;
        return { stdout: `${body}\n\n${block}\n`, stderr, peer_model };
    }
    if (stub === 'STRUCTURED_OPEN_NO_CLOSE') {
        // Open tag present but no close tag. Tail does not end with close,
        // falls through to tryLegacyLastLine; without a canonical
        // "STATUS: X" on the last line, returns null (protocol_violation
        // expected).
        const fakeOpen = '<cross_review_status>{"status":"READY"}';
        return { stdout: `${body}\n\n${fakeOpen}\n\nprose after the unclosed opening.\n`, stderr, peer_model };
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
    const cmd = peerAgent === 'codex' ? 'codex' : 'claude';
    const args = peerAgent === 'codex' ? buildCodexArgs() : buildClaudeArgs();
    const cmdLine = buildCommandLine(cmd, args);

    return new Promise((resolve, reject) => {
        const proc = spawn(cmdLine, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
        });
        let stdout = '';
        let stderr = '';
        let finished = false;

        const timer = setTimeout(() => {
            if (finished) return;
            try {
                proc.kill('SIGKILL');
            } catch {}
            reject(new Error(`peer ${peerAgent} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        proc.stdout.on('data', (d) => (stdout += d.toString('utf8')));
        proc.stderr.on('data', (d) => (stderr += d.toString('utf8')));
        proc.on('error', (err) => {
            finished = true;
            clearTimeout(timer);
            reject(new Error(`spawn ${cmd} failed: ${err.message}`));
        });
        proc.on('close', (code) => {
            finished = true;
            clearTimeout(timer);
            if (code !== 0) {
                return reject(
                    new Error(
                        `peer ${peerAgent} exit ${code}: ${stderr.slice(-400)}`
                    )
                );
            }
            resolve({ stdout, stderr });
        });

        proc.stdin.write(String(prompt));
        proc.stdin.end();
    });
}

module.exports = {
    spawnPeer,
    buildCodexArgs,
    buildClaudeArgs,
    listCodexConfiguredServers,
    loadExclusions,
};
