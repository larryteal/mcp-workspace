/**
 * Field-level validation shared by save-time payload validation.
 *
 * Keep these rules byte-for-byte aligned with the frontend mirror at
 * `frontend/src/utils/validate.ts` so the client and server agree on what a
 * valid workspace looks like.
 *
 * Field classes:
 *  - URL    : non-empty, ≤256 chars, parses as a valid URL ({{var}} allowed)
 *  - name   : non-empty, ≤32 chars, only letters/digits/underscore
 *  - text   : optional, ≤2048 chars, any characters (descriptions/schemas/values)
 *  - KV     : key follows the name class, value/description follow the text class
 */

export const LIMITS = {
  URL_MAX: 256,
  NAME_MAX: 32,
  TEXT_MAX: 2048,
  KEY_MAX: 64,
  // Larger cap for the multi-line JSON fields (inputSchema/outputSchema/bodyContent)
  // — a non-trivial JSON Schema or request body easily exceeds the 2048 text cap.
  SCHEMA_MAX: 4096,
} as const;

const NAME_RE = /^[A-Za-z0-9_]+$/;
// KV keys (HTTP header/param/cookie names) allow hyphens and dots, unlike the
// stricter name class used for MCP service/tool identifiers.
const KEY_RE = /^[A-Za-z0-9_.-]+$/;
// Same placeholder shape as utils/template.ts — substituted away before URL
// parsing. No `\s*` around `[^{}]+?` (avoids catastrophic backtracking).
const VAR_RE = /\{\{[^{}]+?\}\}/g;

// Allowed enum values. Mirror the frontend HttpMethod / BodyType unions.
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
const BODY_TYPES = new Set(['none', 'raw-json', 'form-data', 'x-www-form-urlencoded', 'binary']);

/** HTTP method: required, one of the allowed verbs (case-insensitive). */
export function validateMethod(value: unknown, label: string): string | null {
  if (typeof value !== 'string' || !METHODS.has(value.toUpperCase())) {
    return `${label} must be one of ${[...METHODS].join(', ')}`;
  }
  return null;
}

/** Body type: optional (empty → none), otherwise one of the allowed types. */
export function validateBodyType(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !BODY_TYPES.has(value)) {
    return `${label} must be one of ${[...BODY_TYPES].join(', ')}`;
  }
  return null;
}

/** name class: non-empty, ≤32, only [A-Za-z0-9_]. */
export function validateName(value: unknown, label: string): string | null {
  if (typeof value !== 'string') return `${label} must be a string`;
  if (value.trim() === '') return `${label} cannot be empty`;
  if (value.length > LIMITS.NAME_MAX) return `${label} must be at most ${LIMITS.NAME_MAX} characters`;
  if (!NAME_RE.test(value)) return `${label} may only contain letters, digits, and underscores`;
  return null;
}

/** KV key class: non-empty, ≤64, HTTP-friendly chars (letters/digits/`- _ .`). */
export function validateKvKey(value: unknown, label: string): string | null {
  if (typeof value !== 'string') return `${label} must be a string`;
  if (value.trim() === '') return `${label} cannot be empty`;
  if (value.length > LIMITS.KEY_MAX) return `${label} must be at most ${LIMITS.KEY_MAX} characters`;
  if (!KEY_RE.test(value)) return `${label} may only contain letters, digits, and - _ .`;
  return null;
}

/** URL class: non-empty, ≤256, an http(s) URL (with {{var}} placeholders allowed). */
export function validateUrl(value: unknown, label: string): string | null {
  if (typeof value !== 'string') return `${label} must be a string`;
  const trimmed = value.trim();
  if (trimmed === '') return `${label} cannot be empty`;
  if (value.length > LIMITS.URL_MAX) return `${label} must be at most ${LIMITS.URL_MAX} characters`;
  // Resolve {{placeholders}} to a benign token so a templated path/host
  // (e.g. https://{{host}}/x) still parses, then require an http(s) scheme.
  // A fully-templated authority (e.g. "{{base}}/x") is intentionally rejected:
  // at call time URL values are percent-encoded, so the scheme+host must be
  // literal for the request to be well-formed.
  const probe = value.replace(VAR_RE, '1');
  let parsed: URL;
  try {
    parsed = new URL(probe);
  } catch {
    return `${label} must be a valid URL`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `${label} must be an http(s) URL`;
  }
  return null;
}

/** text class: optional (empty/absent OK), ≤2048, any characters. */
export function validateText(value: unknown, label: string, max: number = LIMITS.TEXT_MAX): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return `${label} must be a string`;
  if (value.length > max) return `${label} must be at most ${max} characters`;
  return null;
}

/**
 * KeyValue array: each row's key follows the name class, value/description the
 * text class. Blank rows (empty key) are placeholder/UI rows ignored at runtime,
 * so their key is not required — but value/description lengths are still bounded.
 */
export function validateKeyValueItems(items: unknown, label: string): string | null {
  if (items === undefined || items === null) return null;
  if (!Array.isArray(items)) return `${label} must be an array`;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (typeof it !== 'object' || it === null) return `${label}[${i}] must be an object`;
    const row = it as { key?: unknown; value?: unknown; description?: unknown };

    const valErr = validateText(row.value, `${label}[${i}].value`);
    if (valErr) return valErr;
    const descErr = validateText(row.description, `${label}[${i}].description`);
    if (descErr) return descErr;

    // Only validate the key when present; an empty key marks a row that is
    // dropped at runtime (matches kvToRecord), so requiring it would reject the
    // blank rows every new tool starts with.
    const key = typeof row.key === 'string' ? row.key : '';
    if (key.trim() !== '') {
      const keyErr = validateKvKey(key, `${label}[${i}].key`);
      if (keyErr) return keyErr;
    }
  }
  return null;
}

/**
 * Validate a single tool's non-schema fields. Mirrors the frontend's
 * `validateTool` so save-time (here) and the Test action agree. Schema fields
 * (inputSchema/outputSchema) and tool-name uniqueness are checked by the caller.
 */
export function validateTool(tool: unknown, prefix: string): string | null {
  const t = tool as {
    name?: unknown; url?: unknown; method?: unknown; bodyType?: unknown;
    description?: unknown; bodyContent?: unknown;
    params?: unknown; headers?: unknown; cookies?: unknown;
    bodyUrlEncoded?: unknown; bodyFormData?: unknown;
  };
  return (
    validateName(t.name, `${prefix}.name`) ||
    validateUrl(t.url, `${prefix}.url`) ||
    validateMethod(t.method, `${prefix}.method`) ||
    validateBodyType(t.bodyType, `${prefix}.bodyType`) ||
    validateText(t.description, `${prefix}.description`) ||
    validateText(t.bodyContent, `${prefix}.bodyContent`, LIMITS.SCHEMA_MAX) ||
    validateKeyValueItems(t.params, `${prefix}.params`) ||
    validateKeyValueItems(t.headers, `${prefix}.headers`) ||
    validateKeyValueItems(t.cookies, `${prefix}.cookies`) ||
    validateKeyValueItems(t.bodyUrlEncoded, `${prefix}.bodyUrlEncoded`) ||
    validateKeyValueItems(t.bodyFormData, `${prefix}.bodyFormData`)
  );
}
