// Shared by the E2E server (serve.mjs) and the tests. Placeholders only.

/** Port of the local Worker under test (8787 is left for `npm run dev:wrangler`). */
export const E2E_PORT = 8788;

/** Signs the test's session cookie; the Worker under test uses the same. */
export const E2E_AUTH_SECRET = "e2e-auth-secret-not-a-real-secret-0123456789";

/** A seeded member with a photographer profile (prisma/seed-staging.sql). */
export const E2E_MEMBER = {
  email: "sarah@example.com",
  firstName: "Sarah",
  id: "seed_u1",
  lastName: "Chen",
};

/**
 * The local OpenID provider standing in for Google
 * (src/test/helpers/oidcStub.ts), started by serve.mjs. The Worker is
 * pointed at it with GOOGLE_OAUTH_ISSUER_URL.
 */
export const E2E_OIDC_PORT = 8789;
export const E2E_OIDC_ISSUER = `http://127.0.0.1:${E2E_OIDC_PORT}`;
export const E2E_GOOGLE_CLIENT = { clientId: "e2e-placeholder", clientSecret: "e2e-placeholder" };

/**
 * An account whose deletion has started (written by serve.mjs): hidden from
 * every read, its address still held, its Google account still linked.
 */
export const E2E_DELETING_MEMBER = { email: "leaving@example.com", id: "e2e_deleting" };

/** Where serve.mjs keeps the local D1 (and the tests read it). */
export const E2E_STATE_DIR = "e2e/.state";
