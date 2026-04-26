#!/usr/bin/env node
// Drift-audit advisory for the top-level model IDs referenced in
// src/lib/peer-spawn.js.
//
// Scope (spec v4.3 section 6.9.2.1, extended by v4.7 triangular +
// v4.8 tier resilience): ADVISORY-ONLY. Does NOT change runtime
// behavior, does NOT auto-select a model, does NOT enable fallback,
// does NOT override the source pinned in peer-spawn.js.
//
// Schema v2 (v0.5.0-alpha) changes over v1:
//   - schema_version MUST equal 2 (v1 rejected).
//   - `gemini` entry is now MANDATORY alongside `codex` and `claude`.
//   - Every entry MUST declare `fallback_chain` (array, non-empty,
//     element[0] === id). The chain is the ordered set of model IDs
//     the runtime may fall back to when the top pin is unavailable
//     (per spec v4.8 section 6.9.3). The invariant [0] === id ensures
//     the pin is never silently demoted by simply editing the chain.
//   - `last_verified` replaces `validated_at` as the canonical field
//     for the most recent human revalidation timestamp (ISO
//     YYYY-MM-DD). Same semantic, explicit name.
//   - Entries MAY declare `notes_en` (English operator notes) and
//     per-provider extras (e.g. `cli_version` for gemini,
//     `reasoning_effort` for codex).
//
// Drift classes detected:
//   1) ID divergence between docs/top-models.json (documentary source
//      curated by the operator) and the JS constants pinned in
//      peer-spawn.js. Divergence => exit code 1.
//   2) fallback_chain invariant violation (not array, empty, or
//      [0] !== id). Divergence => exit code 1.
//   3) last_verified older than staleness_threshold_days. Forces a
//      manual-revision cadence. Divergence => exit code 2 (WARN).
//
// Regex against peer-spawn.js is INTENTIONALLY fragile: renaming a
// constant => structural error (exit 3), forcing deliberate human
// revision of the audit.
//
// Exit codes:
//   0 = all OK (IDs match + fallback_chain valid + last_verified fresh).
//   1 = ID or fallback_chain drift (ERROR).
//   2 = staleness (WARN, last_verified expired).
//   3 = structural error (regex did not match, invalid JSON,
//       schema_version mismatch, required entry missing, file
//       missing).
//
// Usage: `npm run check-models` or `node scripts/audit-model-drift.js`.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const PEER_SPAWN_PATH = path.join(REPO_ROOT, "src", "lib", "peer-spawn.js");
const TOP_MODELS_PATH = path.join(REPO_ROOT, "docs", "top-models.json");

const REQUIRED_SCHEMA_VERSION = 2;
const REQUIRED_AGENTS = ["codex", "claude", "gemini"];

// v1.2.7 / external-audit round-5 lint cleanup: quote-agnostic so biome
// formatter migrations between single/double quotes don't break the audit.
const RE_CODEX_MODEL = /const\s+CODEX_MODEL\s*=\s*['"]([^'"]+)['"]\s*;/;
const RE_CODEX_EFFORT =
	/const\s+CODEX_REASONING_EFFORT\s*=\s*['"]([^'"]+)['"]\s*;/;
const RE_CLAUDE_MODEL = /const\s+CLAUDE_MODEL\s*=\s*['"]([^'"]+)['"]\s*;/;
const RE_GEMINI_MODEL = /const\s+GEMINI_MODEL\s*=\s*['"]([^'"]+)['"]\s*;/;

function fail(exitCode, msg) {
	process.stderr.write(`${msg}\n`);
	process.exit(exitCode);
}

function mustMatch(src, re, label) {
	const m = src.match(re);
	if (!m) {
		fail(
			3,
			`STRUCTURAL ERROR: could not extract ${label} from peer-spawn.js via regex ${re}. ` +
				"Someone likely refactored the constant name or format. Update both peer-spawn.js " +
				"and scripts/audit-model-drift.js deliberately.",
		);
	}
	return m[1];
}

function ageInDays(isoDate) {
	const parsed = Date.parse(`${isoDate}T00:00:00Z`);
	if (Number.isNaN(parsed)) {
		fail(
			3,
			`STRUCTURAL ERROR: last_verified '${isoDate}' is not ISO-parseable (expected YYYY-MM-DD).`,
		);
	}
	const diffMs = Date.now() - parsed;
	return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function validateFallbackChain(agent, entry, errors) {
	const chain = entry.fallback_chain;
	if (!Array.isArray(chain)) {
		errors.push(
			`entries.${agent}.fallback_chain must be an array (got ${typeof chain})`,
		);
		return;
	}
	if (chain.length === 0) {
		errors.push(`entries.${agent}.fallback_chain must be non-empty`);
		return;
	}
	if (chain[0] !== entry.id) {
		errors.push(
			`entries.${agent}.fallback_chain[0] invariant violated: ` +
				`fallback_chain[0]='${chain[0]}' but id='${entry.id}'. ` +
				"Spec v4.8 section 6.9.3 requires the top pin to be the first element.",
		);
	}
	for (let i = 0; i < chain.length; i += 1) {
		if (typeof chain[i] !== "string" || chain[i].length === 0) {
			errors.push(
				`entries.${agent}.fallback_chain[${i}] must be non-empty string (got ${typeof chain[i]})`,
			);
		}
	}
}

function main() {
	if (!fs.existsSync(PEER_SPAWN_PATH)) {
		fail(3, `STRUCTURAL ERROR: peer-spawn.js not found at ${PEER_SPAWN_PATH}.`);
	}
	if (!fs.existsSync(TOP_MODELS_PATH)) {
		fail(
			3,
			`STRUCTURAL ERROR: top-models.json not found at ${TOP_MODELS_PATH}.`,
		);
	}

	const peerSrc = fs.readFileSync(PEER_SPAWN_PATH, "utf8");
	let topModels;
	try {
		topModels = JSON.parse(fs.readFileSync(TOP_MODELS_PATH, "utf8"));
	} catch (err) {
		fail(3, `STRUCTURAL ERROR: top-models.json parse failed: ${err.message}`);
	}

	if (topModels.schema_version !== REQUIRED_SCHEMA_VERSION) {
		fail(
			3,
			`STRUCTURAL ERROR: top-models.json schema_version=${topModels.schema_version} ` +
				`but audit requires ${REQUIRED_SCHEMA_VERSION}. ` +
				"Schema v1 was retired in v0.5.0-alpha (v4.7 triangular + v4.8 resilience). " +
				"Migrate top-models.json to schema v2 (add fallback_chain per entry, add gemini entry, " +
				"rename validated_at -> last_verified).",
		);
	}

	const entries = topModels.entries || {};
	for (const agent of REQUIRED_AGENTS) {
		if (!entries[agent]) {
			fail(
				3,
				`STRUCTURAL ERROR: entries.${agent} is missing from top-models.json. ` +
					"Schema v2 requires all three agents (codex, claude, gemini).",
			);
		}
	}

	const pinned = {
		codex_id: mustMatch(peerSrc, RE_CODEX_MODEL, "CODEX_MODEL"),
		codex_effort: mustMatch(peerSrc, RE_CODEX_EFFORT, "CODEX_REASONING_EFFORT"),
		claude_id: mustMatch(peerSrc, RE_CLAUDE_MODEL, "CLAUDE_MODEL"),
		gemini_id: mustMatch(peerSrc, RE_GEMINI_MODEL, "GEMINI_MODEL"),
	};

	const errors = [];
	const warnings = [];

	const codexEntry = entries.codex;
	const claudeEntry = entries.claude;
	const geminiEntry = entries.gemini;

	if (codexEntry.id !== pinned.codex_id) {
		errors.push(
			`CODEX_MODEL drift: peer-spawn.js='${pinned.codex_id}' vs top-models.json='${codexEntry.id}'`,
		);
	}
	if (codexEntry.reasoning_effort !== pinned.codex_effort) {
		errors.push(
			`CODEX_REASONING_EFFORT drift: peer-spawn.js='${pinned.codex_effort}' vs top-models.json='${codexEntry.reasoning_effort}'`,
		);
	}
	if (claudeEntry.id !== pinned.claude_id) {
		errors.push(
			`CLAUDE_MODEL drift: peer-spawn.js='${pinned.claude_id}' vs top-models.json='${claudeEntry.id}'`,
		);
	}
	if (geminiEntry.id !== pinned.gemini_id) {
		errors.push(
			`GEMINI_MODEL drift: peer-spawn.js='${pinned.gemini_id}' vs top-models.json='${geminiEntry.id}'`,
		);
	}

	for (const agent of REQUIRED_AGENTS) {
		validateFallbackChain(agent, entries[agent], errors);
	}

	const threshold =
		typeof topModels.staleness_threshold_days === "number"
			? topModels.staleness_threshold_days
			: 30;

	for (const agent of REQUIRED_AGENTS) {
		const entry = entries[agent];
		if (!entry.last_verified) {
			errors.push(
				`entries.${agent}.last_verified missing (schema v2 requires it)`,
			);
			continue;
		}
		const age = ageInDays(entry.last_verified);
		if (age > threshold) {
			warnings.push(
				`entries.${agent}.last_verified is ${age} days old (threshold=${threshold}). Re-verify the ID is still top-tier and update last_verified.`,
			);
		}
	}

	process.stdout.write("cross-review-mcp: model drift audit (schema v2)\n");
	process.stdout.write(
		`  peer-spawn.js pinned: codex='${pinned.codex_id}' effort='${pinned.codex_effort}' ` +
			`claude='${pinned.claude_id}' gemini='${pinned.gemini_id}'\n`,
	);
	process.stdout.write(
		`  top-models.json entries: codex.id='${codexEntry.id}' ` +
			`codex.reasoning_effort='${codexEntry.reasoning_effort}' ` +
			`claude.id='${claudeEntry.id}' gemini.id='${geminiEntry.id}'\n`,
	);
	process.stdout.write(`  staleness_threshold_days=${threshold}\n`);

	if (errors.length > 0) {
		process.stderr.write("\nERROR: drift or invariant violation detected.\n");
		for (const e of errors) process.stderr.write(`  - ${e}\n`);
		process.stderr.write(
			"\nAdvisory-only per spec v4.3 section 6.9.2.1 (extended by v4.7/v4.8): resolve by " +
				"(a) updating peer-spawn.js constants deliberately, AND (b) updating " +
				"top-models.json (id, fallback_chain, last_verified). This script does NOT autofix.\n",
		);
		process.exit(1);
	}

	if (warnings.length > 0) {
		process.stderr.write("\nWARN: staleness detected.\n");
		for (const w of warnings) process.stderr.write(`  - ${w}\n`);
		process.stderr.write(
			"\nAdvisory-only per spec v4.3 section 6.9.2.1: re-verify that each listed ID is still " +
				"top-tier on the operator subscription. If still top-tier, update last_verified. " +
				"If superseded, open a cross-review session to decide the promotion and bump the " +
				"release per section 6.9.2.\n",
		);
		process.exit(2);
	}

	process.stdout.write(
		"\nOK: no drift, fallback_chain invariant holds, no staleness.\n",
	);
	process.exit(0);
}

main();
