// Match {{var}} placeholders. The name is any run of non-brace characters
// (lazy, so adjacent placeholders don't merge); surrounding whitespace is
// trimmed in the callback rather than in the pattern. NOTE: do NOT add `\s*`
// around the capture (e.g. `\{\{\s*([^{}]+?)\s*\}\}`) — because `[^{}]` also
// matches spaces, that overlap causes catastrophic regex backtracking
// (quadratic) on inputs like "{{" + many spaces with no closing "}}".
const VAR_PATTERN = /\{\{([^{}]+?)\}\}/g;

/**
 * Convert an MCP argument value to its string form for placeholder substitution.
 * MCP arguments can be any JSON type, not just strings.
 *  - string            → as-is
 *  - number / boolean  → String()
 *  - null / undefined  → '' (treated as "not provided")
 *  - object / array    → JSON.stringify
 */
function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Substitute {{var}} placeholders with values from the provided map.
 * - Non-string values are coerced (see stringifyValue).
 * - Unknown placeholders resolve to '' so a literal `{{var}}` is never leaked
 *   to the upstream API (required vars are guaranteed present by schema
 *   validation; this only affects optional/unprovided ones).
 * - `encode` is applied to each substituted value before insertion. Callers pass
 *   `encodeURIComponent` for URL and cookie positions so a caller-controlled
 *   value can't break out of its component (inject query params, smuggle cookies).
 *   It defaults to identity for positions where encoding would be wrong (params
 *   are encoded later by URLSearchParams; header values are CRLF-guarded by the
 *   runtime Headers; the literal template chars between placeholders must stay raw).
 */
export function substituteString(
  text: string,
  values: Record<string, unknown>,
  encode: (v: string) => string = (v) => v,
): string {
  return text.replace(VAR_PATTERN, (_match, rawName: string) => {
    const name = rawName.trim(); // trim here (not in the regex — see VAR_PATTERN)
    // Use hasOwnProperty, not `in`: `in` walks the prototype chain, so
    // {{toString}}/{{constructor}}/… would resolve to a function and inject the
    // literal "undefined" instead of the documented empty string.
    const has = Object.prototype.hasOwnProperty.call(values, name);
    return encode(has ? stringifyValue(values[name]) : '');
  });
}

export function substituteRecord(
  rec: Record<string, string> | null,
  values: Record<string, unknown>,
  encode: (v: string) => string = (v) => v,
): Record<string, string> | null {
  if (!rec) return null;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    result[k] = substituteString(v, values, encode);
  }
  return result;
}

/**
 * Encode a value going into a Cookie header. Only neutralizes what lets a value
 * break out and add another cookie — strip CR/LF and percent-encode `;` and `,`.
 * Deliberately NOT encodeURIComponent: cookie values legitimately carry base64/
 * JWT characters (`+` `/` `=`), which encodeURIComponent would corrupt.
 */
function encodeCookieValue(v: string): string {
  return v.replace(/[\r\n]/g, '').replace(/;/g, '%3B').replace(/,/g, '%2C');
}

/**
 * Substitute header values. Identity-encoded (header values are CRLF-guarded by
 * the runtime Headers), EXCEPT a `Cookie` header, whose value is cookie-safe-
 * encoded — otherwise a caller-controlled `{{var}}` in a `Cookie: k={{v}}` header
 * could smuggle a second cookie (the same protection the dedicated cookies field
 * gets via encodeCookieValue). Only the substituted value is encoded, so a literal
 * `;` separating cookies in the template (e.g. `a={{x}}; b={{y}}`) is preserved.
 */
function substituteHeaders(
  rec: Record<string, string> | null,
  values: Record<string, unknown>,
): Record<string, string> | null {
  if (!rec) return null;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    const encode = k.toLowerCase() === 'cookie' ? encodeCookieValue : (s: string) => s;
    result[k] = substituteString(v, values, encode);
  }
  return result;
}

export function substitutePayload(
  payload: {
    url: string;
    params: Record<string, string> | null;
    headers: Record<string, string> | null;
    cookies: Record<string, string> | null;
    body: { type: string; payload: string | Record<string, string> | null };
  },
  values: Record<string, unknown>,
) {
  return {
    // URL values are percent-encoded and cookie values are cookie-safe-encoded so
    // an untrusted caller value can't inject extra query params / path segments or
    // smuggle a second cookie. params go through URLSearchParams.set (encoded
    // there, so encoding here would double-encode); header values are CRLF-rejected
    // by Headers (and a `Cookie` header gets cookie-safe encoding, see
    // substituteHeaders). NOTE: a value used as the URL authority is percent-encoded
    // too — the scheme+host must be literal in the URL.
    url: substituteString(payload.url, values, encodeURIComponent),
    params: substituteRecord(payload.params, values),
    headers: substituteHeaders(payload.headers, values),
    cookies: substituteRecord(payload.cookies, values, encodeCookieValue),
    body: {
      type: payload.body.type,
      payload:
        payload.body.payload === null
          ? null
          : typeof payload.body.payload === 'string'
            ? substituteString(payload.body.payload, values)
            : substituteRecord(payload.body.payload, values),
    },
  };
}
