import { z } from 'zod';

export interface CompileResult {
  /** Compiled Zod schema; undefined when the input is empty (no schema). */
  schema?: z.ZodTypeAny;
  /** Set when the input is non-empty but invalid. */
  error?: string;
}

/**
 * Compile a tool schema string (inputSchema or outputSchema) — the single
 * source of truth for both save-time validation and runtime registration.
 *
 * Rules (shared by inputSchema and outputSchema):
 *  1. Empty / whitespace-only → no schema (returns {} — neither schema nor error).
 *  2. Must be valid JSON.
 *  3. Must be a JSON object (not array / scalar / null).
 *  4. Top-level `type` must be `"object"` — MCP tool arguments and
 *     structuredContent are always objects.
 *  5. Must be convertible by `z.fromJSONSchema()`.
 *
 * NOTE: steps 3 and 4 are mandatory — `z.fromJSONSchema()` silently accepts
 * `{"type":"array"}`, `{"type":"string"}`, `{}` and even a bare JSON array.
 */
export function compileSchema(value: string, field: string): CompileResult {
  if (!value || value.trim() === '') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: `${field} is not valid JSON` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: `${field} must be a JSON object` };
  }

  if ((parsed as Record<string, unknown>).type !== 'object') {
    return { error: `${field} top-level "type" must be "object"` };
  }

  try {
    return { schema: z.fromJSONSchema(parsed as Parameters<typeof z.fromJSONSchema>[0]) };
  } catch (e) {
    return { error: `${field} cannot be converted to a Zod schema: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Validate a tool schema string. Thin wrapper over compileSchema for callers
 * that only need the verdict (e.g. save-time validation).
 *
 * @returns null when valid (or empty); otherwise a human-readable error message.
 */
export function validateSchemaString(value: string, field: string): string | null {
  return compileSchema(value, field).error ?? null;
}
