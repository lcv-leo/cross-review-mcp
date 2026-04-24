// Parse STATUS marker emitido pelo peer. Ancorado na spec v4 secao 2.1
// ("ultima linha nao-vazia", trim, regex exata) + 2.3 (bloco estruturado
// tail-anchored desde 0.3.0-alpha) + 2.4 (schema expandido com campos
// opcionais validados per-field desde 0.4.0-alpha).
//
// Contrato (em ordem de tentativa; apenas o TAIL nao-branco do texto eh
// inspecionado, garantindo que menciones de STATUS: X no corpo nao disparem):
//
//   1) PREFERIDO v4: se o tail termina com </cross_review_status>, localiza
//      o <cross_review_status> imediatamente a esquerda; extrai o conteudo,
//      faz trim(), JSON.parse(), valida que o objeto tem { status: string }
//      com status em { READY, NOT_READY, NEEDS_EVIDENCE }. Se status eh
//      valido, aplica validacao per-field aos campos opcionais v4
//      (uncertainty, caller_requests, follow_ups). Campos invalidos sao
//      descartados com warning; status valido eh sempre preservado.
//      Campos fora da whitelist sao descartados com warning.
//      Retorna { status, structured: <clean>, source: 'structured',
//               parser_warnings: [...] }.
//      Se status invalido/ausente, retorna { status: null, structured: null,
//      source: null, parser_warnings: [] }. Bloco com status invalido NAO
//      cai no fallback regex, porque a ultima linha nao-vazia ja eh o
//      closing tag, e a regex legacy nao casa com ela.
//
//   2) FALLBACK legacy (v3 §2.1): examina SOMENTE a ultima linha nao-vazia
//      (apos trim). Aceita regex EXATA e case-sensitive:
//      ^STATUS: (READY|NOT_READY|NEEDS_EVIDENCE)$. Retorna { status,
//      structured: null, source: 'regex', parser_warnings: [] }.
//
//   3) Nada casou: { status: null, structured: null, source: null,
//                    parser_warnings: [] }.
//
// Regras de validacao per-field (spec v4 §2.4, ordem deterministica
// shape -> quantidade -> tipo-dos-itens -> tamanho-dos-itens):
//
//   uncertainty:  string em {'low','medium','high'} OU descarta + warning.
//                 Regra normativa: peers DEVEM omitir por padrao e emitir
//                 apenas quando o valor altera a leitura do parecer.
//
//   caller_requests e follow_ups:
//     1) shape: deve ser Array (senao descarta).
//     2) quantidade: <=20 items (senao descarta).
//     3) tipo dos itens: cada item deve ser string (senao descarta).
//     4) tamanho dos itens: cada item <=500 chars (senao descarta).
//     Arrays vazios sao normalizados para ausencia (campo nao aparece em
//     `structured`), sem warning -- coerente com "empty equivale a absent".
//
// Um warning eh emitido por campo rejeitado (nao multiplo por defeito
// multiplo). Primeira regra violada na ordem acima decide o tipo do warning.

const VALID_STATUSES = new Set(['READY', 'NOT_READY', 'NEEDS_EVIDENCE']);
const VALID_UNCERTAINTY = new Set(['low', 'medium', 'high']);
const OPTIONAL_FIELDS = new Set(['uncertainty', 'caller_requests', 'follow_ups']);
const MAX_ARRAY_ITEMS = 20;
const MAX_ITEM_CHARS = 500;
const OPEN_TAG = '<cross_review_status>';
const CLOSE_TAG = '</cross_review_status>';
const LEGACY_LINE_RE = /^STATUS: (READY|NOT_READY|NEEDS_EVIDENCE)$/;

function validateStringArray(value, fieldName, warnings) {
    // 1) shape
    if (!Array.isArray(value)) {
        warnings.push(
            `${fieldName} has invalid shape; expected array of strings`
        );
        return undefined;
    }
    // empty array -> normalizar para ausencia, sem warning
    if (value.length === 0) {
        return undefined;
    }
    // 2) quantidade
    if (value.length > MAX_ARRAY_ITEMS) {
        warnings.push(
            `${fieldName} exceeds ${MAX_ARRAY_ITEMS} items (got ${value.length})`
        );
        return undefined;
    }
    // 3) tipo dos itens
    for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
            warnings.push(
                `${fieldName} has invalid item at index ${i}; expected string`
            );
            return undefined;
        }
    }
    // 4) tamanho dos itens
    for (let i = 0; i < value.length; i++) {
        if (value[i].length > MAX_ITEM_CHARS) {
            warnings.push(
                `${fieldName} item at index ${i} exceeds ${MAX_ITEM_CHARS} chars (got ${value[i].length})`
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
    if ('uncertainty' in parsed) {
        const u = parsed.uncertainty;
        if (typeof u === 'string' && VALID_UNCERTAINTY.has(u)) {
            clean.uncertainty = u;
        } else {
            warnings.push(
                `uncertainty has invalid shape; expected string in low|medium|high`
            );
        }
    }

    // caller_requests
    if ('caller_requests' in parsed) {
        const v = validateStringArray(
            parsed.caller_requests,
            'caller_requests',
            warnings
        );
        if (v !== undefined) clean.caller_requests = v;
    }

    // follow_ups
    if ('follow_ups' in parsed) {
        const v = validateStringArray(parsed.follow_ups, 'follow_ups', warnings);
        if (v !== undefined) clean.follow_ups = v;
    }

    // campos desconhecidos
    for (const key of Object.keys(parsed)) {
        if (key === 'status') continue;
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
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        typeof parsed.status !== 'string' ||
        !VALID_STATUSES.has(parsed.status)
    ) {
        return null;
    }
    const { clean, warnings } = validateOptionalFields(parsed);
    return {
        status: clean.status,
        structured: clean,
        source: 'structured',
        parser_warnings: warnings,
    };
}

function tryLegacyLastLine(rtrimmed) {
    const lastNewline = rtrimmed.lastIndexOf('\n');
    const lastLine = (lastNewline >= 0 ? rtrimmed.slice(lastNewline + 1) : rtrimmed).trim();
    const m = LEGACY_LINE_RE.exec(lastLine);
    if (!m) return null;
    return {
        status: m[1],
        structured: null,
        source: 'regex',
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
    if (typeof text !== 'string' || !text.length) {
        return empty;
    }
    const rtrimmed = text.replace(/\s+$/, '');
    if (!rtrimmed.length) {
        return empty;
    }
    const structuredHit = tryStructuredTail(rtrimmed);
    if (structuredHit) return structuredHit;
    const legacyHit = tryLegacyLastLine(rtrimmed);
    if (legacyHit) return legacyHit;
    return empty;
}

// Backwards-compat: parseStatus continua retornando string|null para call
// sites antigos. Preferir parsePeerResponse em codigo novo.
function parseStatus(text) {
    return parsePeerResponse(text).status;
}

module.exports = {
    parseStatus,
    parsePeerResponse,
    VALID_STATUSES,
    VALID_UNCERTAINTY,
    OPTIONAL_FIELDS,
    MAX_ARRAY_ITEMS,
    MAX_ITEM_CHARS,
};
