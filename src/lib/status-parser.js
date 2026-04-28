// Parse STATUS marker emitted by the peer. Anchored on spec v4 section 2.1
// ("last non-empty line", trim, exact regex) + 2.3 (tail-anchored
// structured block since 0.3.0-alpha) + 2.4 (expanded schema with
// per-field validated optional fields since 0.4.0-alpha).
//
// Contract (in order of attempt; ONLY the non-blank TAIL of the text is
// inspected, ensuring in-body mentions of STATUS: X do not fire):
//
//   1) PREFERRED v4: if the tail ends with </cross_review_status>, locate
//      the <cross_review_status> immediately to the left; extract the
//      content, trim(), JSON.parse(), validate the object has
//      { status: string } with status in
//      { READY, NOT_READY, NEEDS_EVIDENCE }. If status is valid, apply
//      per-field validation to the v4 optional fields (uncertainty,
//      caller_requests, follow_ups). Invalid fields are dropped with a
//      warning; valid status is always preserved. Unknown whitelist-miss
//      fields are dropped with a warning.
//      Returns { status, structured: <clean>, source: 'structured',
//               parser_warnings: [...] }.
//      If status invalid/absent, returns { status: null, structured: null,
//      source: null, parser_warnings: [] }. A block with invalid status
//      does NOT fall through to the legacy regex because the last
//      non-empty line is already the closing tag and the legacy regex
//      cannot match it.
//
//   2) LEGACY FALLBACK (v3 section 2.1): inspects ONLY the last non-empty
//      line (after trim). Accepts EXACT and case-sensitive regex:
//      ^STATUS: (READY|NOT_READY|NEEDS_EVIDENCE)$. Returns { status,
//      structured: null, source: 'regex', parser_warnings: [] }.
//
//   3) Nothing matched: { status: null, structured: null, source: null,
//                         parser_warnings: [] }.
//
// Per-field validation rules (spec v4 section 2.4, deterministic order
// shape -> count -> item-type -> item-length):
//
//   uncertainty:  string in {'low','medium','high'} OR drop + warning.
//                 Normative rule: peers MUST omit by default and emit
//                 only when the value changes the reading of the parecer.
//
//   caller_requests and follow_ups:
//     1) shape: must be Array (otherwise drop).
//     2) count: <=20 items (otherwise drop).
//     3) item type: each item must be string (otherwise drop).
//     4) item length: each item <=500 chars (otherwise drop).
//     Empty arrays are normalized to absence (the field does not appear in
//     `structured`), without a warning -- consistent with
//     "empty equivalent to absent".
//
// One warning is emitted per rejected field (not multiple per multi-defect
// field). The first rule violated in the order above decides the warning
// kind.

const VALID_STATUSES = new Set(["READY", "NOT_READY", "NEEDS_EVIDENCE"]);
const VALID_UNCERTAINTY = new Set(["low", "medium", "high"]);
// v0.7.0-alpha / spec v4.10 (Item D): anti-hallucination fields.
//   confidence: 'verified' | 'inferred' | 'unknown' — peer self-declares
//     epistemic state. Hard-pair rule: confidence='unknown' MUST pair with
//     status='NEEDS_EVIDENCE'; mismatch emits a parser warning.
//   evidence_sources: array of strings (same shape as caller_requests).
//     Files read, tools invoked, URLs fetched, primary docs consulted.
//     Empty or absent is allowed but under confidence='verified' an empty
//     set emits an advisory warning.
const VALID_CONFIDENCE = new Set(["verified", "inferred", "unknown"]);
// v1.2.18 / Finding 7 (handoff 2026-04-28): `summary` accepted as an
// optional structured field. The peer organically emits one-line summaries
// of the round verdict in the structured block; pre-v1.2.18 the parser
// emitted `unknown field 'summary' ignored` warnings on every response,
// adding noise without indicating a defect. Operationally useful — keep.
// Other optional fields: epistemic discipline (uncertainty, confidence,
// evidence_sources) + protocol items (caller_requests, follow_ups).
const OPTIONAL_FIELDS = new Set([
	"uncertainty",
	"caller_requests",
	"follow_ups",
	"confidence",
	"evidence_sources",
	"summary",
]);
const MAX_ARRAY_ITEMS = 20;
const MAX_ITEM_CHARS = 500;
const OPEN_TAG = "<cross_review_status>";
const CLOSE_TAG = "</cross_review_status>";
const LEGACY_LINE_RE = /^STATUS: (READY|NOT_READY|NEEDS_EVIDENCE)$/;

function validateStringArray(value, fieldName, warnings) {
	// 1) shape
	if (!Array.isArray(value)) {
		warnings.push(`${fieldName} has invalid shape; expected array of strings`);
		return undefined;
	}
	// empty array -> normalize to absence, no warning
	if (value.length === 0) {
		return undefined;
	}
	// 2) count
	if (value.length > MAX_ARRAY_ITEMS) {
		warnings.push(
			`${fieldName} exceeds ${MAX_ARRAY_ITEMS} items (got ${value.length})`,
		);
		return undefined;
	}
	// 3) item type
	for (let i = 0; i < value.length; i++) {
		if (typeof value[i] !== "string") {
			warnings.push(
				`${fieldName} has invalid item at index ${i}; expected string`,
			);
			return undefined;
		}
	}
	// 4) item length
	for (let i = 0; i < value.length; i++) {
		if (value[i].length > MAX_ITEM_CHARS) {
			warnings.push(
				`${fieldName} item at index ${i} exceeds ${MAX_ITEM_CHARS} chars (got ${value[i].length})`,
			);
			return undefined;
		}
	}
	return value.slice();
}

function validateOptionalFields(parsed) {
	const warnings = [];
	const clean = { status: parsed.status };

	// uncertainty
	if ("uncertainty" in parsed) {
		const u = parsed.uncertainty;
		if (typeof u === "string" && VALID_UNCERTAINTY.has(u)) {
			clean.uncertainty = u;
		} else {
			warnings.push(
				`uncertainty has invalid shape; expected string in low|medium|high`,
			);
		}
	}

	// caller_requests
	if ("caller_requests" in parsed) {
		const v = validateStringArray(
			parsed.caller_requests,
			"caller_requests",
			warnings,
		);
		if (v !== undefined) clean.caller_requests = v;
	}

	// follow_ups
	if ("follow_ups" in parsed) {
		const v = validateStringArray(parsed.follow_ups, "follow_ups", warnings);
		if (v !== undefined) clean.follow_ups = v;
	}

	// v0.7.0-alpha / spec v4.10 Item D: confidence.
	if ("confidence" in parsed) {
		const c = parsed.confidence;
		if (typeof c === "string" && VALID_CONFIDENCE.has(c)) {
			clean.confidence = c;
		} else {
			warnings.push(
				`confidence has invalid shape; expected string in verified|inferred|unknown`,
			);
		}
	}

	// v0.7.0-alpha / spec v4.10 Item D: evidence_sources.
	if ("evidence_sources" in parsed) {
		const v = validateStringArray(
			parsed.evidence_sources,
			"evidence_sources",
			warnings,
		);
		if (v !== undefined) clean.evidence_sources = v;
	}

	// v1.2.18 / Finding 7 (handoff 2026-04-28): summary is a one-line
	// peer-authored description of the round verdict. Capped at MAX_ITEM_CHARS
	// (500) to prevent runaway text. Wrong shape emits a warning but doesn't
	// fail the parse. R1 (gemini): when truncation fires, emit a warning so
	// the peer/operator knows the summary was clipped — aligns with the
	// existing per-field-too-long warning mechanics.
	if ("summary" in parsed) {
		const s = parsed.summary;
		if (typeof s === "string") {
			if (s.length > MAX_ITEM_CHARS) {
				warnings.push(
					`summary truncated to ${MAX_ITEM_CHARS} chars (was ${s.length})`,
				);
				clean.summary = s.slice(0, MAX_ITEM_CHARS);
			} else {
				clean.summary = s;
			}
		} else {
			warnings.push("summary has invalid shape; expected string");
		}
	}

	// v0.7.0-alpha Item D: cross-field consistency rules.
	//   confidence='unknown' MUST pair with status='NEEDS_EVIDENCE'.
	//   confidence='verified' SHOULD include at least one evidence_sources
	//     entry (advisory).
	if (clean.confidence === "unknown" && clean.status !== "NEEDS_EVIDENCE") {
		warnings.push(
			`confidence='unknown' must pair with status='NEEDS_EVIDENCE' (got status='${clean.status}')`,
		);
	}
	if (
		clean.confidence === "verified" &&
		(!clean.evidence_sources || clean.evidence_sources.length === 0)
	) {
		warnings.push(
			`confidence='verified' should include at least one evidence_sources entry (got empty)`,
		);
	}

	// unknown fields
	for (const key of Object.keys(parsed)) {
		if (key === "status") continue;
		if (!OPTIONAL_FIELDS.has(key)) {
			warnings.push(`unknown field '${key}' ignored`);
		}
	}

	return { clean, warnings };
}

function tryStructuredTail(rtrimmed) {
	if (!rtrimmed.endsWith(CLOSE_TAG)) return null;
	const closeAt = rtrimmed.length - CLOSE_TAG.length;
	const openAt = rtrimmed.lastIndexOf(OPEN_TAG, closeAt - 1);
	if (openAt < 0) return null;
	const payload = rtrimmed.slice(openAt + OPEN_TAG.length, closeAt).trim();
	if (!payload) return null;
	let parsed;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return null;
	}
	if (
		parsed == null ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		typeof parsed.status !== "string" ||
		!VALID_STATUSES.has(parsed.status)
	) {
		return null;
	}
	const { clean, warnings } = validateOptionalFields(parsed);
	return {
		status: clean.status,
		structured: clean,
		source: "structured",
		parser_warnings: warnings,
	};
}

function tryLegacyLastLine(rtrimmed) {
	const lastNewline = rtrimmed.lastIndexOf("\n");
	const lastLine = (
		lastNewline >= 0 ? rtrimmed.slice(lastNewline + 1) : rtrimmed
	).trim();
	const m = LEGACY_LINE_RE.exec(lastLine);
	if (!m) return null;
	return {
		status: m[1],
		structured: null,
		source: "regex",
		parser_warnings: [],
	};
}

function parsePeerResponse(text) {
	const empty = {
		status: null,
		structured: null,
		source: null,
		parser_warnings: [],
	};
	if (typeof text !== "string" || !text.length) {
		return empty;
	}
	const rtrimmed = text.trimEnd();
	if (!rtrimmed.length) {
		return empty;
	}
	const structuredHit = tryStructuredTail(rtrimmed);
	if (structuredHit) return structuredHit;
	const legacyHit = tryLegacyLastLine(rtrimmed);
	if (legacyHit) return legacyHit;
	return empty;
}

// Backwards-compat: parseStatus still returns string|null for legacy
// call sites. Prefer parsePeerResponse in new code.
function parseStatus(text) {
	return parsePeerResponse(text).status;
}

module.exports = {
	parseStatus,
	parsePeerResponse,
	VALID_STATUSES,
	VALID_UNCERTAINTY,
	VALID_CONFIDENCE,
	OPTIONAL_FIELDS,
	MAX_ARRAY_ITEMS,
	MAX_ITEM_CHARS,
};
