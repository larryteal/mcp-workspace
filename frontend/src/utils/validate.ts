/**
 * Field-level validation, mirrored from the backend at
 * `backend/src/utils/validate.ts`. Keep the two in sync so the client rejects
 * the same payloads the server would (the server remains authoritative).
 *
 * Field classes:
 *  - URL    : non-empty, ≤256 chars, parses as a valid URL ({{var}} allowed)
 *  - name   : non-empty, ≤32 chars, only letters/digits/underscore
 *  - text   : optional, ≤2048 chars, any characters (descriptions/schemas/values)
 *  - KV     : key follows the name class, value/description follow the text class
 */

import type { Tool } from '@/types';

export const LIMITS = {
  URL_MAX: 256,
  NAME_MAX: 32,
  TEXT_MAX: 2048,
  KEY_MAX: 64,
  // Larger cap for the multi-line JSON fields (inputSchema/outputSchema/bodyContent).
  SCHEMA_MAX: 4096,
} as const;

const NAME_RE = /^[A-Za-z0-9_]+$/;
// KV keys (HTTP header/param/cookie names) allow hyphens and dots, unlike the
// stricter name class used for MCP service/tool identifiers.
const KEY_RE = /^[A-Za-z0-9_.-]+$/;
// No `\s*` around `[^{}]+?` — that overlap causes catastrophic backtracking.
const VAR_RE = /\{\{[^{}]+?\}\}/g;

// Allowed enum values. Mirror the HttpMethod / BodyType unions in types/index.ts.
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
  // Resolve {{placeholders}} to a benign token so a templated path/query still
  // parses; require an http(s) scheme. A fully-templated authority ("{{base}}/x")
  // fails to parse here and is rejected.
  const probe = value.replace(VAR_RE, '1');
  let probeUrl: URL;
  try {
    probeUrl = new URL(probe);
  } catch {
    return `${label} must be a valid URL`;
  }
  if (probeUrl.protocol !== 'http:' && probeUrl.protocol !== 'https:') {
    return `${label} must be an http(s) URL`;
  }
  // The authority (scheme/userinfo/host/port) must be LITERAL — a {{placeholder}}
  // there would let an untrusted caller arg redirect the request (with the tool's
  // configured secret headers) to a host of its choosing. Detect with the SAME
  // parser the runtime uses (new URL): a regex on the raw string is defeated by
  // WHATWG leniency (leading/embedded whitespace, tab/CR/LF, backslash, single slash).
  let rawUrl: URL | null = null;
  try {
    rawUrl = new URL(value);
  } catch {
    rawUrl = null; // raw only parses after substitution → placeholder in a structural spot (e.g. port)
  }
  if (!rawUrl) {
    return `${label} host must be literal — {{placeholders}} are only allowed in the path/query`;
  }
  // A placeholder is literal in the host but percent-encoded (%7B%7B) in userinfo.
  const authority = `${rawUrl.username} ${rawUrl.password} ${rawUrl.hostname}`;
  if (authority.includes('{{') || /%7b/i.test(authority)) {
    return `${label} host must be literal — {{placeholders}} are only allowed in the path/query`;
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

    const key = typeof row.key === 'string' ? row.key : '';
    if (key.trim() !== '') {
      const keyErr = validateKvKey(key, `${label}[${i}].key`);
      if (keyErr) return keyErr;
    }
  }
  return null;
}

/**
 * Validate a single tool's non-schema fields. Shared by save-time validation
 * and the Test action so both reject the same payloads. (inputSchema/outputSchema
 * are validated separately via utils/schema, which isn't bundled here.)
 * The backend applies the equivalent checks inline in routes/services.ts.
 */
export function validateTool(tool: Tool, prefix: string): string | null {
  return (
    validateName(tool.name, `${prefix}: name`) ||
    validateUrl(tool.url, `${prefix}: URL`) ||
    validateMethod(tool.method, `${prefix}: method`) ||
    validateBodyType(tool.bodyType, `${prefix}: body type`) ||
    validateText(tool.description, `${prefix}: description`) ||
    validateText(tool.bodyContent, `${prefix}: body`, LIMITS.SCHEMA_MAX) ||
    validateKeyValueItems(tool.params, `${prefix}: Query Params`) ||
    validateKeyValueItems(tool.headers, `${prefix}: Headers`) ||
    validateKeyValueItems(tool.cookies, `${prefix}: Cookies`) ||
    validateKeyValueItems(tool.bodyUrlEncoded, `${prefix}: Body (urlencoded)`) ||
    validateKeyValueItems(tool.bodyFormData, `${prefix}: Body (form-data)`)
  );
}
