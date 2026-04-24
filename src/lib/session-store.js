// Session state in ~/.cross-review/<session-id>/. Atomic writes via
// temp+rename. Lock via atomic mkdir (POSIX and Windows) with TTL + PID.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const STATE_DIR = path.join(os.homedir(), '.cross-review');
const LOCK_TTL_MS = 60 * 60 * 1000; // 1h

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
        // Lock exists -- check TTL
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
            // info corrupted -> drop the lock and reacquire
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
        // silent: if absent, it's already unlocked
    }
}

function initSession({ task, artifacts, callerAgent, peerAgent }) {
    ensureStateDir();
    const id = crypto.randomUUID();
    fs.mkdirSync(sessionDir(id), { recursive: true });
    const meta = {
        session_id: id,
        task: String(task || ''),
        artifacts: Array.isArray(artifacts) ? artifacts.map(String) : [],
        caller: callerAgent,
        peer: peerAgent,
        started_at: new Date().toISOString(),
        rounds: [],
        outcome: null,
    };
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
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeMeta(sessionId, meta) {
    atomicWriteFile(
        path.join(sessionDir(sessionId), 'meta.json'),
        JSON.stringify(meta, null, 2)
    );
}

function appendRound(sessionId, round) {
    const meta = readMeta(sessionId);
    meta.rounds.push(round);
    meta.last_updated_at = new Date().toISOString();
    writeMeta(sessionId, meta);
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
    const callerReady = last.caller_status === 'READY';
    const peerReady = last.peer_status === 'READY';
    const peerNeedsEvidence = last.peer_status === 'NEEDS_EVIDENCE';
    const converged = callerReady && peerReady;
    let reason;
    if (converged) {
        reason = 'both caller and peer declared READY in the same round';
    } else if (peerNeedsEvidence) {
        reason = `peer declared NEEDS_EVIDENCE (caller=${last.caller_status ?? 'MISSING'}); attach the requested evidence next round instead of re-arguing merits`;
    } else if (callerReady && !peerReady) {
        reason = `caller READY but peer is ${last.peer_status ?? 'MISSING'}; needs another round`;
    } else if (!callerReady && peerReady) {
        reason = `peer READY but caller declared ${last.caller_status ?? 'MISSING'}; caller must concur`;
    } else {
        reason = `neither side READY (caller=${last.caller_status ?? 'MISSING'}, peer=${last.peer_status ?? 'MISSING'})`;
    }
    return {
        converged,
        caller_status: last.caller_status,
        peer_status: last.peer_status,
        peer_structured: last.peer_structured ?? null,
        last_round: last,
        reason,
    };
}

function finalize(sessionId, outcome) {
    const meta = readMeta(sessionId);
    meta.outcome = outcome;
    meta.finalized_at = new Date().toISOString();
    writeMeta(sessionId, meta);
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
    checkConvergence,
    finalize,
    acquireLock,
    releaseLock,
};
