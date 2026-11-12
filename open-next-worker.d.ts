/**
 * Types for the generated OpenNext worker (`.open-next/worker.js`).
 *
 * worker.ts imports it as "open-next-worker": wrangler resolves that
 * specifier through `[alias]` in wrangler.toml, TypeScript through `paths` in
 * tsconfig.worker.json. The indirection keeps the generated bundle (which only
 * exists after `npm run build:cf` and is far too large to type-check) out of
 * the TypeScript program. Keep in sync with the exports worker.ts relies on.
 */
import type { CloudflareEnv } from "./cloudflare-env";

declare const worker: {
  fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<Response>;
};
export default worker;

export declare class DOQueueHandler implements DurableObject {
  constructor(ctx: DurableObjectState, env: CloudflareEnv);
}
export declare class DOShardedTagCache implements DurableObject {
  constructor(ctx: DurableObjectState, env: CloudflareEnv);
}
