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
