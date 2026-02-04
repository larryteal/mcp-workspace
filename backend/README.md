```bash
pnpm install
npx wrangler d1 migrations apply DB --local
pnpm run dev
```

```bash
### DB
# Staging
npx wrangler d1 migrations apply DB --remote --env staging
# Production
# npx wrangler d1 migrations apply DB --remote --env production
```

```bash
pnpm run deploy:staging
# pnpm run deploy:production
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```bash
pnpm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
