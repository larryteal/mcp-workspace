/**
 * Application configuration
 * Centralized config for URLs and other settings that may change between environments
 *
 * Note: Some URLs in index.html (og:url, twitter:url) cannot import this config.
 * Update them manually when deploying to production.
 */

export const config = {
  /** GitHub repository URL (also serves as documentation) */
  githubUrl: 'https://github.com/larryteal/mcp-workspace',

  /** Project website URL (for reference - update index.html meta tags manually) */
  websiteUrl: 'https://mcp.lessx.xyz',

  /** Model Context Protocol official website */
  mcpProtocolUrl: 'https://modelcontextprotocol.io',
} as const;
