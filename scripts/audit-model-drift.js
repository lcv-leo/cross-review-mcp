#!/usr/bin/env node
// Drift-audit advisory para os IDs de modelo top-level referenciados em
// src/lib/peer-spawn.js.
//
// Escopo (spec v4.3 secao 6.9.2.1): este script e ADVISORY-ONLY. Ele NAO altera
// comportamento de runtime, NAO seleciona modelo automaticamente, NAO
// habilita fallback, NAO sobrepoe a fonte cravada em peer-spawn.js. Serve
// exclusivamente para detectar dois tipos de drift:
//
//   1) ID divergente entre docs/top-models.json (fonte documental curada
//      pelo usuario) e as constantes JS cravadas em peer-spawn.js.
//      Divergencia => exit code 1 com mensagem explicando.
//
//   2) validated_at com idade maior que staleness_threshold_days. Significa
//      que a curadoria humana nao foi renovada no prazo configurado;
//      forca cadencia de revisao manual. Divergencia => exit code 2 com
//      aviso.
//
// O script le peer-spawn.js como texto (fs.readFileSync) e extrai as
// constantes por regex fixo. A fragilidade do regex eh INTENCIONAL: se
// alguem refatorar os nomes das constantes, o script falha explicitamente
// (exit 3) forcando revisao humana da auditoria. NAO exportamos as
// constantes do modulo por design (manter peer-spawn.js imutavel a este
// tooling).
//
// Exit codes:
//   0 = tudo OK (IDs batem + validated_at dentro do prazo).
//   1 = drift de ID (ERROR, divergencia entre peer-spawn.js e JSON).
//   2 = staleness (WARN, validated_at vencido).
//   3 = erro estrutural (regex nao casou, JSON invalido, file faltando).
//
// Uso: `npm run check-models` ou `node scripts/audit-model-drift.js`.

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

    const cravadas = {
        codex_id: mustMatch(peerSrc, RE_CODEX_MODEL, 'CODEX_MODEL'),
        codex_effort: mustMatch(peerSrc, RE_CODEX_EFFORT, 'CODEX_REASONING_EFFORT'),
        claude_id: mustMatch(peerSrc, RE_CLAUDE_MODEL, 'CLAUDE_MODEL'),
    };

    const entries = topModels.entries || {};
    const codexEntry = entries.codex || {};
    const claudeEntry = entries.claude || {};

    const errors = [];
    const warnings = [];

    if (codexEntry.id !== cravadas.codex_id) {
        errors.push(
            `CODEX_MODEL drift: peer-spawn.js='${cravadas.codex_id}' vs top-models.json='${codexEntry.id}'`
        );
    }
    if (codexEntry.reasoning_effort !== cravadas.codex_effort) {
        errors.push(
            `CODEX_REASONING_EFFORT drift: peer-spawn.js='${cravadas.codex_effort}' vs top-models.json='${codexEntry.reasoning_effort}'`
        );
    }
    if (claudeEntry.id !== cravadas.claude_id) {
        errors.push(
            `CLAUDE_MODEL drift: peer-spawn.js='${cravadas.claude_id}' vs top-models.json='${claudeEntry.id}'`
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
    process.stdout.write(`  peer-spawn.js cravadas: codex='${cravadas.codex_id}' effort='${cravadas.codex_effort}' claude='${cravadas.claude_id}'\n`);
    process.stdout.write(`  top-models.json entries: codex.id='${codexEntry.id}' codex.reasoning_effort='${codexEntry.reasoning_effort}' claude.id='${claudeEntry.id}'\n`);
    process.stdout.write(`  staleness_threshold_days=${threshold}\n`);

    if (errors.length > 0) {
        process.stderr.write('\nERROR: drift detected.\n');
        for (const e of errors) process.stderr.write('  - ' + e + '\n');
        process.stderr.write(
            '\nAdvisory-only per spec v4.3 secao 6.9.2.1: resolve by (a) updating peer-spawn.js with ' +
                'explicit bump and spec edit per secao 6.9.2, AND (b) updating top-models.json validated_at. ' +
                'This script does NOT autofix.\n'
        );
        process.exit(1);
    }

    if (warnings.length > 0) {
        process.stderr.write('\nWARN: staleness detected.\n');
        for (const w of warnings) process.stderr.write('  - ' + w + '\n');
        process.stderr.write(
            '\nAdvisory-only per spec v4.3 secao 6.9.2.1: re-verify that each listed ID is still the ' +
                'top-tier model available in the user subscription. If still top-tier, update ' +
                'validated_at. If superseded, open a cross-review session to decide the promotion ' +
                'and bump the release per secao 6.9.2.\n'
        );
        process.exit(2);
    }

    process.stdout.write('\nOK: no drift, no staleness.\n');
    process.exit(0);
}

main();
