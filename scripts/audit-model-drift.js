#!/usr/bin/env node
// Drift-audit advisory for the top-level model IDs referenced in
// src/lib/peer-spawn.js.
//
// Scope (spec v4.3 section 6.9.2.1): this script is ADVISORY-ONLY. It does
// NOT change runtime behavior, does NOT auto-select a model, does NOT
// enable fallback, does NOT override the source pinned in peer-spawn.js.
// It serves exclusively to detect two kinds of drift:
//
//   1) ID divergence between docs/top-models.json (documentary source
//      curated by the user) and the JS constants pinned in peer-spawn.js.
//      Divergence => exit code 1 with explanatory message.
//
//   2) validated_at older than staleness_threshold_days. Means the human
//      curation has not been renewed within the configured window; forces
//      a manual-revision cadence. Divergence => exit code 2 with a
//      warning.
//
// The script reads peer-spawn.js as text (fs.readFileSync) and extracts
// the constants via fixed regex. The fragility of the regex is
// INTENTIONAL: if anyone renames the constant names, the script fails
// explicitly (exit 3), forcing a deliberate human revision of the audit.
// We do NOT export the constants from the module by design (keep
// peer-spawn.js immutable to this tooling).
//
// Exit codes:
//   0 = all OK (IDs match + validated_at within window).
//   1 = ID drift (ERROR, divergence between peer-spawn.js and JSON).
//   2 = staleness (WARN, validated_at expired).
//   3 = structural error (regex did not match, invalid JSON, file
//       missing).
//
// Usage: `npm run check-models` or `node scripts/audit-model-drift.js`.

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PEER_SPAWN_PATH = path.join(REPO_ROOT, 'src', 'lib', 'peer-spawn.js');
const TOP_MODELS_PATH = path.join(REPO_ROOT, 'docs', 'top-models.json');

const RE_CODEX_MODEL = /const\s+CODEX_MODEL\s*=\s*'([^']+)'\s*;/;
const RE_CODEX_EFFORT = /const\s+CODEX_REASONING_EFFORT\s*=\s*'([^']+)'\s*;/;
const RE_CLAUDE_MODEL = /const\s+CLAUDE_MODEL\s*=\s*'([^']+)'\s*;/;

function fail(exitCode, msg) {
    process.stderr.write(msg + '\n');
    process.exit(exitCode);
}

function mustMatch(src, re, label) {
    const m = src.match(re);
    if (!m) {
        fail(
            3,
            `STRUCTURAL ERROR: could not extract ${label} from peer-spawn.js via regex ${re}. ` +
                'Someone likely refactored the constant name or format. Update both peer-spawn.js ' +
                'and scripts/audit-model-drift.js deliberately.'
        );
    }
    return m[1];
}

function ageInDays(isoDate) {
    const parsed = Date.parse(isoDate + 'T00:00:00Z');
    if (Number.isNaN(parsed)) {
        fail(3, `STRUCTURAL ERROR: validated_at '${isoDate}' is not ISO-parseable (expected YYYY-MM-DD).`);
    }
    const diffMs = Date.now() - parsed;
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function main() {
    if (!fs.existsSync(PEER_SPAWN_PATH)) {
        fail(3, `STRUCTURAL ERROR: peer-spawn.js not found at ${PEER_SPAWN_PATH}.`);
    }
    if (!fs.existsSync(TOP_MODELS_PATH)) {
        fail(3, `STRUCTURAL ERROR: top-models.json not found at ${TOP_MODELS_PATH}.`);
    }

    const peerSrc = fs.readFileSync(PEER_SPAWN_PATH, 'utf8');
    let topModels;
    try {
        topModels = JSON.parse(fs.readFileSync(TOP_MODELS_PATH, 'utf8'));
    } catch (err) {
        fail(3, `STRUCTURAL ERROR: top-models.json parse failed: ${err.message}`);
    }

    const pinned = {
        codex_id: mustMatch(peerSrc, RE_CODEX_MODEL, 'CODEX_MODEL'),
        codex_effort: mustMatch(peerSrc, RE_CODEX_EFFORT, 'CODEX_REASONING_EFFORT'),
        claude_id: mustMatch(peerSrc, RE_CLAUDE_MODEL, 'CLAUDE_MODEL'),
    };

    const entries = topModels.entries || {};
    const codexEntry = entries.codex || {};
    const claudeEntry = entries.claude || {};

    const errors = [];
    const warnings = [];

    if (codexEntry.id !== pinned.codex_id) {
        errors.push(
            `CODEX_MODEL drift: peer-spawn.js='${pinned.codex_id}' vs top-models.json='${codexEntry.id}'`
        );
    }
    if (codexEntry.reasoning_effort !== pinned.codex_effort) {
        errors.push(
            `CODEX_REASONING_EFFORT drift: peer-spawn.js='${pinned.codex_effort}' vs top-models.json='${codexEntry.reasoning_effort}'`
        );
    }
    if (claudeEntry.id !== pinned.claude_id) {
        errors.push(
            `CLAUDE_MODEL drift: peer-spawn.js='${pinned.claude_id}' vs top-models.json='${claudeEntry.id}'`
        );
    }

    const threshold =
        typeof topModels.staleness_threshold_days === 'number'
            ? topModels.staleness_threshold_days
            : 30;

    for (const [name, entry] of Object.entries(entries)) {
        if (!entry.validated_at) {
            errors.push(`entries.${name}.validated_at missing`);
            continue;
        }
        const age = ageInDays(entry.validated_at);
        if (age > threshold) {
            warnings.push(
                `entries.${name}.validated_at is ${age} days old (threshold=${threshold}). Re-verify the ID is still top-tier and update validated_at.`
            );
        }
    }

    process.stdout.write('cross-review-mcp: model drift audit\n');
    process.stdout.write(`  peer-spawn.js pinned: codex='${pinned.codex_id}' effort='${pinned.codex_effort}' claude='${pinned.claude_id}'\n`);
    process.stdout.write(`  top-models.json entries: codex.id='${codexEntry.id}' codex.reasoning_effort='${codexEntry.reasoning_effort}' claude.id='${claudeEntry.id}'\n`);
    process.stdout.write(`  staleness_threshold_days=${threshold}\n`);

    if (errors.length > 0) {
        process.stderr.write('\nERROR: drift detected.\n');
        for (const e of errors) process.stderr.write('  - ' + e + '\n');
        process.stderr.write(
            '\nAdvisory-only per spec v4.3 section 6.9.2.1: resolve by (a) updating peer-spawn.js with ' +
                'explicit bump and spec edit per section 6.9.2, AND (b) updating top-models.json validated_at. ' +
                'This script does NOT autofix.\n'
        );
        process.exit(1);
    }

    if (warnings.length > 0) {
        process.stderr.write('\nWARN: staleness detected.\n');
        for (const w of warnings) process.stderr.write('  - ' + w + '\n');
        process.stderr.write(
            '\nAdvisory-only per spec v4.3 section 6.9.2.1: re-verify that each listed ID is still the ' +
                'top-tier model available in the user subscription. If still top-tier, update ' +
                'validated_at. If superseded, open a cross-review session to decide the promotion ' +
                'and bump the release per section 6.9.2.\n'
        );
        process.exit(2);
    }

    process.stdout.write('\nOK: no drift, no staleness.\n');
    process.exit(0);
}

main();
