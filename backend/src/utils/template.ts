const VAR_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Extract all {{varName}} references from a string.
 */
export function extractVariables(text: string): string[] {
  const vars: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = VAR_PATTERN.exec(text)) !== null) {
    if (!vars.includes(match[1])) {
      vars.push(match[1]);
    }
  }
  return vars;
}

/**
 * Collect all {{var}} references from a tool payload.
 */
export function collectAllVariables(payload: {
  url: string;
  params: Record<string, string> | null;
  headers: Record<string, string> | null;
  cookies: Record<string, string> | null;
  body: { type: string; payload: string | Record<string, string> | null };
}): string[] {
  const all = new Set<string>();

  for (const v of extractVariables(payload.url)) all.add(v);

  const collectRecord = (rec: Record<string, string> | null) => {
    if (!rec) return;
    for (const val of Object.values(rec)) {
      for (const v of extractVariables(val)) all.add(v);
    }
  };

  collectRecord(payload.params);
  collectRecord(payload.headers);
  collectRecord(payload.cookies);

  if (payload.body.payload) {
    if (typeof payload.body.payload === 'string') {
      for (const v of extractVariables(payload.body.payload)) all.add(v);
    } else {
      collectRecord(payload.body.payload);
    }
  }

  return Array.from(all);
}

/**
 * Validate that all {{var}} references exist in inputSchema.properties.
 * Returns list of missing variable names, or empty array if valid.
 */
export function validateVariables(
  payload: {
    url: string;
    params: Record<string, string> | null;
    headers: Record<string, string> | null;
    cookies: Record<string, string> | null;
    body: { type: string; payload: string | Record<string, string> | null };
  },
  inputSchema: Record<string, unknown> | null,
): string[] {
  const refs = collectAllVariables(payload);
  if (refs.length === 0) return [];

  const properties = (inputSchema as { properties?: Record<string, unknown> } | null)?.properties ?? {};
  return refs.filter((v) => !(v in properties));
}

/**
 * Substitute {{var}} placeholders with values from the provided map.
 */
export function substituteString(text: string, values: Record<string, string>): string {
  return text.replace(VAR_PATTERN, (match, name) => {
    return name in values ? values[name] : match;
  });
}

export function substituteRecord(
  rec: Record<string, string> | null,
  values: Record<string, string>,
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
  values: Record<string, string>,
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
