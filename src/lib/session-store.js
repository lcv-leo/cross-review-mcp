// Session state in ~/.cross-review/<session-id>/. Atomic writes via
// temp+rename. Lock via atomic mkdir (POSIX and Windows) with TTL + PID.
//
// Schema evolution (v0.5.0-alpha, F2 W6):
//   - `peers` array (N-ary) alongside legacy `peer` scalar (v0.4.0 and
//     earlier). Read-time normalization: if `peer` is present and
//     `peers` is absent, synthesize `peers = [peer]`. Writes always
//     populate `peers`; `peer` is retained when set legacy-style for
//     backwards-compat read paths.
//   - `capability_snapshot` session-level (set at session_init via
//     probeChain); NEVER per-round (R17 / spec v4.8 section 6.9.3).
//     Excluded peers live here; they are NOT in round.peers[].
//   - `failed_attempts` array: transient spawn/retry failures (spec v4.8
//     section 6.9.3.6). Each entry carries agent + reason class +
//     redacted stderr_tail + timestamp.
//   - Round schema accepts either legacy `{peer, peer_status, ...}` or
//     N-ary `{peers: [{agent, peer_status, ...}], quorum: {...}}`. Both
//     coexist until v0.6.0-alpha retires the legacy form.
//
// Redaction (R14): `saveFailedAttempt` strips known secret shapes from
// stderr/prompt snippets before persistence. Patterns include OpenAI sk-,
// Google AIza, GitHub gh_, JWT eyJ.*.*, Slack xox[baprs]-, PEM blocks,
// user:pass URLs, and env-style TOKEN/SECRET/PASSWORD/API_KEY/PRIVATE_KEY
// assignments.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const STATE_DIR = path.join(os.homedir(), '.cross-review');
const LOCK_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_STDERR_TAIL_CHARS = 2000;
const REDACTED = '[REDACTED]';

function ensureStateDir() {
    fs.mkdirSync(STATE_DIR, { recursive: true });
}

function sessionDir(sessionId) {
    return path.join(STATE_DIR, sessionId);
}

function atomicWriteFile(filePath, content) {
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
}

function acquireLock(sessionId) {
    const lockDir = path.join(sessionDir(sessionId), '.lock');
    try {
        fs.mkdirSync(lockDir);
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try {
            const infoPath = path.join(lockDir, 'info.json');
            const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
            const age = Date.now() - Date.parse(info.acquired_at);
            if (age > LOCK_TTL_MS) {
                fs.rmSync(lockDir, { recursive: true, force: true });
                fs.mkdirSync(lockDir);
            } else {
                return false;
            }
        } catch {
            fs.rmSync(lockDir, { recursive: true, force: true });
            fs.mkdirSync(lockDir);
        }
    }
    atomicWriteFile(
        path.join(lockDir, 'info.json'),
        JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }, null, 2)
    );
    return true;
}

function releaseLock(sessionId) {
    const lockDir = path.join(sessionDir(sessionId), '.lock');
    try {
        fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
        // silent
    }
}

// Redaction patterns (R14, F2 round 2). Applied to stderr tails and any
// snippet persisted to disk before the operator sees it. Patterns are
// intentionally conservative -- we prefer false-positive redaction over
// leaking a real secret. Add patterns here when a new shape is observed
// in the wild.
const REDACTION_PATTERNS = [
    { name: 'openai_sk', re: /sk-[A-Za-z0-9_-]{20,}/g },
    { name: 'google_aiza', re: /AIza[0-9A-Za-z_-]{35}/g },
    { name: 'github_gh', re: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
    { name: 'slack_xox', re: /xox[baprs]-[A-Za-z0-9-]+/g },
    { name: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
    { name: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]+/g },
    { name: 'pem_block', re: /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g },
    { name: 'url_userpass', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/g },
    { name: 'env_assign', re: /\b(?:[A-Z][A-Z0-9_]*_(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY))\s*[:=]\s*['"]?[^\s'"]+['"]?/g },
];

function redactSensitive(text) {
    if (typeof text !== 'string' || !text.length) return text;
    let out = text;
    for (const { re } of REDACTION_PATTERNS) {
        out = out.replace(re, REDACTED);
    }
    return out;
}

function clipStderrTail(text) {
    if (typeof text !== 'string') return '';
    const trimmed = text.slice(-MAX_STDERR_TAIL_CHARS);
    return redactSensitive(trimmed);
}

function normalizePeers(meta) {
    // Idempotent: if meta already has peers[], leave it; else synthesize
    // from legacy `peer` scalar. Prefer peers[] when both are present
    // and disagree (emits a warning side-channel for observability).
    if (!meta || typeof meta !== 'object') return meta;
    if (Array.isArray(meta.peers) && meta.peers.length > 0) {
        return meta;
    }
    if (typeof meta.peer === 'string' && meta.peer.length > 0) {
        meta.peers = [meta.peer];
    }
    return meta;
}

function initSession({ task, artifacts, callerAgent, peerAgent, peers, capabilitySnapshot, callerResolution }) {
    ensureStateDir();
    const id = crypto.randomUUID();
    fs.mkdirSync(sessionDir(id), { recursive: true });

    let peersArray;
    if (Array.isArray(peers) && peers.length > 0) {
        peersArray = peers.map(String);
    } else if (typeof peerAgent === 'string' && peerAgent.length > 0) {
        peersArray = [peerAgent];
    } else {
        peersArray = [];
    }

    const meta = {
        session_id: id,
        spec_version: SESSION_SPEC_VERSION,
        task: String(task || ''),
        artifacts: Array.isArray(artifacts) ? artifacts.map(String) : [],
        caller: callerAgent,
        peers: peersArray,
        started_at: new Date().toISOString(),
        rounds: [],
        failed_attempts: [],
        outcome: null,
        outcome_reason: null,
    };

    // Backwards-compat: when exactly one peer is registered, also
    // populate the legacy `peer` scalar so pre-v0.5.0 readers still see
    // the field. Drop the scalar for true N-ary sessions (N >= 2).
    if (peersArray.length === 1) {
        meta.peer = peersArray[0];
    }

    if (capabilitySnapshot && typeof capabilitySnapshot === 'object') {
        meta.capability_snapshot = capabilitySnapshot;
    }

    // v1.2.0 / spec v4.14 §6.20: caller_resolution audit field. When the
    // caller is provided by the dynamic resolver, record HOW it was resolved
    // (arg | client_info | env_var) so audit consumers can distinguish
    // explicit overrides from inferred defaults. Optional — sessions opened
    // by code paths that don't pass it will have meta.caller_resolution
    // omitted (treated as 'env_var' by audit tools per backwards compat).
    if (callerResolution && typeof callerResolution === 'object') {
        meta.caller_resolution = {
            source: String(callerResolution.source || 'unknown'),
            client_info_name: callerResolution.client_info_name == null
                ? null
                : String(callerResolution.client_info_name),
        };
    }

    atomicWriteFile(
        path.join(sessionDir(id), 'meta.json'),
        JSON.stringify(meta, null, 2)
    );
    return id;
}

function readMeta(sessionId) {
    const p = path.join(sessionDir(sessionId), 'meta.json');
    if (!fs.existsSync(p)) {
        throw new Error(`session not found: ${sessionId}`);
    }
    const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
    return normalizePeers(meta);
}

function writeMeta(sessionId, meta) {
    atomicWriteFile(
        path.join(sessionDir(sessionId), 'meta.json'),
        JSON.stringify(meta, null, 2)
    );
}

// v0.6.0-alpha / spec v4.9 (Item B): strict-only convergence + persisted
// snapshot. The snapshot is computed at append time from the round data +
// session context (capability_snapshot + failed_attempts), then attached
// to the round as `round.convergence_snapshot`. checkConvergence prefers
// the persisted snapshot; no recomputation for v4.9+ rounds. Rounds from
// pre-v4.9 sessions fall through to derive-on-read legacy path.
const CONVERGENCE_SPEC_VERSION = 'v4.9';

// Spec version active at session creation. Persisted into meta.spec_version so
// post-hoc audits can reconstruct which spec rules were in force when a given
// session ran. Independent from CONVERGENCE_SPEC_VERSION (which marks the
// convergence-snapshot semantic) so they can evolve at different cadences.
// Bumped per spec evolution: v4.13 adds §6.17 spec_version field, §6.18
// session_sweep + outcome_reason, §6.19 convergence_health.
const SESSION_SPEC_VERSION = 'v4.14';

function computeConvergenceSnapshot(roundIndex, round, context = {}) {
    const excludedProbe = Array.isArray(context.excluded_probe)
        ? [...context.excluded_probe]
        : [];
    const excludedRuntime = Array.isArray(context.excluded_runtime)
        ? [...context.excluded_runtime]
        : [];
    const callerReady = round.caller_status === 'READY';

    // N-ary path (ask_peers rounds).
    if (Array.isArray(round.peers) && round.peers.length > 0 && !('peer_status' in round)) {
        const respondedPeers = round.peers.map((p) => p.agent);
        const readyPeers = round.peers
            .filter((p) => p.peer_status === 'READY')
            .map((p) => p.agent);
        const blockingPeers = round.peers
            .filter((p) => p.peer_status !== 'READY')
            .map((p) => ({
                agent: p.agent,
                reason: classifyBlocking(p),
            }));
        const allPeersReady =
            round.peers.length > 0 && round.peers.every((p) => p.peer_status === 'READY');
        const converged = callerReady && allPeersReady;
        return {
            round_index: roundIndex,
            spec_version: CONVERGENCE_SPEC_VERSION,
            denominator_mode: 'strict',
            caller_status: round.caller_status ?? null,
            responded_peers: respondedPeers,
            excluded_probe: excludedProbe,
            excluded_runtime: excludedRuntime,
            ready_peers: readyPeers,
            blocking_peers: blockingPeers,
            converged,
        };
    }

    // Legacy bilateral path (ask_peer rounds with scalar `peer`/`peer_status`).
    const peerReady = round.peer_status === 'READY';
    const agent = round.peer || null;
    const respondedPeers = agent ? [agent] : [];
    const readyPeers = peerReady && agent ? [agent] : [];
    const blockingPeers = peerReady
        ? []
        : [{
              agent,
              reason: classifyBlockingLegacy(round),
          }];
    return {
        round_index: roundIndex,
        spec_version: CONVERGENCE_SPEC_VERSION,
        denominator_mode: 'strict',
        caller_status: round.caller_status ?? null,
        responded_peers: respondedPeers,
        excluded_probe: excludedProbe,
        excluded_runtime: excludedRuntime,
        ready_peers: readyPeers,
        blocking_peers: blockingPeers,
        converged: callerReady && peerReady,
    };
}

function classifyBlocking(peer) {
    if (peer.peer_status === 'NEEDS_EVIDENCE') return 'NEEDS_EVIDENCE';
    if (peer.peer_status === 'NOT_READY') return 'NOT_READY';
    return 'status_missing';
}

function classifyBlockingLegacy(round) {
    if (round.peer_status === 'NEEDS_EVIDENCE') return 'NEEDS_EVIDENCE';
    if (round.peer_status === 'NOT_READY') return 'NOT_READY';
    return 'status_missing';
}

function collectSessionExclusions(meta, roundIndex) {
    const excludedProbe = (meta.capability_snapshot?.peers || [])
        .filter((p) => p.tier === 'offline' || p.tier === 'excluded')
        .map((p) => p.agent);
    const excludedRuntime = (meta.failed_attempts || [])
        .filter((fa) => Number(fa.round) === Number(roundIndex))
        .map((fa) => fa.agent);
    return { excluded_probe: excludedProbe, excluded_runtime: excludedRuntime };
}

function appendRound(sessionId, round) {
    const meta = readMeta(sessionId);
    const roundIndex = meta.rounds.length + 1;
    const context = collectSessionExclusions(meta, roundIndex);
    round.convergence_snapshot = computeConvergenceSnapshot(roundIndex, round, context);
    meta.rounds.push(round);
    meta.last_updated_at = new Date().toISOString();
    writeMeta(sessionId, meta);
}

function saveCapabilitySnapshot(sessionId, snapshot) {
    const meta = readMeta(sessionId);
    meta.capability_snapshot = snapshot;
    meta.last_updated_at = new Date().toISOString();
    writeMeta(sessionId, meta);
}

function saveFailedAttempt(sessionId, agent, reason, extras = {}) {
    const meta = readMeta(sessionId);
    if (!Array.isArray(meta.failed_attempts)) meta.failed_attempts = [];
    const entry = {
        agent: String(agent || 'unknown'),
        reason: String(reason || 'unspecified'),
        timestamp: new Date().toISOString(),
    };
    if (extras.stderr_tail != null) {
        entry.stderr_tail = clipStderrTail(String(extras.stderr_tail));
    }
    if (extras.failure_class != null) {
        entry.failure_class = String(extras.failure_class);
    }
    if (extras.round != null) {
        entry.round = Number(extras.round);
    }
    if (extras.retry_attempt != null) {
        entry.retry_attempt = Number(extras.retry_attempt);
    }
    // v0.6.0-alpha / spec v4.9 (Item C): rate-limit audit fields. Only
    // persisted when set — absent entries preserve v0.5.0-alpha shape.
    if (extras.retry_after_seconds != null) {
        entry.retry_after_seconds = Number(extras.retry_after_seconds);
    }
    if (extras.detection_source != null) {
        entry.detection_source = String(extras.detection_source);
    }
    if (extras.lexeme_matched != null) {
        entry.lexeme_matched = String(extras.lexeme_matched);
    }
    meta.failed_attempts.push(entry);
    meta.last_updated_at = new Date().toISOString();
    writeMeta(sessionId, meta);
    return entry;
}

function savePromptForRound(sessionId, roundNum, prompt) {
    const fname = `round-${String(roundNum).padStart(2, '0')}-prompt.md`;
    atomicWriteFile(path.join(sessionDir(sessionId), fname), String(prompt));
    return fname;
}

function savePeerResponse(sessionId, roundNum, peerAgent, content, status) {
    const fname = `round-${String(roundNum).padStart(2, '0')}-peer-${peerAgent}.md`;
    const header = `<!-- round=${roundNum} peer=${peerAgent} status=${status ?? 'MISSING'} -->\n`;
    atomicWriteFile(path.join(sessionDir(sessionId), fname), header + String(content));
    return fname;
}

// Strict-only convergence predicate (v0.6.0-alpha / spec v4.9, Item B):
//   converged iff caller_status === READY AND for every responded peer
//   the peer_status === READY. status_missing counts AGAINST (strict).
//   Excluded peers (probe-level) never enter rounds; failed-spawn peers
//   (runtime level) are recorded in failed_attempts and excluded from
//   denominator.
//
// v0.6.0-alpha change: appendRound persists `round.convergence_snapshot`
// with spec_version 'v4.9' at append time. checkConvergence PREFERS the
// persisted snapshot (immutable audit) and falls back to computing it
// on-read only for pre-v4.9 rounds that lack the field.
//
// Supports two round shapes:
//   LEGACY bilateral: {peer, peer_status, caller_status}
//   N-ary: {peers: [{agent, peer_status}], caller_status}
function checkConvergence(sessionId) {
    const meta = readMeta(sessionId);
    if (!meta.rounds.length) {
        return {
            converged: false,
            reason: 'no rounds yet',
            caller_status: null,
            peer_status: null,
            last_round: null,
        };
    }
    const last = meta.rounds[meta.rounds.length - 1];
    const lastIndex = meta.rounds.length;

    // Prefer persisted snapshot (v4.9+). Derive-on-read for legacy rounds
    // that predate the snapshot.
    const snapshot = last.convergence_snapshot
        || computeConvergenceSnapshot(lastIndex, last, collectSessionExclusions(meta, lastIndex));

    const reason = buildConvergenceReason(snapshot, last);

    // Preserve the two response shapes (N-ary vs legacy bilateral) for
    // backward-compat with pre-v0.6.0 callers, plus add convergence_snapshot.
    if (Array.isArray(last.peers) && last.peers.length > 0 && !('peer_status' in last)) {
        return {
            converged: snapshot.converged,
            caller_status: last.caller_status,
            peers: last.peers,
            last_round: last,
            reason,
            convergence_snapshot: snapshot,
        };
    }
    return {
        converged: snapshot.converged,
        caller_status: last.caller_status,
        peer_status: last.peer_status,
        peer_structured: last.peer_structured ?? null,
        last_round: last,
        reason,
        convergence_snapshot: snapshot,
    };
}

function buildConvergenceReason(snapshot, round) {
    const callerReady = snapshot.caller_status === 'READY';
    const isLegacyBilateral =
        round && !Array.isArray(round.peers) && 'peer_status' in round;

    if (snapshot.converged) {
        if (isLegacyBilateral) {
            return 'both caller and peer declared READY in the same round';
        }
        const n = snapshot.ready_peers.length;
        return `caller and all ${n} peer${n === 1 ? '' : 's'} declared READY in the same round`;
    }

    // Legacy bilateral: preserve the v0.5.0-alpha reason-text shapes so
    // smoke regex assertions remain stable.
    if (isLegacyBilateral) {
        const peerStatus = round.peer_status ?? 'MISSING';
        const callerStatus = snapshot.caller_status ?? 'MISSING';
        if (peerStatus === 'NEEDS_EVIDENCE') {
            return `peer declared NEEDS_EVIDENCE (caller=${callerStatus}); attach the requested evidence next round instead of re-arguing merits`;
        }
        if (callerReady && peerStatus !== 'READY') {
            return `caller READY but peer is ${peerStatus}; needs another round`;
        }
        if (!callerReady && peerStatus === 'READY') {
            return `peer READY but caller declared ${callerStatus}; caller must concur`;
        }
        return `neither side READY (caller=${callerStatus}, peer=${peerStatus})`;
    }

    // N-ary path.
    if (!callerReady) {
        return `caller is ${snapshot.caller_status ?? 'MISSING'}; caller must concur with peers`;
    }
    if (snapshot.blocking_peers.length === 0) {
        return `no responded peers (responded=${snapshot.responded_peers.length}, excluded_runtime=${snapshot.excluded_runtime.length})`;
    }
    const needsEvidence = snapshot.blocking_peers.filter((b) => b.reason === 'NEEDS_EVIDENCE');
    if (needsEvidence.length > 0) {
        const ne = needsEvidence.map((b) => b.agent).join(',');
        return `peer(s) ${ne} declared NEEDS_EVIDENCE; attach requested evidence next round`;
    }
    const parts = snapshot.blocking_peers.map((b) => `${b.agent}=${b.reason}`);
    return `peer(s) not READY: ${parts.join(', ')}`;
}

// v1.1.0 / spec v4.13 §6.18: optional `reason` enables structured "why" for
// the outcome (e.g., 'stale' for sweeper-finalized sessions, 'peer_scope_creep'
// for intentional rollback aborts, 'moderation_flag_unresolved' for the
// 5-attempt cap from §6.16). Stored as meta.outcome_reason. null means
// unset/legacy.
function finalize(sessionId, outcome, reason = null) {
    const meta = readMeta(sessionId);
    meta.outcome = outcome;
    meta.outcome_reason = reason == null ? null : String(reason);
    meta.finalized_at = new Date().toISOString();
    writeMeta(sessionId, meta);
}

// v1.1.0 / spec v4.13 §6.18 long-idle session reconciliation.

// 24h hard floor: sessions younger than this are NEVER candidates regardless
// of staleDays argument. Footgun guard — prevents accidentally finalizing a
// session the operator just opened.
const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_DEFAULT_STALE_DAYS = 7;

// Compute last-activity timestamp from meta. Last activity = max of
// started_at, all rounds[].started_at, all rounds[].completed_at. A 30-round
// session whose last round finished an hour ago is NOT long-idle even if
// started_at is months in the past. Returns ISO string OR null when all
// candidate timestamps are unparseable.
function lastActivityAt(meta) {
    const candidates = [];
    if (meta?.started_at) candidates.push(meta.started_at);
    for (const r of (meta?.rounds || [])) {
        if (r?.started_at) candidates.push(r.started_at);
        if (r?.completed_at) candidates.push(r.completed_at);
    }
    let bestTs = null;
    let bestMs = -Infinity;
    for (const c of candidates) {
        const ms = Date.parse(c);
        if (Number.isFinite(ms) && ms > bestMs) {
            bestMs = ms;
            bestTs = c;
        }
    }
    return bestTs;
}

// listStaleSessions({ staleDays = 7, now = Date.now() }):
// Walks ~/.cross-review/<id>/meta.json. Returns rows describing every session
// that COULD be a sweep target — including ones that ultimately would not be
// finalized (locked, malformed_timestamp). Sessions younger than the 24h hard
// floor are excluded entirely (do not even appear as skipped). Already
// finalized sessions are excluded entirely.
//
// Row shape: { session_id, last_activity_at, age_days, has_rounds, locked,
//              would_finalize, skip_reason? }
//
// `now` is parameterizable for deterministic tests.
function listStaleSessions({ staleDays = SWEEP_DEFAULT_STALE_DAYS, now = Date.now() } = {}) {
    ensureStateDir();
    const staleMs = staleDays * 24 * 60 * 60 * 1000;
    const out = [];
    let entries;
    try {
        entries = fs.readdirSync(STATE_DIR);
    } catch {
        return out;
    }
    for (const id of entries) {
        // session UUIDs are 36 chars (8-4-4-4-12 + 4 dashes); skip anything else.
        if (typeof id !== 'string' || id.length !== 36) continue;
        const metaPath = path.join(sessionDir(id), 'meta.json');
        let meta;
        try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch {
            // Corrupt or missing meta.json — never auto-finalize.
            out.push({
                session_id: id,
                last_activity_at: null,
                age_days: null,
                has_rounds: null,
                locked: false,
                would_finalize: false,
                skip_reason: 'malformed_meta',
            });
            continue;
        }
        // Already finalized: never a candidate.
        if (meta.outcome != null) continue;

        const lastTs = lastActivityAt(meta);
        if (!lastTs) {
            out.push({
                session_id: id,
                last_activity_at: null,
                age_days: null,
                has_rounds: Array.isArray(meta.rounds) && meta.rounds.length > 0,
                locked: fs.existsSync(path.join(sessionDir(id), '.lock')),
                would_finalize: false,
                skip_reason: 'malformed_timestamp',
            });
            continue;
        }
        const ageMs = now - Date.parse(lastTs);
        // 24h hard floor — silently exclude. Operator should not see these
        // even as skipped rows.
        if (ageMs < SWEEP_MIN_AGE_MS) continue;
        if (ageMs < staleMs) continue;

        const locked = fs.existsSync(path.join(sessionDir(id), '.lock'));
        const ageDays = ageMs / (24 * 60 * 60 * 1000);
        const row = {
            session_id: id,
            last_activity_at: lastTs,
            age_days: Number(ageDays.toFixed(2)),
            has_rounds: Array.isArray(meta.rounds) && meta.rounds.length > 0,
            locked,
            would_finalize: !locked,
        };
        if (locked) row.skip_reason = 'locked';
        out.push(row);
    }
    return out;
}

// finalizeIfUnset(sessionId, outcome, reason):
// Re-reads meta and only writes if meta.outcome is still null. Prevents
// clobbering a session that got finalized concurrently (e.g., by another
// terminal between candidate enumeration and the finalize loop).
// Returns true if the write happened, false if outcome was already set.
function finalizeIfUnset(sessionId, outcome, reason = null) {
    let meta;
    try {
        meta = readMeta(sessionId);
    } catch {
        return false;
    }
    if (meta.outcome != null) return false;
    meta.outcome = outcome;
    meta.outcome_reason = reason == null ? null : String(reason);
    meta.finalized_at = new Date().toISOString();
    writeMeta(sessionId, meta);
    return true;
}

// sweepStaleSessions({ staleDays, dryRun, reason, now }):
// Wraps listStaleSessions + finalize. Returns { candidates, finalized }.
// finalized is empty when dryRun=true. would_finalize=false rows are never
// finalized. Uses finalizeIfUnset to guarantee re-read-before-write semantics.
function sweepStaleSessions({
    staleDays = SWEEP_DEFAULT_STALE_DAYS,
    dryRun = true,
    reason = 'stale',
    now = Date.now(),
} = {}) {
    const candidates = listStaleSessions({ staleDays, now });
    const finalized = [];
    if (!dryRun) {
        for (const row of candidates) {
            if (!row.would_finalize) continue;
            const wrote = finalizeIfUnset(row.session_id, 'aborted', reason);
            if (wrote) {
                finalized.push({
                    session_id: row.session_id,
                    outcome: 'aborted',
                    outcome_reason: reason,
                });
            }
        }
    }
    return { candidates, finalized };
}

// v0.7.0-alpha / spec v4.10 Item D: operator escalation record.
// Called when an agent has exhausted peer-exchange evidence gathering and
// still lacks information to answer. The MCP server persists the escalation
// under meta.escalations[]; the caller orchestrator (Claude Code) surfaces
// the question to the operator via chat. Returns the escalation record.
function saveEscalation(sessionId, fromAgent, question, context) {
    const meta = readMeta(sessionId);
    if (!Array.isArray(meta.escalations)) meta.escalations = [];
    const entry = {
        escalation_id: crypto.randomUUID(),
        from_agent: String(fromAgent || 'unknown'),
        question: String(question || ''),
        context: context == null ? null : String(context),
        round_index: meta.rounds?.length || 0,
        timestamp: new Date().toISOString(),
    };
    meta.escalations.push(entry);
    meta.last_updated_at = new Date().toISOString();
    writeMeta(sessionId, meta);
    return entry;
}

module.exports = {
    STATE_DIR,
    ensureStateDir,
    sessionDir,
    initSession,
    readMeta,
    writeMeta,
    appendRound,
    savePromptForRound,
    savePeerResponse,
    saveCapabilitySnapshot,
    saveFailedAttempt,
    checkConvergence,
    finalize,
    saveEscalation,
    acquireLock,
    releaseLock,
    // Exported for tests and ad-hoc audit.
    normalizePeers,
    redactSensitive,
    clipStderrTail,
    REDACTION_PATTERNS,
    MAX_STDERR_TAIL_CHARS,
    // v0.6.0-alpha / spec v4.9 additions.
    computeConvergenceSnapshot,
    collectSessionExclusions,
    CONVERGENCE_SPEC_VERSION,
    // v1.1.0 / spec v4.13 additions.
    SESSION_SPEC_VERSION,
    SWEEP_MIN_AGE_MS,
    SWEEP_DEFAULT_STALE_DAYS,
    lastActivityAt,
    listStaleSessions,
    sweepStaleSessions,
    finalizeIfUnset,
};
