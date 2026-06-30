const VAR_PATTERN = /\{\{(\w+)\}\}/g;

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
 */
export function substituteString(text: string, values: Record<string, unknown>): string {
  return text.replace(VAR_PATTERN, (_match, name: string) => {
    return name in values ? stringifyValue(values[name]) : '';
  });
}

export function substituteRecord(
  rec: Record<string, string> | null,
  values: Record<string, unknown>,
): Record<string, string> | null {
  if (!rec) return null;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    result[k] = substituteString(v, values);
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
    url: substituteString(payload.url, values),
    params: substituteRecord(payload.params, values),
    headers: substituteRecord(payload.headers, values),
    cookies: substituteRecord(payload.cookies, values),
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
