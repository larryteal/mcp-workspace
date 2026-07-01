export interface Env {
  DB: D1Database;
  /**
   * Deployment environment. Set per-environment in wrangler.jsonc; `wrangler dev`
   * uses the top-level default "development". Only "development" permits the
   * internal-host guard to allow localhost/private targets (see `isDevEnvironment`).
   */
  ENVIRONMENT?: string;
}

/**
 * True only in the local dev environment, where proxying to internal hosts
 * (localhost/loopback and private/link-local ranges) is permitted. Every other
 * environment (staging/production, or any deploy that doesn't set
 * ENVIRONMENT=development) denies internal targets.
 */
export function isDevEnvironment(env: Env): boolean {
  return env.ENVIRONMENT === 'development';
}
