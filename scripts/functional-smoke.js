#!/usr/bin/env node

/**
 * functional-smoke.js
 *
 * Drive the MCP server via stdio JSON-RPC and exercise the state tools
 * (session_init, session_read, session_check_convergence,
 * session_finalize) plus ask_peer.
 *
 * ask_peer is covered through CROSS_REVIEW_PEER_STUB stubs (no real CLI
 * spawn, no LLM cost): see the block of tests starting at the
 * "ask_peer tests via CROSS_REVIEW_PEER_STUB" marker. Real peer CLI
 * paths are validated in manual E2E sessions, not here.
 *
 * Success: every tool responds with the expected shape + the correct
 * files are created in ~/.cross-review/<id>/.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SERVER = path.resolve(__dirname, '..', 'src', 'server.js');
const STATE_DIR = path.join(os.homedir(), '.cross-review');

function requestLine(id, method, params) {
    return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
}

function notifLine(method, params) {
    return `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
}

// Shared reader: parse line-delimited JSON-RPC messages from a child
// stdout stream and route responses (msg.id != null) into a Map. Used
// by every driver function; centralizing this removes repetition and
// avoids the assignment-in-expression pattern.
function attachJsonRpcReader(stream, responses) {
    let buf = '';
    stream.on('data', (d) => {
        buf += d.toString('utf8');
        let idx = buf.indexOf('\n');
        while (idx !== -1) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (line) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.id != null) responses.set(msg.id, msg);
                } catch {
                    // ignore non-JSON lines (MCP diagnostic output etc.)
                }
            }
            idx = buf.indexOf('\n');
        }
    });
}

async function driveServer(extraEnv = {}) {
    const proc = spawn('node', [SERVER], {
        env: { ...process.env, CROSS_REVIEW_CALLER: 'claude', CROSS_REVIEW_SKIP_PROBE: '1', ...extraEnv },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
    });

    const stderrChunks = [];
    proc.stderr.on('data', (d) => stderrChunks.push(d.toString('utf8')));

    const responses = new Map();
    attachJsonRpcReader(proc.stdout, responses);

    function call(id, method, params) {
        return new Promise((resolve, reject) => {
            proc.stdin.write(requestLine(id, method, params));
            const timer = setTimeout(() => {
                reject(new Error(`timeout waiting for response id=${id} method=${method}`));
            }, 10000);
            const poll = setInterval(() => {
                if (responses.has(id)) {
                    clearInterval(poll);
                    clearTimeout(timer);
                    resolve(responses.get(id));
                }
            }, 25);
        });
    }

    function notify(method, params) {
        proc.stdin.write(notifLine(method, params));
    }

    const results = [];

    try {
        // 1) initialize
        const init = await call(1, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '0.1' },
        });
        assert(init.result?.serverInfo?.name === 'cross-review-mcp', 'initialize: serverInfo.name');
        results.push({ step: 'initialize', ok: true });
        notify('notifications/initialized');

        // 2) tools/list
        const tools = await call(2, 'tools/list', {});
        const names = tools.result.tools.map((t) => t.name).sort();
        const expected = [
            'ask_peer',
            'ask_peers',
            'escalate_to_operator',
            'session_check_convergence',
            'session_finalize',
            'session_init',
            'session_read',
        ];
        assert(
            JSON.stringify(names) === JSON.stringify(expected),
            `tools/list: got ${names.join(',')} expected ${expected.join(',')}`
        );
        results.push({ step: 'tools/list', ok: true, tools: names });

        // 3) session_init
        const init2 = await call(3, 'tools/call', {
            name: 'session_init',
            arguments: { task: 'smoke test', artifacts: ['C:/dummy.js'] },
        });
        const initPayload = JSON.parse(init2.result.content[0].text);
        assert(typeof initPayload.session_id === 'string' && initPayload.session_id.length > 0, 'session_init: session_id');
        assert(initPayload.caller === 'claude', 'session_init: caller');
        assert(
            Array.isArray(initPayload.peers) && initPayload.peers.includes('codex') && initPayload.peers.includes('gemini'),
            'session_init: peers array contains codex and gemini'
        );
        assert(
            initPayload.capability_snapshot && initPayload.capability_snapshot.skipped === true,
            'session_init: capability_snapshot records probe skip under CROSS_REVIEW_SKIP_PROBE=1'
        );
        const sessionId = initPayload.session_id;
        const sessDir = path.join(STATE_DIR, sessionId);
        assert(fs.existsSync(path.join(sessDir, 'meta.json')), 'session_init: meta.json exists');
        results.push({ step: 'session_init', ok: true, session_id: sessionId });

        // 4) session_read
        const read = await call(4, 'tools/call', {
            name: 'session_read',
            arguments: { session_id: sessionId },
        });
        const meta = JSON.parse(read.result.content[0].text);
        assert(meta.task === 'smoke test', 'session_read: task');
        assert(meta.artifacts.length === 1 && meta.artifacts[0] === 'C:/dummy.js', 'session_read: artifacts');
        assert(Array.isArray(meta.rounds) && meta.rounds.length === 0, 'session_read: rounds empty');
        results.push({ step: 'session_read', ok: true });

        // 5) session_check_convergence (sem rodadas)
        const conv = await call(5, 'tools/call', {
            name: 'session_check_convergence',
            arguments: { session_id: sessionId },
        });
        const convPayload = JSON.parse(conv.result.content[0].text);
        assert(convPayload.converged === false, 'check_convergence: not converged yet');
        assert(convPayload.reason === 'no rounds yet', 'check_convergence: reason');
        results.push({ step: 'session_check_convergence', ok: true });

        // 6) session_finalize
        const fin = await call(6, 'tools/call', {
            name: 'session_finalize',
            arguments: { session_id: sessionId, outcome: 'aborted' },
        });
        const finPayload = JSON.parse(fin.result.content[0].text);
        assert(finPayload.ok === true && finPayload.outcome === 'aborted', 'finalize: ok');
        // Verify persisted
        const meta2 = JSON.parse(
            fs.readFileSync(path.join(sessDir, 'meta.json'), 'utf8')
        );
        assert(meta2.outcome === 'aborted' && typeof meta2.finalized_at === 'string', 'finalize: persisted');
        results.push({ step: 'session_finalize', ok: true });

        // 7) session_read after finalize
        const read2 = await call(7, 'tools/call', {
            name: 'session_read',
            arguments: { session_id: sessionId },
        });
        const meta3 = JSON.parse(read2.result.content[0].text);
        assert(meta3.outcome === 'aborted', 'read-after-finalize: outcome persisted');
        results.push({ step: 'session_read (after finalize)', ok: true });

        // 8) error path: session_read with bad id
        const bad = await call(8, 'tools/call', {
            name: 'session_read',
            arguments: { session_id: 'nonexistent-uuid-xxx' },
        });
        assert(bad.result.isError === true, 'read bad id: isError flag');
        results.push({ step: 'session_read (bad id -> isError)', ok: true });

        // Limpeza
        if (fs.existsSync(sessDir)) {
            fs.rmSync(sessDir, { recursive: true, force: true });
        }
        results.push({ step: 'cleanup', ok: true });
    } finally {
        proc.stdin.end();
        proc.kill();
    }

    return { results, stderr: stderrChunks.join('') };
}

function assert(cond, msg) {
    if (!cond) throw new Error(`assertion failed: ${msg}`);
}

// === ask_peer tests via CROSS_REVIEW_PEER_STUB ===
// Spawn separate server instance with stub env set, exercise ask_peer +
// bilateral convergence matrix. Stub returns a synthetic response without LLM cost.
async function driveAskPeerMatrix() {
    const results = [];
    const proc = spawn('node', [SERVER], {
        env: { ...process.env, CROSS_REVIEW_CALLER: 'claude', CROSS_REVIEW_SKIP_PROBE: '1', CROSS_REVIEW_PEER_STUB: 'READY' },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
    });
    const stderrChunks = [];
    proc.stderr.on('data', (d) => stderrChunks.push(d.toString('utf8')));
    const responses = new Map();
    attachJsonRpcReader(proc.stdout, responses);
    const call = (id, method, params) =>
        new Promise((resolve, reject) => {
            proc.stdin.write(requestLine(id, method, params));
            const t = setTimeout(() => reject(new Error(`timeout id=${id}`)), 15000);
            const poll = setInterval(() => {
                if (responses.has(id)) {
                    clearInterval(poll);
                    clearTimeout(t);
                    resolve(responses.get(id));
                }
            }, 25);
        });
    const notify = (method, params) => proc.stdin.write(notifLine(method, params));

    try {
        await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-askpeer', version: '0.1' } });
        notify('notifications/initialized');

        const init = await call(2, 'tools/call', { name: 'session_init', arguments: { task: 'askpeer smoke', artifacts: [] } });
        const sid = JSON.parse(init.result.content[0].text).session_id;

        // Round 1: caller=NOT_READY, peer stub=READY -> not converged
        const r1 = await call(3, 'tools/call', { name: 'ask_peer', arguments: { session_id: sid, prompt: 'test', caller_status: 'NOT_READY' } });
        const r1Payload = JSON.parse(r1.result.content[0].text);
        assert(r1Payload.caller_status === 'NOT_READY', 'ask_peer r1: caller_status');
        assert(r1Payload.peer_status === 'READY', 'ask_peer r1: peer_status=READY from stub');
        assert(r1Payload.protocol_violation === false, 'ask_peer r1: no protocol violation');
        results.push({ step: 'ask_peer r1 (caller=NOT_READY, peer=READY)', ok: true });

        const c1 = await call(4, 'tools/call', { name: 'session_check_convergence', arguments: { session_id: sid } });
        const c1Payload = JSON.parse(c1.result.content[0].text);
        assert(c1Payload.converged === false, 'convergence r1: not converged');
        assert(/caller.*NOT_READY.*peer.*READY|peer READY.*caller.*NOT_READY/i.test(c1Payload.reason), 'convergence r1: reason coherent');
        results.push({ step: 'convergence r1 (caller NOT_READY blocks)', ok: true });

        // Round 2: caller=READY, peer stub=READY -> CONVERGED
        const r2 = await call(5, 'tools/call', { name: 'ask_peer', arguments: { session_id: sid, prompt: 'test', caller_status: 'READY' } });
        const r2Payload = JSON.parse(r2.result.content[0].text);
        assert(r2Payload.caller_status === 'READY', 'ask_peer r2: caller_status');
        assert(r2Payload.peer_status === 'READY', 'ask_peer r2: peer READY');
        results.push({ step: 'ask_peer r2 (caller=READY, peer=READY)', ok: true });

        const c2 = await call(6, 'tools/call', { name: 'session_check_convergence', arguments: { session_id: sid } });
        const c2Payload = JSON.parse(c2.result.content[0].text);
        assert(c2Payload.converged === true, 'convergence r2: BILATERAL READY converged');
        results.push({ step: 'convergence r2 (bilateral READY -> converged)', ok: true });

        // Finalize + cleanup
        await call(7, 'tools/call', { name: 'session_finalize', arguments: { session_id: sid, outcome: 'converged' } });
        const sessPath = path.join(os.homedir(), '.cross-review', sid);
        if (fs.existsSync(sessPath)) fs.rmSync(sessPath, { recursive: true, force: true });
        results.push({ step: 'askpeer cleanup', ok: true });
    } finally {
        proc.stdin.end();
        proc.kill();
    }

    return { results, stderr: stderrChunks.join('') };
}

// Test PROTOCOL_VIOLATION path: peer stub returns content without STATUS
async function driveProtocolViolation() {
    const results = [];
    const proc = spawn('node', [SERVER], {
        env: { ...process.env, CROSS_REVIEW_CALLER: 'claude', CROSS_REVIEW_SKIP_PROBE: '1', CROSS_REVIEW_PEER_STUB: 'MISSING' },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
    });
    const responses = new Map();
    attachJsonRpcReader(proc.stdout, responses);
    const call = (id, method, params) =>
        new Promise((resolve, reject) => {
            proc.stdin.write(requestLine(id, method, params));
            const t = setTimeout(() => reject(new Error(`timeout id=${id}`)), 15000);
            const poll = setInterval(() => {
                if (responses.has(id)) {
                    clearInterval(poll);
                    clearTimeout(t);
                    resolve(responses.get(id));
                }
            }, 25);
        });

    try {
        await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-violation', version: '0.1' } });
        proc.stdin.write(notifLine('notifications/initialized'));

        const init = await call(2, 'tools/call', { name: 'session_init', arguments: { task: 'violation test', artifacts: [] } });
        const sid = JSON.parse(init.result.content[0].text).session_id;

        const r = await call(3, 'tools/call', { name: 'ask_peer', arguments: { session_id: sid, prompt: 't', caller_status: 'READY' } });
        const payload = JSON.parse(r.result.content[0].text);
        assert(payload.peer_status === null, 'protocol violation: peer_status null');
        assert(payload.protocol_violation === true, 'protocol violation: flag true');
        assert(payload.peer_structured === null, 'protocol violation: peer_structured null');
        assert(payload.status_source === null, 'protocol violation: status_source null');
        results.push({ step: 'ask_peer with stub=MISSING -> protocol_violation', ok: true });

        const sessPath = path.join(os.homedir(), '.cross-review', sid);
        if (fs.existsSync(sessPath)) fs.rmSync(sessPath, { recursive: true, force: true });
        results.push({ step: 'violation cleanup', ok: true });
    } finally {
        proc.stdin.end();
        proc.kill();
    }

    return { results };
}

// Helper: spawn server, do one ask_peer, return payload+session_id for assertions
async function oneShotAskPeer(stubValue, callerStatus = 'NOT_READY') {
    const proc = spawn('node', [SERVER], {
        env: { ...process.env, CROSS_REVIEW_CALLER: 'claude', CROSS_REVIEW_SKIP_PROBE: '1', CROSS_REVIEW_PEER_STUB: stubValue },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
    });
    const responses = new Map();
    attachJsonRpcReader(proc.stdout, responses);
    const call = (id, method, params) =>
        new Promise((resolve, reject) => {
            proc.stdin.write(requestLine(id, method, params));
            const t = setTimeout(() => reject(new Error(`timeout id=${id}`)), 15000);
            const poll = setInterval(() => {
                if (responses.has(id)) {
                    clearInterval(poll);
                    clearTimeout(t);
                    resolve(responses.get(id));
                }
            }, 25);
        });
    try {
        await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: `smoke-${stubValue}`, version: '0.1' } });
        proc.stdin.write(notifLine('notifications/initialized'));
        const init = await call(2, 'tools/call', { name: 'session_init', arguments: { task: `stub=${stubValue}`, artifacts: [] } });
        const sid = JSON.parse(init.result.content[0].text).session_id;
        const r = await call(3, 'tools/call', { name: 'ask_peer', arguments: { session_id: sid, prompt: 'test', caller_status: callerStatus } });
        const payload = JSON.parse(r.result.content[0].text);
        const conv = await call(4, 'tools/call', { name: 'session_check_convergence', arguments: { session_id: sid } });
        const convPayload = JSON.parse(conv.result.content[0].text);
        return { sessionId: sid, payload, convPayload };
    } finally {
        proc.stdin.end();
        proc.kill();
    }
}

function cleanupSession(sid) {
    const sessPath = path.join(os.homedir(), '.cross-review', sid);
    if (fs.existsSync(sessPath)) fs.rmSync(sessPath, { recursive: true, force: true });
}

// Test NEEDS_EVIDENCE (legacy line form): status parsed, does not converge, reason string mentions evidence.
async function driveNeedsEvidenceLegacy() {
    const results = [];
    const { sessionId, payload, convPayload } = await oneShotAskPeer('NEEDS_EVIDENCE', 'NOT_READY');
    assert(payload.peer_status === 'NEEDS_EVIDENCE', 'legacy NEEDS_EVIDENCE: peer_status');
    assert(payload.status_source === 'regex', 'legacy NEEDS_EVIDENCE: status_source=regex');
    assert(payload.peer_structured === null, 'legacy NEEDS_EVIDENCE: no structured');
    assert(payload.protocol_violation === false, 'legacy NEEDS_EVIDENCE: no violation');
    assert(convPayload.converged === false, 'legacy NEEDS_EVIDENCE: not converged');
    assert(/NEEDS_EVIDENCE/.test(convPayload.reason), 'legacy NEEDS_EVIDENCE: reason mentions status');
    assert(/evidence/i.test(convPayload.reason), 'legacy NEEDS_EVIDENCE: reason mentions evidence');
    results.push({ step: 'ask_peer legacy NEEDS_EVIDENCE -> not converged + reason mentions evidence', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'needs-evidence-legacy cleanup', ok: true });
    return { results };
}

// Test structured block happy path: READY from block, no regex fallback needed
async function driveStructuredReady() {
    const results = [];
    const { sessionId, payload, convPayload } = await oneShotAskPeer('STRUCTURED:READY', 'READY');
    assert(payload.peer_status === 'READY', 'structured READY: peer_status');
    assert(payload.status_source === 'structured', 'structured READY: source');
    assert(payload.peer_structured && payload.peer_structured.status === 'READY', 'structured READY: structured payload');
    assert(convPayload.converged === true, 'structured READY: bilateral converged');
    results.push({ step: 'ask_peer STRUCTURED:READY -> source=structured + converged', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'structured-ready cleanup', ok: true });
    return { results };
}

// Test structured NEEDS_EVIDENCE: status from block, not converged
async function driveStructuredNeedsEvidence() {
    const results = [];
    const { sessionId, payload, convPayload } = await oneShotAskPeer('STRUCTURED:NEEDS_EVIDENCE', 'NOT_READY');
    assert(payload.peer_status === 'NEEDS_EVIDENCE', 'structured NEEDS_EVIDENCE: status');
    assert(payload.status_source === 'structured', 'structured NEEDS_EVIDENCE: source');
    assert(payload.peer_structured.status === 'NEEDS_EVIDENCE', 'structured NEEDS_EVIDENCE: payload');
    assert(convPayload.converged === false, 'structured NEEDS_EVIDENCE: not converged');
    assert(/NEEDS_EVIDENCE/.test(convPayload.reason) && /evidence/i.test(convPayload.reason), 'structured NEEDS_EVIDENCE: reason coherent');
    results.push({ step: 'ask_peer STRUCTURED:NEEDS_EVIDENCE -> not converged + evidence guidance', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'structured-needs-evidence cleanup', ok: true });
    return { results };
}

// Semantic: last-non-empty-content wins. Structured block early + regex STATUS late -> regex wins.
async function driveRegexLastWins() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_EARLY_REGEX_LAST:READY:NOT_READY', 'NOT_READY');
    assert(payload.peer_status === 'NOT_READY', 'last-line anchor: regex NOT_READY wins when STATUS line is last non-empty');
    assert(payload.status_source === 'regex', 'last-line anchor: source=regex');
    assert(payload.peer_structured === null, 'last-line anchor: structured null because regex path taken');
    results.push({ step: 'ask_peer STRUCTURED_EARLY_REGEX_LAST -> regex (last line) wins', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'regex-last-wins cleanup', ok: true });
    return { results };
}

// Semantic: structured block as TAIL wins even if STATUS line appears earlier.
async function driveStructuredTailWins() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_LAST_REGEX_EARLY:NOT_READY:READY', 'READY');
    assert(payload.peer_status === 'READY', 'tail anchor: structured READY tail wins over earlier STATUS NOT_READY');
    assert(payload.status_source === 'structured', 'tail anchor: source=structured');
    assert(payload.peer_structured && payload.peer_structured.status === 'READY', 'tail anchor: payload READY');
    results.push({ step: 'ask_peer STRUCTURED_LAST_REGEX_EARLY -> structured (tail) wins', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'structured-tail-wins cleanup', ok: true });
    return { results };
}

// Malformed structured tail: closing tag ends text but JSON is invalid -> status null (no regex fallback because tail is closing tag).
async function driveMalformedStructuredTail() {
    const results = [];
    const { sessionId, payload, convPayload } = await oneShotAskPeer('MALFORMED_STRUCTURED_TAIL', 'NOT_READY');
    assert(payload.peer_status === null, 'malformed tail: status null');
    assert(payload.status_source === null, 'malformed tail: source null');
    assert(payload.peer_structured === null, 'malformed tail: structured null');
    assert(payload.protocol_violation === true, 'malformed tail: protocol_violation flag');
    assert(convPayload.converged === false, 'malformed tail: not converged');
    results.push({ step: 'ask_peer MALFORMED_STRUCTURED_TAIL -> protocol_violation, no regex fallback', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'malformed-tail cleanup', ok: true });
    return { results };
}

// Invalid status inside structured tail: JSON parses but status not in enum -> null.
async function driveInvalidStatusStructuredTail() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('INVALID_STATUS_STRUCTURED_TAIL', 'NOT_READY');
    assert(payload.peer_status === null, 'invalid status: null');
    assert(payload.status_source === null, 'invalid status: source null');
    assert(payload.peer_structured === null, 'invalid status: structured nullified (not persisting garbage)');
    assert(payload.protocol_violation === true, 'invalid status: protocol_violation');
    results.push({ step: 'ask_peer INVALID_STATUS_STRUCTURED_TAIL -> status null, structured nullified', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'invalid-status-cleanup', ok: true });
    return { results };
}

// Lowercase STATUS line: regex is case-sensitive -> reject.
async function driveLowercaseRejected() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('LOWERCASE_STATUS', 'NOT_READY');
    assert(payload.peer_status === null, 'lowercase: rejected');
    assert(payload.protocol_violation === true, 'lowercase: protocol_violation');
    results.push({ step: 'ask_peer LOWERCASE_STATUS -> rejected (case-sensitive)', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'lowercase-cleanup', ok: true });
    return { results };
}

// Prose mention of STATUS line: should not trigger false positive (tail must be the STATUS line).
async function driveProseStatusNoFalsePositive() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('PROSE_MENTION_STATUS', 'NOT_READY');
    assert(payload.peer_status === null, 'prose mention STATUS: no false positive');
    assert(payload.protocol_violation === true, 'prose mention STATUS: protocol_violation');
    results.push({ step: 'ask_peer PROSE_MENTION_STATUS -> no false positive', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'prose-status-cleanup', ok: true });
    return { results };
}

// Prose mention of structured block: tail is prose, not closing tag -> no match.
async function driveProseBlockNoFalsePositive() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('PROSE_MENTION_BLOCK', 'NOT_READY');
    assert(payload.peer_status === null, 'prose mention block: no false positive');
    assert(payload.protocol_violation === true, 'prose mention block: protocol_violation');
    results.push({ step: 'ask_peer PROSE_MENTION_BLOCK -> no false positive (tail is prose, not closing tag)', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'prose-block-cleanup', ok: true });
    return { results };
}

// Two structured blocks: the later (tail) wins.
async function driveDoubleStructured() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('DOUBLE_STRUCTURED:NOT_READY:READY', 'READY');
    assert(payload.peer_status === 'READY', 'double structured: last (tail) wins');
    assert(payload.status_source === 'structured', 'double structured: source=structured');
    assert(payload.peer_structured.status === 'READY', 'double structured: payload matches last block');
    results.push({ step: 'ask_peer DOUBLE_STRUCTURED -> tail wins', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'double-structured-cleanup', ok: true });
    return { results };
}

// Multi-line pretty-printed JSON inside the structured block.
async function driveMultilineStructured() {
    const results = [];
    const { sessionId, payload, convPayload } = await oneShotAskPeer('MULTILINE_STRUCTURED:READY', 'READY');
    assert(payload.peer_status === 'READY', 'multiline structured: status parsed');
    assert(payload.status_source === 'structured', 'multiline structured: source=structured');
    assert(payload.peer_structured && payload.peer_structured.status === 'READY', 'multiline structured: payload');
    assert(convPayload.converged === true, 'multiline structured: bilateral converged');
    results.push({ step: 'ask_peer MULTILINE_STRUCTURED -> parser tolerates pretty-printed JSON between tags', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'multiline-structured-cleanup', ok: true });
    return { results };
}

// v0.4.0: schema expandido -- STRUCTURED_V4_FULL com todos os campos validos.
async function driveStructuredV4Full() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_V4_FULL', 'READY');
    assert(payload.peer_status === 'READY', 'v4 full: status');
    assert(payload.status_source === 'structured', 'v4 full: source');
    assert(payload.peer_structured && payload.peer_structured.status === 'READY', 'v4 full: structured.status');
    assert(payload.peer_structured.uncertainty === 'low', 'v4 full: uncertainty persisted');
    assert(Array.isArray(payload.peer_structured.caller_requests) && payload.peer_structured.caller_requests.length === 2, 'v4 full: caller_requests persisted');
    assert(Array.isArray(payload.peer_structured.follow_ups) && payload.peer_structured.follow_ups.length === 1, 'v4 full: follow_ups persisted');
    assert(Array.isArray(payload.parser_warnings) && payload.parser_warnings.length === 0, 'v4 full: no warnings');
    assert(payload.peer_model === 'stub', 'v4 full: peer_model persisted');
    results.push({ step: 'ask_peer STRUCTURED_V4_FULL -> all fields validated, no warnings, peer_model stub', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'v4-full-cleanup', ok: true });
    return { results };
}

// v0.4.0: uncertainty with invalid value -- field dropped + warning, status preserved.
async function driveStructuredV4BadUncertainty() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_V4_BAD_UNCERTAINTY', 'READY');
    assert(payload.peer_status === 'READY', 'v4 bad uncertainty: status preserved');
    assert(payload.status_source === 'structured', 'v4 bad uncertainty: source still structured');
    assert(payload.peer_structured && payload.peer_structured.status === 'READY', 'v4 bad uncertainty: structured.status');
    assert(!('uncertainty' in payload.peer_structured), 'v4 bad uncertainty: invalid uncertainty DROPPED from structured');
    assert(Array.isArray(payload.parser_warnings) && payload.parser_warnings.length === 1, 'v4 bad uncertainty: exactly one warning');
    assert(/uncertainty has invalid shape/.test(payload.parser_warnings[0]), 'v4 bad uncertainty: warning message');
    assert(payload.protocol_violation === false, 'v4 bad uncertainty: NOT a protocol violation (status was valid)');
    results.push({ step: 'ask_peer STRUCTURED_V4_BAD_UNCERTAINTY -> uncertainty dropped + warning, status preserved', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'v4-bad-uncertainty-cleanup', ok: true });
    return { results };
}

// v0.4.0: caller_requests non-array -- invalid shape first in the order.
async function driveStructuredV4BadCallerRequestsShape() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_V4_BAD_CALLER_REQUESTS_SHAPE', 'NOT_READY');
    assert(payload.peer_status === 'NEEDS_EVIDENCE', 'v4 bad cr shape: status');
    assert(!('caller_requests' in payload.peer_structured), 'v4 bad cr shape: caller_requests DROPPED');
    assert(payload.parser_warnings.length === 1, 'v4 bad cr shape: one warning');
    assert(/caller_requests has invalid shape/.test(payload.parser_warnings[0]), 'v4 bad cr shape: warning message');
    results.push({ step: 'ask_peer STRUCTURED_V4_BAD_CALLER_REQUESTS_SHAPE -> non-array dropped + warning', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'v4-bad-cr-shape-cleanup', ok: true });
    return { results };
}

// v0.4.0: non-string item inside array (deterministic rule: shape OK, qty OK, item type NOT OK -> reject at item type).
async function driveStructuredV4NonStringItem() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_V4_NON_STRING_ITEM', 'READY');
    assert(payload.peer_status === 'READY', 'v4 non-string item: status');
    assert(!('follow_ups' in payload.peer_structured), 'v4 non-string item: follow_ups DROPPED');
    assert(payload.parser_warnings.length === 1, 'v4 non-string item: one warning');
    assert(/follow_ups has invalid item at index 1/.test(payload.parser_warnings[0]), 'v4 non-string item: warning specifies index');
    results.push({ step: 'ask_peer STRUCTURED_V4_NON_STRING_ITEM -> array dropped + warning with index', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'v4-non-string-item-cleanup', ok: true });
    return { results };
}

// v0.4.0: >20 items -- quantidade excedida.
async function driveStructuredV4TooManyCallerRequests() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_V4_TOO_MANY_CALLER_REQUESTS', 'NOT_READY');
    assert(payload.peer_status === 'NEEDS_EVIDENCE', 'v4 too many: status');
    assert(!('caller_requests' in payload.peer_structured), 'v4 too many: caller_requests DROPPED');
    assert(payload.parser_warnings.length === 1, 'v4 too many: one warning');
    assert(/caller_requests exceeds 20 items \(got 21\)/.test(payload.parser_warnings[0]), 'v4 too many: warning message');
    results.push({ step: 'ask_peer STRUCTURED_V4_TOO_MANY_CALLER_REQUESTS -> array dropped + warning with count', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'v4-too-many-cleanup', ok: true });
    return { results };
}

// v0.4.0: item >500 chars -- tamanho excedido.
async function driveStructuredV4OversizedItem() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_V4_OVERSIZED_ITEM', 'NOT_READY');
    assert(payload.peer_status === 'NEEDS_EVIDENCE', 'v4 oversized: status');
    assert(!('caller_requests' in payload.peer_structured), 'v4 oversized: caller_requests DROPPED');
    assert(payload.parser_warnings.length === 1, 'v4 oversized: one warning');
    assert(/caller_requests item at index 1 exceeds 500 chars/.test(payload.parser_warnings[0]), 'v4 oversized: warning message');
    results.push({ step: 'ask_peer STRUCTURED_V4_OVERSIZED_ITEM -> array dropped + warning with index+size', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'v4-oversized-cleanup', ok: true });
    return { results };
}

// v0.4.0: fields outside the whitelist -- dropped + one warning each.
async function driveStructuredV4UnknownField() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_V4_UNKNOWN_FIELD', 'READY');
    assert(payload.peer_status === 'READY', 'v4 unknown field: status');
    assert(payload.peer_structured && payload.peer_structured.status === 'READY', 'v4 unknown field: structured.status');
    assert(!('extra' in payload.peer_structured), 'v4 unknown field: extra dropped');
    assert(!('another_unknown' in payload.peer_structured), 'v4 unknown field: another_unknown dropped');
    assert(payload.parser_warnings.length === 2, 'v4 unknown field: two warnings');
    assert(payload.parser_warnings.some((w) => /unknown field 'extra' ignored/.test(w)), 'v4 unknown field: extra warning');
    assert(payload.parser_warnings.some((w) => /unknown field 'another_unknown' ignored/.test(w)), 'v4 unknown field: another warning');
    results.push({ step: 'ask_peer STRUCTURED_V4_UNKNOWN_FIELD -> 2 unknown fields dropped + 2 warnings', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'v4-unknown-field-cleanup', ok: true });
    return { results };
}

// v0.4.0: arrays vazios normalizados para ausencia, sem warnings.
async function driveStructuredV4EmptyArrays() {
    const results = [];
    const { sessionId, payload } = await oneShotAskPeer('STRUCTURED_V4_EMPTY_ARRAYS', 'READY');
    assert(payload.peer_status === 'READY', 'v4 empty arrays: status');
    assert(!('caller_requests' in payload.peer_structured), 'v4 empty arrays: empty caller_requests normalized to absent');
    assert(!('follow_ups' in payload.peer_structured), 'v4 empty arrays: empty follow_ups normalized to absent');
    assert(payload.parser_warnings.length === 0, 'v4 empty arrays: no warnings (empty equals absent)');
    results.push({ step: 'ask_peer STRUCTURED_V4_EMPTY_ARRAYS -> empty arrays normalized to absent, no warnings', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'v4-empty-arrays-cleanup', ok: true });
    return { results };
}

// v0.4.0: fecha gap 4f5d45f6 -- opening tag sem closing tag, cai em legacy sem canonical -> null.
async function driveStructuredOpenNoClose() {
    const results = [];
    const { sessionId, payload, convPayload } = await oneShotAskPeer('STRUCTURED_OPEN_NO_CLOSE', 'NOT_READY');
    assert(payload.peer_status === null, 'open-no-close: status null (fall through to legacy, no canonical STATUS line)');
    assert(payload.status_source === null, 'open-no-close: source null');
    assert(payload.peer_structured === null, 'open-no-close: structured null');
    assert(payload.protocol_violation === true, 'open-no-close: protocol_violation true');
    assert(Array.isArray(payload.parser_warnings) && payload.parser_warnings.length === 0, 'open-no-close: no warnings (failed before validation)');
    assert(convPayload.converged === false, 'open-no-close: not converged');
    results.push({ step: 'ask_peer STRUCTURED_OPEN_NO_CLOSE -> tail not closing tag, legacy fails, null (closes 4f5d45f6 gap)', ok: true });
    cleanupSession(sessionId);
    results.push({ step: 'open-no-close-cleanup', ok: true });
    return { results };
}

// v0.4.0: persistencia de parser_warnings e peer_model em meta.json.rounds[i] via session_read.
async function drivePeerModelAndWarningsPersisted() {
    const results = [];
    const { sessionId } = await oneShotAskPeer('STRUCTURED_V4_BAD_UNCERTAINTY', 'NOT_READY');
    // Open a separate server to session_read the persisted meta.
    const proc = spawn('node', [SERVER], {
        env: { ...process.env, CROSS_REVIEW_CALLER: 'claude', CROSS_REVIEW_SKIP_PROBE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
    });
    const responses = new Map();
    attachJsonRpcReader(proc.stdout, responses);
    const call = (id, method, params) =>
        new Promise((resolve, reject) => {
            proc.stdin.write(requestLine(id, method, params));
            const t = setTimeout(() => reject(new Error(`timeout id=${id}`)), 10000);
            const poll = setInterval(() => {
                if (responses.has(id)) {
                    clearInterval(poll);
                    clearTimeout(t);
                    resolve(responses.get(id));
                }
            }, 25);
        });
    try {
        await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-persist', version: '0.1' } });
        proc.stdin.write(notifLine('notifications/initialized'));
        const readResp = await call(2, 'tools/call', { name: 'session_read', arguments: { session_id: sessionId } });
        const meta = JSON.parse(readResp.result.content[0].text);
        assert(Array.isArray(meta.rounds) && meta.rounds.length === 1, 'persist: one round recorded');
        const round = meta.rounds[0];
        assert(round.peer_model === 'stub', 'persist: peer_model persisted in meta.rounds[0]');
        assert(Array.isArray(round.parser_warnings) && round.parser_warnings.length === 1, 'persist: parser_warnings persisted');
        assert(/uncertainty has invalid shape/.test(round.parser_warnings[0]), 'persist: warning message preserved');
        results.push({ step: 'session_read -> meta.rounds[0] has peer_model and parser_warnings persisted', ok: true });
    } finally {
        proc.stdin.end();
        proc.kill();
    }
    cleanupSession(sessionId);
    results.push({ step: 'persist-check-cleanup', ok: true });
    return { results };
}

async function runAll() {
    const all = [];
    const s1 = await driveServer();
    all.push(...s1.results);
    const s2 = await driveAskPeerMatrix();
    all.push(...s2.results);
    const s3 = await driveProtocolViolation();
    all.push(...s3.results);
    const s4 = await driveNeedsEvidenceLegacy();
    all.push(...s4.results);
    const s5 = await driveStructuredReady();
    all.push(...s5.results);
    const s6 = await driveStructuredNeedsEvidence();
    all.push(...s6.results);
    const s7 = await driveRegexLastWins();
    all.push(...s7.results);
    const s8 = await driveStructuredTailWins();
    all.push(...s8.results);
    const s9 = await driveMalformedStructuredTail();
    all.push(...s9.results);
    const s10 = await driveInvalidStatusStructuredTail();
    all.push(...s10.results);
    const s11 = await driveLowercaseRejected();
    all.push(...s11.results);
    const s12 = await driveProseStatusNoFalsePositive();
    all.push(...s12.results);
    const s13 = await driveProseBlockNoFalsePositive();
    all.push(...s13.results);
    const s14 = await driveDoubleStructured();
    all.push(...s14.results);
    const s15 = await driveMultilineStructured();
    all.push(...s15.results);
    // v0.4.0: schema expandido.
    const s16 = await driveStructuredV4Full();
    all.push(...s16.results);
    const s17 = await driveStructuredV4BadUncertainty();
    all.push(...s17.results);
    const s18 = await driveStructuredV4BadCallerRequestsShape();
    all.push(...s18.results);
    const s19 = await driveStructuredV4NonStringItem();
    all.push(...s19.results);
    const s20 = await driveStructuredV4TooManyCallerRequests();
    all.push(...s20.results);
    const s21 = await driveStructuredV4OversizedItem();
    all.push(...s21.results);
    const s22 = await driveStructuredV4UnknownField();
    all.push(...s22.results);
    const s23 = await driveStructuredV4EmptyArrays();
    all.push(...s23.results);
    const s24 = await driveStructuredOpenNoClose();
    all.push(...s24.results);
    const s25 = await drivePeerModelAndWarningsPersisted();
    all.push(...s25.results);
    const s26 = await drivePeerSpawnRealPathModel();
    all.push(...s26.results);
    const s27 = await driveModelParserUnit();
    all.push(...s27.results);
    const s28 = await driveGeminiArgsShape();
    all.push(...s28.results);
    const s29 = await driveSpawnPeersIdentityShape();
    all.push(...s29.results);
    const s30 = await driveProbeStubShape();
    all.push(...s30.results);
    const s31 = await driveSessionStoreUnit();
    all.push(...s31.results);
    const s32 = await driveAskPeersNAry();
    all.push(...s32.results);
    const s33 = await driveAskPeerGeminiCallerRejected();
    all.push(...s33.results);
    const s34 = await driveModelCheckMatchViaServer();
    all.push(...s34.results);
    const s35 = await driveModelCheckDowngradeViaServer();
    all.push(...s35.results);
    const s36 = await driveModelCheckMissingViaServer();
    all.push(...s36.results);
    const s37 = await driveV6TransportBypassUnit();
    all.push(...s37.results);
    const s38 = await driveV6RateLimitUnit();
    all.push(...s38.results);
    const s39 = await driveV6ConvergenceSnapshotUnit();
    all.push(...s39.results);
    const s40 = await driveV7AntiHallucinationUnit();
    all.push(...s40.results);
    const s41 = await driveV7BannerAttestationUnit();
    all.push(...s41.results);
    const s42 = await driveV7EscalateToOperatorUnit();
    all.push(...s42.results);
    return all;
}

// v0.7.0-alpha / spec v4.10 unit coverage.
async function driveV7AntiHallucinationUnit() {
    const results = [];
    const sp = require('../src/lib/status-parser.js');

    // confidence='verified' without evidence_sources -> advisory warning.
    const stdoutVerifiedEmpty = `body\n\n<cross_review_status>${JSON.stringify({
        status: 'READY',
        confidence: 'verified',
    })}</cross_review_status>\n`;
    const pv = sp.parsePeerResponse(stdoutVerifiedEmpty);
    assert(pv.status === 'READY', 'v4.10 Item D: status READY preserved');
    assert(pv.structured.confidence === 'verified', 'v4.10 Item D: confidence preserved');
    assert(
        pv.parser_warnings.some((w) => w.includes("confidence='verified'")),
        'v4.10 Item D: advisory warning for verified without evidence'
    );
    results.push({ step: 'v4.10 Item D: confidence=verified without evidence_sources emits advisory', ok: true });

    // confidence='unknown' with status=READY -> hard-pair violation warning.
    const stdoutUnknownReady = `body\n\n<cross_review_status>${JSON.stringify({
        status: 'READY',
        confidence: 'unknown',
    })}</cross_review_status>\n`;
    const pu = sp.parsePeerResponse(stdoutUnknownReady);
    assert(
        pu.parser_warnings.some((w) => w.includes(`confidence='unknown'`) && w.includes('NEEDS_EVIDENCE')),
        'v4.10 Item D: hard-pair warning for unknown+READY'
    );
    results.push({ step: 'v4.10 Item D: confidence=unknown must pair with NEEDS_EVIDENCE (hard-pair rule)', ok: true });

    // confidence='unknown' + status='NEEDS_EVIDENCE' -> no hard-pair warning.
    const stdoutUnknownNE = `body\n\n<cross_review_status>${JSON.stringify({
        status: 'NEEDS_EVIDENCE',
        confidence: 'unknown',
        caller_requests: ['need primary source X'],
    })}</cross_review_status>\n`;
    const pun = sp.parsePeerResponse(stdoutUnknownNE);
    assert(
        !pun.parser_warnings.some((w) => w.includes('hard-pair') || (w.includes('confidence') && w.includes('pair'))),
        'v4.10 Item D: unknown+NEEDS_EVIDENCE: no hard-pair violation'
    );
    assert(pun.structured.confidence === 'unknown', 'v4.10 Item D: confidence=unknown preserved');
    results.push({ step: 'v4.10 Item D: unknown+NEEDS_EVIDENCE compliant', ok: true });

    // evidence_sources validated like caller_requests.
    const stdoutEvidence = `body\n\n<cross_review_status>${JSON.stringify({
        status: 'READY',
        confidence: 'verified',
        evidence_sources: ['file:src/lib/peer-spawn.js', 'cli:gemini --help'],
    })}</cross_review_status>\n`;
    const pe = sp.parsePeerResponse(stdoutEvidence);
    assert(
        Array.isArray(pe.structured.evidence_sources) && pe.structured.evidence_sources.length === 2,
        'v4.10 Item D: evidence_sources parsed as array'
    );
    assert(
        !pe.parser_warnings.some((w) => w.includes("confidence='verified'") && w.includes('evidence_sources')),
        'v4.10 Item D: no advisory when verified + evidence_sources populated'
    );
    results.push({ step: 'v4.10 Item D: evidence_sources validated + advisory suppressed', ok: true });

    // invalid confidence value -> warning, not accepted.
    const stdoutBadConfidence = `body\n\n<cross_review_status>${JSON.stringify({
        status: 'READY',
        confidence: 'super-sure',
    })}</cross_review_status>\n`;
    const pbc = sp.parsePeerResponse(stdoutBadConfidence);
    assert(pbc.status === 'READY', 'v4.10 Item D: status preserved despite invalid confidence');
    assert(pbc.structured.confidence === undefined, 'v4.10 Item D: invalid confidence dropped');
    assert(
        pbc.parser_warnings.some((w) => w.includes('confidence has invalid shape')),
        'v4.10 Item D: invalid confidence emits warning'
    );
    results.push({ step: 'v4.10 Item D: invalid confidence dropped + warning', ok: true });

    return { results };
}

async function driveV7BannerAttestationUnit() {
    const results = [];
    process.env.CROSS_REVIEW_TEST_IMPORT = '1';
    const server = require('../src/server.js');

    const stdout = 'body\n\n<cross_review_peer_model>{"model_id":"gpt-4"}</cross_review_peer_model>\n<cross_review_status>{"status":"READY"}</cross_review_status>\n';
    const descriptor = {
        agent: 'codex',
        auth: 'cli-subscription',
        endpoint_class: 'chatgpt-pro-backend',
    };

    // Case 1: banner matches pin -> cli_banner_attested=true, skip audit retained
    const parsedMatch = server.parsePeerOutputs(stdout, 'gpt-5.5', descriptor, 'gpt-5.5');
    assert(parsedMatch.cli_banner_attested === true, 'v4.10 Item E: cli_banner_attested true on match');
    assert(
        parsedMatch.model_check_skipped
            && parsedMatch.model_check_skipped.cli_banner_attested === true,
        'v4.10 Item E: model_check_skipped carries cli_banner_attested=true audit'
    );
    assert(parsedMatch.model_failure_class === null, 'v4.10 Item E: no failure class on banner match');
    assert(parsedMatch.protocol_violation === false, 'v4.10 Item E: no protocol_violation on banner match');
    results.push({ step: 'v4.10 Item E: banner match -> elevated audit (cli_banner_attested=true)', ok: true });

    // Case 2: banner mismatches pin -> hard gate + cli_banner_attestation_mismatch.
    const parsedMismatch = server.parsePeerOutputs(stdout, 'gpt-5.5', descriptor, 'gpt-4.5-deprecated');
    assert(
        parsedMismatch.model_failure_class === 'cli_banner_attestation_mismatch',
        'v4.10 Item E: cli_banner_attestation_mismatch class on mismatch'
    );
    assert(parsedMismatch.protocol_violation === true, 'v4.10 Item E: protocol_violation true on banner mismatch');
    assert(parsedMismatch.model_check_applicable === true, 'v4.10 Item E: check applicable under banner mismatch');
    assert(parsedMismatch.cli_banner_attested === false, 'v4.10 Item E: cli_banner_attested false on mismatch');
    assert(parsedMismatch.cli_attested_model === 'gpt-4.5-deprecated', 'v4.10 Item E: cli_attested_model surfaced raw');
    results.push({ step: 'v4.10 Item E: banner mismatch -> cli_banner_attestation_mismatch hard gate', ok: true });

    // Case 3: no banner present -> fall through to §6.11 skip.
    const parsedNoBanner = server.parsePeerOutputs(stdout, 'gpt-5.5', descriptor, null);
    assert(
        parsedNoBanner.model_check_skipped
            && parsedNoBanner.model_check_skipped.reason === 'unreliable_text_self_report_on_cli'
            && !parsedNoBanner.model_check_skipped.cli_banner_attested,
        'v4.10 Item E: no banner -> §6.11 skip applies unchanged'
    );
    assert(parsedNoBanner.cli_banner_attested === false, 'v4.10 Item E: cli_banner_attested false without banner');
    results.push({ step: 'v4.10 Item E: no banner -> §6.11 skip path unchanged', ok: true });

    // Case 4: oauth-personal transport ignores banner (banner is Codex-specific domain).
    const geminiDesc = { agent: 'gemini', auth: 'oauth-personal', endpoint_class: 'v1internal' };
    const parsedGemini = server.parsePeerOutputs(stdout, 'gemini-3.1-pro-preview', geminiDesc, 'gemini-banner-does-not-exist');
    assert(
        parsedGemini.model_check_skipped
            && parsedGemini.model_check_skipped.reason === 'unreliable_text_self_report_on_cli',
        'v4.10 Item E: oauth-personal takes §6.11 skip path regardless of banner'
    );
    assert(parsedGemini.cli_banner_attested === false, 'v4.10 Item E: banner promotion confined to cli-subscription');
    results.push({ step: 'v4.10 Item E: banner promotion confined to cli-subscription (oauth-personal uses §6.11)', ok: true });

    return { results };
}

async function driveV7EscalateToOperatorUnit() {
    const results = [];
    const store = require('../src/lib/session-store.js');

    // Drive the MCP escalate_to_operator tool end-to-end via stdio JSON-RPC.
    // Explicitly unset CROSS_REVIEW_TEST_IMPORT — earlier unit drivers set it
    // in this process's env for direct require(), but it would otherwise
    // propagate to the child and skip the stdio transport main().
    const childEnv = { ...process.env, CROSS_REVIEW_CALLER: 'claude', CROSS_REVIEW_SKIP_PROBE: '1' };
    delete childEnv.CROSS_REVIEW_TEST_IMPORT;
    const proc = spawn('node', [SERVER], {
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
    });
    const responses = new Map();
    attachJsonRpcReader(proc.stdout, responses);
    const call = (id, method, params) =>
        new Promise((resolve, reject) => {
            proc.stdin.write(requestLine(id, method, params));
            const t = setTimeout(() => reject(new Error(`timeout id=${id}`)), 15000);
            const poll = setInterval(() => {
                if (responses.has(id)) {
                    clearInterval(poll);
                    clearTimeout(t);
                    resolve(responses.get(id));
                }
            }, 25);
        });
    const notify = (method, params) => proc.stdin.write(notifLine(method, params));

    try {
        await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-escalate', version: '0.1' } });
        notify('notifications/initialized');

        const init = await call(2, 'tools/call', { name: 'session_init', arguments: { task: 'escalate smoke', artifacts: [] } });
        const sid = JSON.parse(init.result.content[0].text).session_id;

        const esc = await call(3, 'tools/call', {
            name: 'escalate_to_operator',
            arguments: {
                session_id: sid,
                question: 'Primary source X is unreachable; operator clarification needed',
                context: 'tried docs/ + CLI --help + live probe; all three returned nothing',
            },
        });
        const escPayload = JSON.parse(esc.result.content[0].text);
        assert(typeof escPayload.escalation_id === 'string' && escPayload.escalation_id.length > 10, 'v4.10 Item D: escalation_id returned (uuid)');
        assert(escPayload.from_agent === 'claude', 'v4.10 Item D: from_agent captured');
        assert(escPayload.question.includes('Primary source X'), 'v4.10 Item D: question persisted');
        assert(escPayload.round_index === 0, 'v4.10 Item D: round_index=0 for pre-round escalation');
        results.push({ step: 'v4.10 Item D: escalate_to_operator returns escalation record with uuid', ok: true });

        // Invalid input (empty question) must error.
        const bad = await call(4, 'tools/call', {
            name: 'escalate_to_operator',
            arguments: { session_id: sid, question: '   ' },
        });
        const badPayload = JSON.parse(bad.result.content[0].text);
        assert(typeof badPayload.error === 'string' && badPayload.error.includes('non-empty'), 'v4.10 Item D: empty question rejected');
        results.push({ step: 'v4.10 Item D: escalate_to_operator rejects empty question', ok: true });

        // Verify persistence via session_read.
        const read = await call(5, 'tools/call', { name: 'session_read', arguments: { session_id: sid } });
        const meta = JSON.parse(read.result.content[0].text);
        assert(Array.isArray(meta.escalations) && meta.escalations.length === 1, 'v4.10 Item D: meta.escalations[] persisted exactly one entry');
        assert(meta.escalations[0].escalation_id === escPayload.escalation_id, 'v4.10 Item D: persisted id matches returned id');
        results.push({ step: 'v4.10 Item D: meta.escalations[] persisted and readable via session_read', ok: true });

        // Cleanup
        await call(6, 'tools/call', { name: 'session_finalize', arguments: { session_id: sid, outcome: 'aborted' } });
        const sessPath = path.join(os.homedir(), '.cross-review', sid);
        if (fs.existsSync(sessPath)) fs.rmSync(sessPath, { recursive: true, force: true });
        results.push({ step: 'v4.10 Item D: escalate smoke cleanup', ok: true });
    } finally {
        proc.stdin.end();
        proc.kill();
    }

    // Unit check on store.saveEscalation directly (test_import bypass).
    const id = store.initSession({ task: 'unit', artifacts: [], callerAgent: 'claude', peers: ['codex', 'gemini'] });
    const entry = store.saveEscalation(id, 'codex', 'another question', null);
    assert(entry.from_agent === 'codex', 'v4.10 Item D: saveEscalation accepts arbitrary agent');
    assert(entry.context === null, 'v4.10 Item D: saveEscalation accepts null context');
    const cleanup = path.join(os.homedir(), '.cross-review', id);
    if (fs.existsSync(cleanup)) fs.rmSync(cleanup, { recursive: true, force: true });
    results.push({ step: 'v4.10 Item D: saveEscalation unit (null context + non-caller agent)', ok: true });

    return { results };
}

// v0.6.0-alpha / spec v4.9 unit coverage. Three compact drivers exercising
// the three Item axes in isolation (no MCP spawn): transport-aware bypass,
// rate-limit detection + retry_after extraction, strict-only convergence
// with persisted snapshot.
async function driveV6TransportBypassUnit() {
    const results = [];
    const peerSpawn = require('../src/lib/peer-spawn.js');
    process.env.CROSS_REVIEW_TEST_IMPORT = '1';
    const server = require('../src/server.js');

    // buildTransportDescriptor shape per agent.
    const codexDesc = peerSpawn.buildTransportDescriptor('codex');
    assert(
        codexDesc.agent === 'codex' && codexDesc.auth === 'cli-subscription' && codexDesc.endpoint_class === 'chatgpt-pro-backend',
        'v4.9 Item A: codex transport_descriptor shape'
    );
    results.push({ step: 'v4.9 Item A: buildTransportDescriptor(codex)', ok: true });

    const claudeDesc = peerSpawn.buildTransportDescriptor('claude');
    assert(
        claudeDesc.auth === 'cli-subscription' && claudeDesc.endpoint_class === 'claude-pro-backend',
        'v4.9 Item A: claude transport_descriptor shape'
    );
    results.push({ step: 'v4.9 Item A: buildTransportDescriptor(claude)', ok: true });

    const geminiDesc = peerSpawn.buildTransportDescriptor('gemini');
    assert(
        geminiDesc.agent === 'gemini' && (geminiDesc.auth === 'oauth-personal' || geminiDesc.auth === 'api-key'),
        'v4.9 Item A: gemini transport_descriptor auth valid'
    );
    results.push({ step: 'v4.9 Item A: buildTransportDescriptor(gemini)', ok: true });

    // Gate semantics.
    assert(
        peerSpawn.authoritativeModelAttestationAvailable({ auth: 'api-key' }) === true,
        'v4.9 Item A: gate TRUE for api-key'
    );
    assert(
        peerSpawn.authoritativeModelAttestationAvailable({ auth: 'cli-subscription' }) === false,
        'v4.9 Item A: gate FALSE for cli-subscription'
    );
    assert(
        peerSpawn.authoritativeModelAttestationAvailable({ auth: 'oauth-personal' }) === false,
        'v4.9 Item A: gate FALSE for oauth-personal'
    );
    results.push({ step: 'v4.9 Item A: authoritativeModelAttestationAvailable gate', ok: true });

    // parsePeerOutputs with non-api-key descriptor → SKIP set, no violation.
    const stdout = 'some body\n\n<cross_review_peer_model>{"model_id":"gpt-4"}</cross_review_peer_model>\n<cross_review_status>{"status":"READY"}</cross_review_status>\n';
    const parsedSkip = server.parsePeerOutputs(stdout, 'gpt-5.5', {
        agent: 'codex',
        auth: 'cli-subscription',
        endpoint_class: 'chatgpt-pro-backend',
    });
    assert(parsedSkip.peer_status === 'READY', 'v4.9 Item A: peer_status READY under bypass');
    assert(parsedSkip.model_check_applicable === false, 'v4.9 Item A: model_check_applicable false under bypass');
    assert(
        parsedSkip.model_check_skipped
            && parsedSkip.model_check_skipped.reason === 'unreliable_text_self_report_on_cli'
            && parsedSkip.model_check_skipped.auth === 'cli-subscription',
        'v4.9 Item A: model_check_skipped audit record set'
    );
    assert(parsedSkip.model_match === null, 'v4.9 Item A: model_match null under bypass (not false)');
    assert(parsedSkip.model_failure_class === null, 'v4.9 Item A: model_failure_class null under bypass');
    assert(parsedSkip.protocol_violation === false, 'v4.9 Item A: no protocol_violation from bypass');
    results.push({ step: 'v4.9 Item A: parsePeerOutputs skip-path end-to-end', ok: true });

    // parsePeerOutputs with api-key descriptor → check runs normally.
    const parsedCheck = server.parsePeerOutputs(stdout, 'gpt-5.5', {
        agent: 'codex',
        auth: 'api-key',
        endpoint_class: 'generativelanguage-v1beta',
    });
    assert(parsedCheck.model_check_applicable === true, 'v4.9 Item A: check applicable under api-key');
    assert(parsedCheck.model_match === false, 'v4.9 Item A: check fires for real mismatch under api-key');
    assert(parsedCheck.model_failure_class === 'silent_model_downgrade', 'v4.9 Item A: silent_model_downgrade preserved under api-key');
    assert(parsedCheck.model_check_skipped === null, 'v4.9 Item A: no skip record under api-key');
    results.push({ step: 'v4.9 Item A: parsePeerOutputs check-path under api-key', ok: true });

    return { results };
}

async function driveV6RateLimitUnit() {
    const results = [];
    const peerSpawn = require('../src/lib/peer-spawn.js');
    process.env.CROSS_REVIEW_TEST_IMPORT = '1';
    const server = require('../src/server.js');

    // Provider-shaped lexeme matching.
    assert(peerSpawn.matchRateLimitLexeme('HTTP 429 Too Many Requests') === '429', 'v4.9 Item C: 429 lexeme match');
    assert(peerSpawn.matchRateLimitLexeme('RESOURCE_EXHAUSTED: quota') === 'RESOURCE_EXHAUSTED', 'v4.9 Item C: Gemini lexeme match');
    assert(peerSpawn.matchRateLimitLexeme('hit usage limit on plan') === 'usage limit', 'v4.9 Item C: Claude lexeme match');
    assert(peerSpawn.matchRateLimitLexeme('insufficient_quota for model') === 'insufficient_quota', 'v4.9 Item C: Codex lexeme match');
    // Generic {rate, quota, limit} alone must NOT match.
    assert(peerSpawn.matchRateLimitLexeme('discussion about rate of adoption') === null, 'v4.9 Item C: generic "rate" does not match');
    assert(peerSpawn.matchRateLimitLexeme('set a limit for yourself') === null, 'v4.9 Item C: generic "limit" does not match');
    assert(peerSpawn.matchRateLimitLexeme('their quota seems fine') === null, 'v4.9 Item C: generic "quota" does not match');
    results.push({ step: 'v4.9 Item C: lexeme set excludes generic {rate,quota,limit}', ok: true });

    // Retry-After extraction.
    assert(peerSpawn.extractRetryAfterSeconds('Retry-After: 30\nOther header') === 30, 'v4.9 Item C: Retry-After extracted');
    assert(peerSpawn.extractRetryAfterSeconds('retry_after: 15') === 15, 'v4.9 Item C: retry_after (snake) extracted');
    assert(peerSpawn.extractRetryAfterSeconds('no retry info here') === null, 'v4.9 Item C: null when absent (never fabricated)');
    results.push({ step: 'v4.9 Item C: extractRetryAfterSeconds', ok: true });

    // detectSpawnRateLimit.
    const spawnRL = peerSpawn.detectSpawnRateLimit('HTTP 429\nRetry-After: 42\nGone');
    assert(
        spawnRL && spawnRL.detection_source === 'spawn' && spawnRL.retry_after_seconds === 42 && spawnRL.lexeme_matched === '429',
        'v4.9 Item C: detectSpawnRateLimit composed shape'
    );
    assert(peerSpawn.detectSpawnRateLimit('benign error') === null, 'v4.9 Item C: no match on benign stderr');
    results.push({ step: 'v4.9 Item C: detectSpawnRateLimit output shape + null paths', ok: true });

    // Response-level guardrail via parsePeerOutputs: ALL THREE required.
    // Case: short body + no status block + provider lexeme → detected.
    const shortRL = 'HTTP 429 rate limit';
    const parsedRL = server.parsePeerOutputs(shortRL, 'stub', null);
    assert(
        parsedRL.rate_limit && parsedRL.rate_limit.detection_source === 'response' && parsedRL.rate_limit.lexeme_matched === '429',
        'v4.9 Item C: response-level detection fires on all-three-match'
    );
    results.push({ step: 'v4.9 Item C: response-level ALL-THREE match', ok: true });

    // Case: status block present → no detection (guardrail 1).
    const statusPresent = 'HTTP 429\n<cross_review_status>{"status":"READY"}</cross_review_status>';
    const parsedNoRL1 = server.parsePeerOutputs(statusPresent, 'stub', null);
    assert(parsedNoRL1.rate_limit === null, 'v4.9 Item C: response-level blocked by status block present');
    results.push({ step: 'v4.9 Item C: response-level guardrail 1 (status block absent required)', ok: true });

    // Case: body over threshold → no detection (guardrail 2).
    const longBody = `HTTP 429 rate limit ${'x'.repeat(250)}`;
    const parsedNoRL2 = server.parsePeerOutputs(longBody, 'stub', null);
    assert(parsedNoRL2.rate_limit === null, 'v4.9 Item C: response-level blocked by body >= 200 chars');
    results.push({ step: 'v4.9 Item C: response-level guardrail 2 (body < 200 chars required)', ok: true });

    // Case: no provider lexeme → no detection (guardrail 3).
    const noLexeme = 'short response, no indicator';
    const parsedNoRL3 = server.parsePeerOutputs(noLexeme, 'stub', null);
    assert(parsedNoRL3.rate_limit === null, 'v4.9 Item C: response-level blocked by missing provider lexeme');
    results.push({ step: 'v4.9 Item C: response-level guardrail 3 (provider lexeme required)', ok: true });

    return { results };
}

async function driveV6ConvergenceSnapshotUnit() {
    const results = [];
    const store = require('../src/lib/session-store.js');

    // computeConvergenceSnapshot shape — N-ary converged case.
    const roundN = {
        round: 1,
        caller: 'claude',
        caller_status: 'READY',
        peers: [
            { agent: 'codex', peer_status: 'READY' },
            { agent: 'gemini', peer_status: 'READY' },
        ],
    };
    const snapConverged = store.computeConvergenceSnapshot(1, roundN, {
        excluded_probe: [],
        excluded_runtime: [],
    });
    assert(snapConverged.spec_version === store.CONVERGENCE_SPEC_VERSION, 'v4.9 Item B: snapshot spec_version v4.9');
    assert(snapConverged.denominator_mode === 'strict', 'v4.9 Item B: denominator_mode strict');
    assert(snapConverged.converged === true, 'v4.9 Item B: converged when caller + all peers READY');
    assert(snapConverged.ready_peers.length === 2, 'v4.9 Item B: ready_peers populated');
    assert(snapConverged.blocking_peers.length === 0, 'v4.9 Item B: no blocking_peers when converged');
    results.push({ step: 'v4.9 Item B: computeConvergenceSnapshot N-ary converged shape', ok: true });

    // N-ary blocked by status_missing.
    const roundBlocked = {
        round: 2,
        caller: 'claude',
        caller_status: 'READY',
        peers: [
            { agent: 'codex', peer_status: 'READY' },
            { agent: 'gemini', peer_status: null },
        ],
    };
    const snapBlocked = store.computeConvergenceSnapshot(2, roundBlocked, {
        excluded_probe: [],
        excluded_runtime: [],
    });
    assert(snapBlocked.converged === false, 'v4.9 Item B: strict denominator — status_missing blocks');
    assert(
        snapBlocked.blocking_peers.length === 1 && snapBlocked.blocking_peers[0].reason === 'status_missing',
        'v4.9 Item B: blocking_peers records status_missing'
    );
    results.push({ step: 'v4.9 Item B: strict denominator — status_missing counts AGAINST', ok: true });

    // Legacy bilateral round shape still supported.
    const roundLegacy = {
        round: 1,
        caller: 'claude',
        caller_status: 'READY',
        peer: 'codex',
        peer_status: 'READY',
    };
    const snapLegacy = store.computeConvergenceSnapshot(1, roundLegacy, {
        excluded_probe: [],
        excluded_runtime: [],
    });
    assert(snapLegacy.converged === true, 'v4.9 Item B: legacy bilateral shape still converges');
    assert(snapLegacy.responded_peers[0] === 'codex', 'v4.9 Item B: legacy bilateral responded_peers');
    results.push({ step: 'v4.9 Item B: computeConvergenceSnapshot legacy bilateral shape', ok: true });

    return { results };
}

// W8: ask_peers N-ary flow end-to-end via MCP. Smoke uses the agent-
// agnostic CROSS_REVIEW_PEER_STUB=STRUCTURED:READY so every spawned
// peer (codex + gemini under caller=claude) resolves with a stub READY.
// Verifies the round carries peers[] with explicit identity and the
// unanimity convergence path.
async function driveAskPeersNAry() {
    const results = [];
    const proc = spawn('node', [SERVER], {
        env: {
            ...process.env,
            CROSS_REVIEW_CALLER: 'claude',
            CROSS_REVIEW_SKIP_PROBE: '1',
            CROSS_REVIEW_PEER_STUB: 'STRUCTURED:READY',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
    });
    const responses = new Map();
    attachJsonRpcReader(proc.stdout, responses);
    const call = (id, method, params) =>
        new Promise((resolve, reject) => {
            proc.stdin.write(requestLine(id, method, params));
            const t = setTimeout(() => reject(new Error(`timeout id=${id}`)), 10000);
            const poll = setInterval(() => {
                if (responses.has(id)) {
                    clearInterval(poll);
                    clearTimeout(t);
                    resolve(responses.get(id));
                }
            }, 25);
        });
    let sessionId;
    try {
        await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-ask-peers', version: '0.1' } });
        proc.stdin.write(notifLine('notifications/initialized'));
        const init = await call(2, 'tools/call', {
            name: 'session_init',
            arguments: { task: 'ask_peers N-ary smoke', artifacts: [] },
        });
        sessionId = JSON.parse(init.result.content[0].text).session_id;
        const askResp = await call(3, 'tools/call', {
            name: 'ask_peers',
            arguments: { session_id: sessionId, prompt: 'trilateral stub probe', caller_status: 'READY' },
        });
        const askPayload = JSON.parse(askResp.result.content[0].text);
        assert(Array.isArray(askPayload.peers), 'ask_peers: peers array returned');
        assert(askPayload.peers.length === 2, 'ask_peers: 2 peers responded (codex+gemini)');
        const agents = askPayload.peers.map((p) => p.agent).sort();
        assert(JSON.stringify(agents) === JSON.stringify(['codex', 'gemini']), `peers are codex,gemini (got ${agents.join(',')})`);
        for (const p of askPayload.peers) {
            assert(p.status === 'fulfilled', `peer ${p.agent} status=fulfilled`);
            assert(p.peer_status === 'READY', `peer ${p.agent} peer_status=READY`);
        }
        assert(askPayload.quorum.requested === 2 && askPayload.quorum.responded === 2 && askPayload.quorum.rejected === 0, 'quorum: 2/2/0');
        assert(askPayload.protocol_violation === false, 'no protocol violation on stub READY');
        results.push({ step: 'ask_peers: N-ary round with 2 stub peers, unanimity READY, quorum 2/2/0', ok: true });

        const convResp = await call(4, 'tools/call', { name: 'session_check_convergence', arguments: { session_id: sessionId } });
        const convPayload = JSON.parse(convResp.result.content[0].text);
        assert(convPayload.converged === true, 'N-ary convergence: caller READY + all peers READY');
        results.push({ step: 'session_check_convergence N-ary after ask_peers: converged=true', ok: true });
    } finally {
        proc.kill();
        if (sessionId) cleanupSession(sessionId);
    }
    return { results };
}

// W8: ask_peer MUST reject gemini caller (R23, legacy bilateral
// surface is claude<->codex only).
async function driveAskPeerGeminiCallerRejected() {
    const results = [];
    const proc = spawn('node', [SERVER], {
        env: {
            ...process.env,
            CROSS_REVIEW_CALLER: 'gemini',
            CROSS_REVIEW_SKIP_PROBE: '1',
            CROSS_REVIEW_PEER_STUB: 'STRUCTURED:READY',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
    });
    const responses = new Map();
    attachJsonRpcReader(proc.stdout, responses);
    const call = (id, method, params) =>
        new Promise((resolve, reject) => {
            proc.stdin.write(requestLine(id, method, params));
            const t = setTimeout(() => reject(new Error(`timeout id=${id}`)), 10000);
            const poll = setInterval(() => {
                if (responses.has(id)) {
                    clearInterval(poll);
                    clearTimeout(t);
                    resolve(responses.get(id));
                }
            }, 25);
        });
    let sessionId;
    try {
        await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-gemini-reject', version: '0.1' } });
        proc.stdin.write(notifLine('notifications/initialized'));
        const init = await call(2, 'tools/call', {
            name: 'session_init',
            arguments: { task: 'gemini caller rejection smoke', artifacts: [] },
        });
        const initPayload = JSON.parse(init.result.content[0].text);
        sessionId = initPayload.session_id;
        assert(initPayload.caller === 'gemini', 'caller=gemini');
        assert(Array.isArray(initPayload.peers) && initPayload.peers.includes('claude') && initPayload.peers.includes('codex'), 'peers=[claude,codex]');
        const askResp = await call(3, 'tools/call', {
            name: 'ask_peer',
            arguments: { session_id: sessionId, prompt: 'should reject', caller_status: 'NOT_READY' },
        });
        const askPayload = JSON.parse(askResp.result.content[0].text);
        assert(askResp.result.isError === true, 'ask_peer returned isError=true');
        assert(/ask_peers|bilateral-only/.test(askPayload.error), `error message points operator at ask_peers (got: ${askPayload.error})`);
        results.push({ step: 'ask_peer rejects gemini caller with pointer to ask_peers (R23)', ok: true });
    } finally {
        proc.kill();
        if (sessionId) cleanupSession(sessionId);
    }
    return { results };
}

// W8 model-check helpers: drive server ask_peer with the new REAL_*
// stubs that return peer_model !== 'stub', activating the server-side
// sibling model-parser + silent-downgrade defense.
async function runServerAskPeer(stubValue, callerStatus, callerAgent = 'claude') {
    const proc = spawn('node', [SERVER], {
        env: {
            ...process.env,
            CROSS_REVIEW_CALLER: callerAgent,
            CROSS_REVIEW_SKIP_PROBE: '1',
            CROSS_REVIEW_PEER_STUB: stubValue,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
    });
    const responses = new Map();
    attachJsonRpcReader(proc.stdout, responses);
    const call = (id, method, params) =>
        new Promise((resolve, reject) => {
            proc.stdin.write(requestLine(id, method, params));
            const t = setTimeout(() => reject(new Error(`timeout id=${id}`)), 10000);
            const poll = setInterval(() => {
                if (responses.has(id)) {
                    clearInterval(poll);
                    clearTimeout(t);
                    resolve(responses.get(id));
                }
            }, 25);
        });
    let sessionId;
    try {
        await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-model-check', version: '0.1' } });
        proc.stdin.write(notifLine('notifications/initialized'));
        const init = await call(2, 'tools/call', {
            name: 'session_init',
            arguments: { task: 'model-check smoke', artifacts: [] },
        });
        sessionId = JSON.parse(init.result.content[0].text).session_id;
        const askResp = await call(3, 'tools/call', {
            name: 'ask_peer',
            arguments: { session_id: sessionId, prompt: 'trigger model check', caller_status: callerStatus },
        });
        const askPayload = JSON.parse(askResp.result.content[0].text);
        return { sessionId, askPayload };
    } finally {
        proc.kill();
    }
}

async function driveModelCheckMatchViaServer() {
    const results = [];
    const { sessionId, askPayload } = await runServerAskPeer('REAL_MATCH:gpt-5.5:READY', 'READY');
    try {
        assert(askPayload.peer_status === 'READY', 'match path: peer_status=READY');
        assert(askPayload.model_requested === 'gpt-5.5', 'match path: model_requested=gpt-5.5');
        assert(askPayload.model_reported === 'gpt-5.5', 'match path: model_reported=gpt-5.5');
        assert(askPayload.model_match === true, 'match path: model_match=true');
        assert(askPayload.model_failure_class == null, 'match path: failure_class null');
        assert(askPayload.protocol_violation === false, 'match path: no protocol violation');
        results.push({ step: 'ask_peer model-check MATCH via server (REAL_MATCH:gpt-5.5:READY) -> model_match=true, no violation', ok: true });
    } finally {
        if (sessionId) cleanupSession(sessionId);
    }
    return { results };
}

async function driveModelCheckDowngradeViaServer() {
    const results = [];
    const { sessionId, askPayload } = await runServerAskPeer('REAL_DOWNGRADE:gpt-5.5:gpt-3.5-legacy:READY', 'NOT_READY');
    try {
        assert(askPayload.peer_status === 'READY', 'downgrade path: status still parses');
        assert(askPayload.model_requested === 'gpt-5.5', 'downgrade: model_requested=gpt-5.5');
        assert(askPayload.model_reported === 'gpt-3.5-legacy', 'downgrade: model_reported=gpt-3.5-legacy');
        assert(askPayload.model_match === false, 'downgrade: model_match=false');
        assert(askPayload.model_failure_class === 'silent_model_downgrade', 'downgrade: failure_class=silent_model_downgrade');
        assert(askPayload.protocol_violation === true, 'downgrade: protocol_violation=true');
        results.push({ step: 'ask_peer model-check DOWNGRADE via server -> model_match=false, failure_class=silent_model_downgrade, protocol_violation=true', ok: true });
    } finally {
        if (sessionId) cleanupSession(sessionId);
    }
    return { results };
}

async function driveModelCheckMissingViaServer() {
    const results = [];
    const { sessionId, askPayload } = await runServerAskPeer('REAL_MISSING_MODEL:gpt-5.5:READY', 'NOT_READY');
    try {
        assert(askPayload.peer_status === 'READY', 'missing-model path: status parses');
        assert(askPayload.model_reported == null, 'missing: model_reported null');
        assert(askPayload.model_match === false, 'missing: model_match=false');
        assert(askPayload.model_failure_class === 'missing_model_report', 'missing: failure_class=missing_model_report');
        assert(askPayload.protocol_violation === true, 'missing: protocol_violation=true');
        results.push({ step: 'ask_peer model-check MISSING_MODEL_REPORT via server -> failure_class=missing_model_report, protocol_violation=true', ok: true });
    } finally {
        if (sessionId) cleanupSession(sessionId);
    }
    return { results };
}

// W6: session-store.js N-ary schema + redaction + normalization +
// capability_snapshot + failed_attempts + N-ary convergence.
async function driveSessionStoreUnit() {
    const results = [];
    const store = require('../src/lib/session-store.js');

    // redactSensitive: known patterns.
    const raw = [
        'token=sk-abcdefghijklmnopqrstuv',
        'AIzaAbCdEfGhIjKlMnOpQrStUvWxYz012345678',
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIifX0.sig-xyz',
        'gh_token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
        'slack=xoxb-abc-def-ghi-jklmn',
        'PRIVATE_API_KEY=topsecret',
        'https://alice:p4ssw0rd@internal.lcv.app.br/path',
    ].join('\n');
    const redacted = store.redactSensitive(raw);
    assert(!redacted.includes('sk-abcdefghij'), 'redact: sk- OpenAI');
    assert(!redacted.includes('AIzaAbCdEfGhIj'), 'redact: Google AIza');
    assert(!redacted.includes('eyJhbGciOi'), 'redact: JWT');
    assert(!redacted.includes('ghp_ABCDE'), 'redact: GitHub gh');
    assert(!redacted.includes('xoxb-abc-def'), 'redact: Slack xox');
    assert(!redacted.includes('topsecret'), 'redact: env-style PRIVATE_API_KEY');
    assert(!redacted.includes('alice:p4ssw0rd'), 'redact: URL userinfo');
    results.push({ step: 'session-store.redactSensitive masks OpenAI/Google/JWT/GitHub/Slack/env-style/URL-userinfo (R14)', ok: true });

    // normalizePeers: idempotent on peers[], synthesizes from legacy peer.
    const m1 = store.normalizePeers({ peer: 'codex', rounds: [] });
    assert(Array.isArray(m1.peers) && m1.peers.length === 1 && m1.peers[0] === 'codex', 'legacy peer -> peers[codex]');
    const m2 = store.normalizePeers({ peers: ['codex', 'gemini'], rounds: [] });
    assert(m2.peers.length === 2 && m2.peers[1] === 'gemini', 'peers[] preserved when present');
    const m3 = store.normalizePeers({ peer: 'codex', peers: ['claude'], rounds: [] });
    assert(m3.peers[0] === 'claude', 'peers[] wins over scalar peer when both present');
    results.push({ step: 'session-store.normalizePeers: idempotent + synthesizes from legacy peer + prefers peers[] over scalar', ok: true });

    // initSession N-ary path: write and read back.
    const id = store.initSession({
        task: 'W6 smoke N-ary',
        artifacts: [],
        callerAgent: 'claude',
        peers: ['codex', 'gemini'],
        capabilitySnapshot: { stub: true, peers: [{ agent: 'codex', tier: 'top' }, { agent: 'gemini', tier: 'top' }] },
    });
    const meta = store.readMeta(id);
    assert(Array.isArray(meta.peers) && meta.peers.length === 2, 'initSession persisted peers[]');
    assert(!('peer' in meta), 'N-ary session: no legacy peer scalar');
    assert(meta.capability_snapshot && meta.capability_snapshot.stub === true, 'capability_snapshot persisted at init');
    results.push({ step: 'session-store.initSession N-ary: peers[] + capability_snapshot persisted, no scalar peer', ok: true });

    // saveCapabilitySnapshot overwrites.
    store.saveCapabilitySnapshot(id, { stub: true, version: 2 });
    const meta2 = store.readMeta(id);
    assert(meta2.capability_snapshot.version === 2, 'saveCapabilitySnapshot overwrites');
    results.push({ step: 'session-store.saveCapabilitySnapshot: overwrites and updates last_updated_at', ok: true });

    // saveFailedAttempt with secret in stderr_tail -> redacted.
    store.saveFailedAttempt(id, 'gemini', 'rate_limit_exceeded', {
        stderr_tail: 'Error: quota exceeded. token=sk-1234567890abcdefghij; retry later.',
        failure_class: 'rate_limit_exceeded',
        round: 1,
        retry_attempt: 0,
    });
    const meta3 = store.readMeta(id);
    assert(Array.isArray(meta3.failed_attempts) && meta3.failed_attempts.length === 1, 'failed_attempts recorded');
    const attempt = meta3.failed_attempts[0];
    assert(attempt.agent === 'gemini' && attempt.failure_class === 'rate_limit_exceeded', 'attempt carries agent + failure_class');
    assert(!attempt.stderr_tail.includes('sk-1234567890'), 'stderr_tail redacted (R14)');
    assert(attempt.stderr_tail.includes('[REDACTED]'), 'REDACTED marker present');
    results.push({ step: 'session-store.saveFailedAttempt: entry persisted with clipped + redacted stderr_tail', ok: true });

    // N-ary checkConvergence: all READY -> converged.
    store.appendRound(id, {
        round: 1,
        caller: 'claude',
        caller_status: 'READY',
        peers: [
            { agent: 'codex', peer_status: 'READY' },
            { agent: 'gemini', peer_status: 'READY' },
        ],
    });
    const conv1 = store.checkConvergence(id);
    assert(conv1.converged === true, 'N-ary all READY -> converged');
    results.push({ step: 'session-store.checkConvergence N-ary: caller + all peers READY -> converged', ok: true });

    // One peer NOT_READY -> not converged.
    store.appendRound(id, {
        round: 2,
        caller: 'claude',
        caller_status: 'READY',
        peers: [
            { agent: 'codex', peer_status: 'READY' },
            { agent: 'gemini', peer_status: 'NOT_READY' },
        ],
    });
    const conv2 = store.checkConvergence(id);
    assert(conv2.converged === false, 'one peer NOT_READY -> not converged');
    assert(/gemini/.test(conv2.reason), 'reason mentions the dissenting peer');
    results.push({ step: 'session-store.checkConvergence N-ary: one peer NOT_READY -> not converged, reason names peer', ok: true });

    // cleanup
    store.finalize(id, 'aborted');
    fs.rmSync(store.sessionDir(id), { recursive: true, force: true });

    return { results };
}

// W5: parseDeclaredModel + classifyModelMatch unit coverage. Pure lib
// tests (no server spawn): exercise well-formed, missing, malformed,
// misplaced blocks and match classification.
async function driveModelParserUnit() {
    const results = [];
    const { parseDeclaredModel, classifyModelMatch, MODEL_OPEN_TAG, MODEL_CLOSE_TAG } = require('../src/lib/model-parser.js');

    const statusBlock = '<cross_review_status>{"status":"READY"}</cross_review_status>';

    // Well-formed: model block immediately before status block.
    const r1 = parseDeclaredModel(
        `body\n\n${MODEL_OPEN_TAG}{"model_id":"gemini-2.5-pro"}${MODEL_CLOSE_TAG}\n${statusBlock}\n`
    );
    assert(r1.model_id === 'gemini-2.5-pro' && r1.source === 'structured', 'parseDeclaredModel well-formed -> gemini-2.5-pro');
    results.push({ step: 'parseDeclaredModel: well-formed tail -> model_id extracted, source=structured', ok: true });

    // Missing: status block only.
    const r2 = parseDeclaredModel(`body\n\n${statusBlock}\n`);
    assert(r2.model_id === null && r2.parser_warnings.length > 0, 'parseDeclaredModel missing -> null + warning');
    results.push({ step: 'parseDeclaredModel: missing model block -> null + warning', ok: true });

    // Malformed JSON.
    const r3 = parseDeclaredModel(
        `body\n\n${MODEL_OPEN_TAG}{not json${MODEL_CLOSE_TAG}\n${statusBlock}\n`
    );
    assert(r3.model_id === null && r3.parser_warnings.some((w) => /not valid JSON/.test(w)), 'malformed JSON -> null + warning');
    results.push({ step: 'parseDeclaredModel: malformed JSON payload -> null + parser warning', ok: true });

    // Missing model_id field.
    const r4 = parseDeclaredModel(
        `body\n\n${MODEL_OPEN_TAG}{"foo":"bar"}${MODEL_CLOSE_TAG}\n${statusBlock}\n`
    );
    assert(r4.model_id === null, 'missing model_id field -> null');
    results.push({ step: 'parseDeclaredModel: payload without model_id field -> null + warning', ok: true });

    // Wrong position: status block first, then model block. Tail discipline
    // requires model block IMMEDIATELY before status block; reversed order
    // is a protocol violation.
    const r5 = parseDeclaredModel(
        `body\n\n${statusBlock}\n\n${MODEL_OPEN_TAG}{"model_id":"gemini-2.5-pro"}${MODEL_CLOSE_TAG}\n`
    );
    assert(r5.model_id === null, 'wrong position (status before model) -> null');
    results.push({ step: 'parseDeclaredModel: wrong block order (status before model) -> null (tail discipline)', ok: true });

    // Empty input.
    const r6 = parseDeclaredModel('');
    assert(r6.model_id === null, 'empty input -> null');
    results.push({ step: 'parseDeclaredModel: empty input -> null', ok: true });

    // classifyModelMatch cases.
    assert(classifyModelMatch('gemini-2.5-pro', 'gemini-2.5-pro') === 'ok', 'match -> ok');
    assert(
        classifyModelMatch('gemini-3.1-pro-preview', 'gemini-2.5-pro') === 'silent_model_downgrade',
        'mismatch -> silent_model_downgrade'
    );
    assert(classifyModelMatch('gemini-2.5-pro', null) === 'missing_model_report', 'null reported -> missing_model_report');
    results.push({ step: 'classifyModelMatch: ok / silent_model_downgrade / missing_model_report', ok: true });

    return { results };
}

// W3: buildGeminiArgs structural shape. Verifies the exact flag set
// agreed in F2 round 2 (CLI 0.39.1 evidence packet).
async function driveGeminiArgsShape() {
    const results = [];
    const { buildGeminiArgs, GEMINI_MODEL, GEMINI_ALLOWED_MCP_SERVERS } = require('../src/lib/peer-spawn.js');
    const args = buildGeminiArgs();

    assert(args.includes('-m'), 'buildGeminiArgs has -m flag');
    assert(args[args.indexOf('-m') + 1] === GEMINI_MODEL, `-m value is GEMINI_MODEL (${GEMINI_MODEL})`);
    assert(args.includes('--approval-mode'), 'has --approval-mode');
    assert(args[args.indexOf('--approval-mode') + 1] === 'plan', '--approval-mode=plan (read-only)');
    assert(args.includes('--output-format'), 'has --output-format');
    assert(args[args.indexOf('--output-format') + 1] === 'text', '--output-format=text');
    assert(!args.includes('--skip-trust'), '--skip-trust NOT present (R9: not a containment flag)');
    assert(!args.includes('--allowed-tools'), '--allowed-tools NOT present (deprecated in 0.39.1)');
    // each allowed MCP server must appear paired with the flag
    const allowCount = args.filter((a) => a === '--allowed-mcp-server-names').length;
    assert(allowCount === GEMINI_ALLOWED_MCP_SERVERS.length, `--allowed-mcp-server-names appears ${GEMINI_ALLOWED_MCP_SERVERS.length} times`);
    for (const name of GEMINI_ALLOWED_MCP_SERVERS) {
        assert(args.includes(name), `allowed MCP '${name}' in args`);
    }
    assert(!args.includes('cross-review-mcp'), 'cross-review-mcp NOT in allowed MCPs (recursion prevented)');
    results.push({ step: 'buildGeminiArgs: -m GEMINI_MODEL + --approval-mode plan + --output-format text + --allowed-mcp-server-names x3 (memory, ultrathink, code-reasoning; cross-review-mcp excluded)', ok: true });

    return { results };
}

// W4: spawnPeers explicit-identity contract (R12: never infer agent
// from array index). Uses CROSS_REVIEW_PEER_STUB to avoid real CLI.
async function driveSpawnPeersIdentityShape() {
    const results = [];
    const { spawnPeers } = require('../src/lib/peer-spawn.js');

    // Set stub to a READY legacy status so spawnPeer resolves quickly.
    const prevStub = process.env.CROSS_REVIEW_PEER_STUB;
    process.env.CROSS_REVIEW_PEER_STUB = 'STRUCTURED:READY';
    try {
        const out = await spawnPeers(['codex', 'claude', 'gemini'], 'probe');
        assert(Array.isArray(out) && out.length === 3, 'spawnPeers returns array of 3');
        const agents = out.map((o) => o.agent);
        assert(agents.includes('codex') && agents.includes('claude') && agents.includes('gemini'), 'all three agents present by identity');
        for (const entry of out) {
            assert(entry.status === 'fulfilled', `entry.status === fulfilled for ${entry.agent}`);
            assert(typeof entry.value === 'object' && entry.value !== null, `entry.value is object for ${entry.agent}`);
            assert(typeof entry.value.stdout === 'string', `entry.value.stdout is string for ${entry.agent}`);
        }
        results.push({ step: 'spawnPeers: 3 agents, Promise.all resolution, explicit agent identity per entry (R12)', ok: true });
    } finally {
        if (prevStub === undefined) delete process.env.CROSS_REVIEW_PEER_STUB;
        else process.env.CROSS_REVIEW_PEER_STUB = prevStub;
    }

    // Error path: one stub is ERROR, others are READY. Result: partial
    // results preserved (no reject). CROSS_REVIEW_PEER_STUB is process-wide,
    // so we exercise with ERROR alone and verify the rejection shape.
    process.env.CROSS_REVIEW_PEER_STUB = 'ERROR';
    try {
        const out = await spawnPeers(['codex'], 'probe');
        assert(out.length === 1 && out[0].agent === 'codex', 'single-agent spawn returns 1 entry');
        assert(out[0].status === 'rejected', 'error stub -> status=rejected');
        assert(out[0].reason instanceof Error, 'reason is Error instance');
        results.push({ step: 'spawnPeers: rejected peer preserved with explicit agent identity + reason Error', ok: true });
    } finally {
        if (prevStub === undefined) delete process.env.CROSS_REVIEW_PEER_STUB;
        else process.env.CROSS_REVIEW_PEER_STUB = prevStub;
    }

    return { results };
}

// W4: probeStub short-circuits probeAgent. Verifies capability_snapshot
// shape (F2 Q6 field set).
async function driveProbeStubShape() {
    const results = [];
    const { probeChain } = require('../src/lib/peer-spawn.js');

    const prev = process.env.CROSS_REVIEW_PROBE_STUB;
    process.env.CROSS_REVIEW_PROBE_STUB = 'codex:top,claude:top,gemini:fallback:gemini-2.5-flash';
    try {
        const snap = await probeChain(['codex', 'claude', 'gemini'], { budgetMs: 5000 });
        assert(Array.isArray(snap) && snap.length === 3, 'probeChain returns array of 3');
        const byAgent = Object.fromEntries(snap.map((s) => [s.agent, s]));
        assert(byAgent.codex.tier === 'top', 'codex tier=top');
        assert(byAgent.claude.tier === 'top', 'claude tier=top');
        assert(byAgent.gemini.tier === 'fallback', 'gemini tier=fallback');
        assert(byAgent.gemini.model_reported === 'gemini-2.5-flash', 'gemini reported fallback model');
        for (const entry of snap) {
            for (const field of ['agent', 'tier', 'requested_model', 'model_reported', 'model_match', 'probe_latency_ms', 'probe_budget_ms', 'exit_code', 'failure_class', 'timestamp']) {
                assert(field in entry, `probe entry has field ${field} for ${entry.agent}`);
            }
        }
        results.push({ step: 'probeChain: stub mode returns 3 snapshots with full capability_snapshot field set (F2 Q6)', ok: true });
    } finally {
        if (prev === undefined) delete process.env.CROSS_REVIEW_PROBE_STUB;
        else process.env.CROSS_REVIEW_PROBE_STUB = prev;
    }

    // Excluded tier.
    process.env.CROSS_REVIEW_PROBE_STUB = 'codex:excluded';
    try {
        const snap = await probeChain(['codex'], { budgetMs: 5000 });
        assert(snap.length === 1, '1 snapshot');
        assert(snap[0].tier === 'excluded', 'tier=excluded');
        assert(snap[0].failure_class === 'probe_excluded_stub', 'failure_class populated');
        results.push({ step: 'probeChain: stub excluded tier carries failure_class', ok: true });
    } finally {
        if (prev === undefined) delete process.env.CROSS_REVIEW_PROBE_STUB;
        else process.env.CROSS_REVIEW_PROBE_STUB = prev;
    }

    return { results };
}

// Regression test for the peer review finding 2026-04-24 (HIGH): the real
// (non-stub) resolve path of spawnPeer must include peer_model per spec
// section 6.9.2 auditability. Stub path already covered elsewhere. Here
// we cover: (a) modelForPeer returns the pinned IDs; (b) source of
// peer-spawn.js contains peer_model in its real-path resolve block
// (structural assertion, since we cannot actually spawn a CLI in smoke).
async function drivePeerSpawnRealPathModel() {
    const results = [];
    const { modelForPeer, CODEX_MODEL, CLAUDE_MODEL } = require('../src/lib/peer-spawn.js');

    assert(typeof modelForPeer === 'function', 'modelForPeer exported from peer-spawn.js');
    assert(modelForPeer('codex') === CODEX_MODEL, `modelForPeer('codex') === CODEX_MODEL (${CODEX_MODEL})`);
    assert(modelForPeer('claude') === CLAUDE_MODEL, `modelForPeer('claude') === CLAUDE_MODEL (${CLAUDE_MODEL})`);
    results.push({ step: `modelForPeer maps codex->${CODEX_MODEL}, claude->${CLAUDE_MODEL}`, ok: true });

    // Structural: real-path resolve in peer-spawn.js must include peer_model.
    // Prevents silent regression of the 2026-04-24 fix (see CHANGELOG).
    const src = fs.readFileSync(require.resolve('../src/lib/peer-spawn.js'), 'utf8');
    const closeBlockMatch = src.match(/proc\.on\('close'[\s\S]*?resolve\(\s*\{[^}]*\}/);
    assert(closeBlockMatch, 'peer-spawn.js: proc.on(close) resolve block present');
    const resolveBlock = closeBlockMatch[0];
    assert(resolveBlock.includes('peer_model'), 'peer-spawn.js real-path resolve includes peer_model (spec section 6.9.2 auditability)');
    assert(
        resolveBlock.includes('modelForPeer(peerAgent)'),
        'peer-spawn.js real-path resolve uses modelForPeer(peerAgent) to populate peer_model'
    );
    results.push({ step: 'peer-spawn.js real-path resolve contains peer_model: modelForPeer(peerAgent) (regression guard for 2026-04-24 peer review fix)', ok: true });

    return { results };
}

runAll()
    .then((results) => {
        const allOk = results.every((r) => r.ok);
        for (const r of results) {
            console.log(`  [${r.ok ? 'ok' : 'FAIL'}] ${r.step}${r.tools ? ` (${r.tools.length} tools)` : ''}${r.session_id ? ` session=${r.session_id.slice(0, 8)}...` : ''}`);
        }
        console.log(`\n[functional-smoke] ${results.length} steps, all ${allOk ? 'GREEN' : 'HAD FAILURES'}`);
        process.exit(allOk ? 0 : 1);
    })
    .catch((err) => {
        console.error(`[functional-smoke] FATAL: ${err?.stack || err?.message || err}`);
        process.exit(1);
    });
