/**
 * Lightweight client-side validation for a tool's inputSchema / outputSchema.
 *
 * Mirrors the backend's rules EXCEPT the final "convertible by Zod" check — Zod
 * is not bundled in the frontend, so that last check is enforced server-side on
 * save. These checks catch the vast majority of mistakes for immediate feedback;
 * the rare Zod-only case is still rejected by the backend.
 *
 * Rules (shared by inputSchema and outputSchema):
 *  - empty / whitespace-only → valid (no schema)
 *  - must be valid JSON
 *  - must be a JSON object (not array / scalar / null)
 *  - top-level `type` must be "object"
 *
 * @returns null when valid (or empty); otherwise a human-readable error message.
 */
export function validateSchemaString(value: string): string | null {
  if (!value || value.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return 'Not valid JSON';
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Must be a JSON object';
  }

  if ((parsed as { type?: unknown }).type !== 'object') {
    return 'Top-level "type" must be "object"';
  }

  return null;
}
