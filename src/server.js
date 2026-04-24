#!/usr/bin/env node

/**
 * cross-review-mcp / server.js
 *
 * MCP server (stdio) exposing the cross-review orchestration surface.
 * Identity is determined by CROSS_REVIEW_CALLER (claude | codex); the
 * `ask_peer` tool spawns the complement under the definitive contained
 * spawn configuration.
 *
 * Exposed tools:
 *   - session_init(task, artifacts[])
 *   - session_read(session_id)
 *   - session_check_convergence(session_id)
 *   - session_finalize(session_id, outcome)
 *   - ask_peer(session_id, prompt)
 */

const {
    Server,
} = require('@modelcontextprotocol/sdk/server/index.js');
const {
    StdioServerTransport,
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const store = require('./lib/session-store.js');
const { spawnPeer } = require('./lib/peer-spawn.js');
const { parsePeerResponse } = require('./lib/status-parser.js');

const CALLER = (process.env.CROSS_REVIEW_CALLER || '').toLowerCase();
if (!['claude', 'codex'].includes(CALLER)) {
    process.stderr.write(
        `[cross-review-mcp] fatal: CROSS_REVIEW_CALLER must be 'claude' or 'codex' (got '${CALLER || '(unset)'}')\n`
    );
    process.exit(1);
}
const PEER = CALLER === 'claude' ? 'codex' : 'claude';

function log(msg, meta) {
    const base = `[cross-review-mcp ${new Date().toISOString()} caller=${CALLER}] ${msg}`;
    process.stderr.write(meta ? `${base} ${JSON.stringify(meta)}\n` : `${base}\n`);
}

const server = new Server(
    { name: 'cross-review-mcp', version: '0.4.0-alpha' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'session_init',
            description:
                'Create a new cross-review session directory under ~/.cross-review/<uuid>/. Returns the session_id to use with the other tools.',
            inputSchema: {
                type: 'object',
                properties: {
                    task: {
                        type: 'string',
                        description: 'Short description of the task under review.',
                    },
                    artifacts: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Optional list of artifact paths relevant to the review (read by peer at its discretion).',
                    },
                },
                required: ['task'],
            },
        },
        {
            name: 'session_read',
            description:
                'Return the full session metadata (meta.json) including all rounds recorded so far.',
            inputSchema: {
                type: 'object',
                properties: { session_id: { type: 'string' } },
                required: ['session_id'],
            },
        },
        {
            name: 'session_check_convergence',
            description:
                "Return whether TRUE bilateral convergence holds in the last round: converged=true iff BOTH caller_status and peer_status are READY. Caller status is persisted by ask_peer when the caller passes its caller_status argument. peer_status values: READY | NOT_READY | NEEDS_EVIDENCE. NEEDS_EVIDENCE signals the peer could not conclude without dynamic evidence (see CALLER_REQUEST convention in workflow spec) -- treat it as blocking but semantically distinct from NOT_READY (next round should attach requested evidence, not re-argue technical merits). Use this to decide whether to stop (and then call session_finalize with outcome='converged').",
            inputSchema: {
                type: 'object',
                properties: { session_id: { type: 'string' } },
                required: ['session_id'],
            },
        },
        {
            name: 'session_finalize',
            description:
                'Mark the session as concluded with an outcome: converged | aborted | max-rounds.',
            inputSchema: {
                type: 'object',
                properties: {
                    session_id: { type: 'string' },
                    outcome: {
                        type: 'string',
                        enum: ['converged', 'aborted', 'max-rounds'],
                    },
                },
                required: ['session_id', 'outcome'],
            },
        },
        {
            name: 'ask_peer',
            description: `Send a prompt to the peer agent (${PEER}) and return its response with parsed STATUS. Caller MUST declare its own caller_status (READY means "I have no further changes or objections this round"; NOT_READY means "I applied changes and want peer to re-review, or I disagree with peer's previous response"). caller_status is restricted to READY|NOT_READY -- if the caller is missing evidence, emit NOT_READY and attach a CALLER_REQUEST block for peer. Peer status may be READY|NOT_READY|NEEDS_EVIDENCE. Convergence requires both READY in the same round. Peer runs under contained spawn with destructive MCPs/apps disabled; peer is invoked with the top-level model explicitly set (spec v4 §6.9.2: codex=gpt-5.5 xhigh, claude=claude-opus-4-7; no silent fallback).\n\nPeer response contract (preferred, since 0.3.0-alpha; schema expanded in 0.4.0-alpha per spec v4 §2.4): the peer SHOULD terminate its response with a structured block whose closing tag is the last non-empty token:\n    <cross_review_status>{"status":"READY"}</cross_review_status>\nwith status in {READY, NOT_READY, NEEDS_EVIDENCE}. The JSON payload may include optional fields: uncertainty (low|medium|high), caller_requests (string[] <=20 items, each <=500 chars), follow_ups (string[] same limits). Optional fields are omit-unless-signal (emit only when the value changes the reading of the parecer). Invalid optional fields are dropped with a parser warning but the block remains valid for status.\n\nBackwards-compat fallback: the peer may instead end with a single canonical line "STATUS: READY", "STATUS: NOT_READY", or "STATUS: NEEDS_EVIDENCE" (case-sensitive, exact) as the last non-empty line. Parser inspects only the tail of the response -- mentions of STATUS: X or </cross_review_status> inside earlier prose do not count.\n\nResponse payload includes peer_structured (the validated clean JSON object when a valid structured block terminates the response, else null), status_source ('structured' | 'regex' | null), parser_warnings (string[], empty when nothing rejected), and peer_model (the top-level model id explicitly passed to the peer CLI).`,
            inputSchema: {
                type: 'object',
                properties: {
                    session_id: { type: 'string' },
                    prompt: {
                        type: 'string',
                        description:
                            "Full prompt for the peer. Include the STATUS protocol instruction in your own wording; prefer asking for the structured <cross_review_status>{...}</cross_review_status> block.",
                    },
                    caller_status: {
                        type: 'string',
                        enum: ['READY', 'NOT_READY'],
                        description:
                            "Caller's own STATUS for this round. READY = caller has nothing to add and concurs with peer's previous position (if any). NOT_READY = caller has applied changes, has objections, needs evidence from peer, or wants another round regardless.",
                    },
                },
                required: ['session_id', 'prompt', 'caller_status'],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    log(`tool call: ${name}`);
    try {
        switch (name) {
            case 'session_init': {
                const id = store.initSession({
                    task: args.task,
                    artifacts: args.artifacts || [],
                    callerAgent: CALLER,
                    peerAgent: PEER,
                });
                log(`session_init created`, { session_id: id });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { session_id: id, caller: CALLER, peer: PEER },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }
            case 'session_read': {
                const meta = store.readMeta(args.session_id);
                return {
                    content: [
                        { type: 'text', text: JSON.stringify(meta, null, 2) },
                    ],
                };
            }
            case 'session_check_convergence': {
                const result = store.checkConvergence(args.session_id);
                return {
                    content: [
                        { type: 'text', text: JSON.stringify(result, null, 2) },
                    ],
                };
            }
            case 'session_finalize': {
                store.finalize(args.session_id, args.outcome);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ ok: true, outcome: args.outcome }, null, 2),
                        },
                    ],
                };
            }
            case 'ask_peer': {
                const sessionId = args.session_id;
                const prompt = args.prompt;
                const callerStatus = args.caller_status;
                if (!['READY', 'NOT_READY'].includes(callerStatus)) {
                    throw new Error(
                        `ask_peer requires caller_status = 'READY' or 'NOT_READY' (got '${callerStatus}')`
                    );
                }
                if (!store.acquireLock(sessionId)) {
                    throw new Error(
                        `session ${sessionId} is currently locked by another process (TTL 1h); retry shortly or clear ~/.cross-review/${sessionId}/.lock if stale`
                    );
                }
                try {
                    const meta = store.readMeta(sessionId);
                    const roundNum = (meta.rounds?.length || 0) + 1;
                    store.savePromptForRound(sessionId, roundNum, prompt);
                    log(`ask_peer: spawning ${PEER}`, {
                        session: sessionId,
                        round: roundNum,
                        caller_status: callerStatus,
                        prompt_bytes: Buffer.byteLength(prompt || '', 'utf8'),
                    });
                    const t0 = Date.now();
                    const { stdout, stderr, peer_model: peerModel } = await spawnPeer(
                        PEER,
                        prompt
                    );
                    const durationMs = Date.now() - t0;
                    const parsed = parsePeerResponse(stdout);
                    const peerStatus = parsed.status;
                    const peerStructured = parsed.structured;
                    const statusSource = parsed.source;
                    const parserWarnings = parsed.parser_warnings || [];
                    const fname = store.savePeerResponse(
                        sessionId,
                        roundNum,
                        PEER,
                        stdout,
                        peerStatus
                    );
                    const protocolViolation = peerStatus == null;
                    store.appendRound(sessionId, {
                        round: roundNum,
                        caller: CALLER,
                        caller_status: callerStatus,
                        peer: PEER,
                        peer_status: peerStatus,
                        peer_structured: peerStructured,
                        status_source: statusSource,
                        parser_warnings: parserWarnings,
                        peer_model: peerModel,
                        peer_file: fname,
                        protocol_violation: protocolViolation,
                        duration_ms: durationMs,
                        completed_at: new Date().toISOString(),
                    });
                    log(`ask_peer: done`, {
                        round: roundNum,
                        caller_status: callerStatus,
                        peer_status: peerStatus,
                        status_source: statusSource,
                        peer_model: peerModel,
                        parser_warnings_count: parserWarnings.length,
                        converged_this_round:
                            callerStatus === 'READY' && peerStatus === 'READY',
                        duration_ms: durationMs,
                    });
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(
                                    {
                                        round: roundNum,
                                        caller_status: callerStatus,
                                        peer_status: peerStatus,
                                        peer_structured: peerStructured,
                                        status_source: statusSource,
                                        parser_warnings: parserWarnings,
                                        peer_model: peerModel,
                                        protocol_violation: protocolViolation,
                                        duration_ms: durationMs,
                                        content: stdout,
                                        stderr_tail: (stderr || '').slice(-600),
                                    },
                                    null,
                                    2
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
                    type: 'text',
                    text: JSON.stringify({ error: String(err?.message || err) }, null, 2),
                },
            ],
            isError: true,
        };
    }
});

async function main() {
    log(`starting v0.4.0-alpha, caller=${CALLER}, peer=${PEER}`);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('stdio transport connected');
}

main().catch((err) => {
    process.stderr.write(
        `[cross-review-mcp] fatal: ${err?.stack || err?.message || err}\n`
    );
    process.exit(1);
});
