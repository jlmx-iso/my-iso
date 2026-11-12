/**
 * A stand-in for `next-auth/react` whose session the test controls:
 *
 *   vi.mock("next-auth/react", () => import("~/test/dom/session"));
 *   import { testSession } from "~/test/dom/session";
 *   testSession.signIn("user-1");
 *
 * Only `useSession` is provided; add more when a component needs them.
 */
type TestSession = {
  expires: string;
  user: { email: string; id: string; name: string };
};

let current: TestSession | null = null;

export const testSession = {
  signIn(userId = "user-1") {
    current = {
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      user: { email: `${userId}@example.com`, id: userId, name: "Test User" },
    };
  },
  signOut() {
    current = null;
  },
};

export function useSession() {
  const update = async () => current;
  return current
    ? { data: current, status: "authenticated" as const, update }
    : { data: null, status: "unauthenticated" as const, update };
}
