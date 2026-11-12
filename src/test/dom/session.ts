/**
 * A stand-in for `next-auth/react` whose session the test controls:
 *
 *   vi.mock("next-auth/react", () => import("~/test/dom/session"));
 *   import { testSession } from "~/test/dom/session";
 *   testSession.signIn("user-1");
 *
 * `useSession` answers from it; `signIn` (the function a component calls)
 * answers from `testSession.onSignIn` and records its calls in
 * `testSession.signInCalls`; `useSession().update` is counted in
 * `testSession.updates`.
 */
type TestSession = {
  expires: string;
  user: { email: string; id: string; name: string };
};

type SignInResult = { code?: string; error: string | null; ok: boolean; status: number; url: string | null };

let current: TestSession | null = null;

const defaultSignIn = (): Promise<SignInResult> => Promise.resolve({ error: null, ok: true, status: 200, url: null });

export const testSession = {
  /** What a component's `signIn(provider, options)` resolves to (or throws). */
  onSignIn: defaultSignIn as (provider: string, options: Record<string, unknown>) => Promise<SignInResult>,
  signInCalls: [] as Array<{ options: Record<string, unknown>; provider: string }>,
  /** How many times a component asked for the session to be refreshed. */
  updates: 0,
  reset() {
    current = null;
    testSession.onSignIn = defaultSignIn;
    testSession.signInCalls = [];
    testSession.updates = 0;
  },
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
  const update = async () => {
    testSession.updates += 1;
    return current;
  };
  return current
    ? { data: current, status: "authenticated" as const, update }
    : { data: null, status: "unauthenticated" as const, update };
}

export function signIn(provider: string, options: Record<string, unknown> = {}) {
  testSession.signInCalls.push({ options, provider });
  return testSession.onSignIn(provider, options);
}
