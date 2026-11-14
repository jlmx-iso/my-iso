// Real Google sign-in against the built Worker: the browser clicks "Sign in
// with Google" on /login, goes through the consent page of a local OpenID
// provider (src/test/helpers/oidcStub.ts, started by e2e/serve.mjs and set as
// the Worker's GOOGLE_OAUTH_ISSUER_URL), and comes back through Auth.js's
// callback: discovery, token exchange, ID token checks, the callbacks and the
// adapter on D1, then the session cookie. Nothing leaves this machine.

import { readdirSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";
import Database from "better-sqlite3";

import { E2E_DELETING_MEMBER, E2E_OIDC_ISSUER, E2E_STATE_DIR } from "./config.mjs";
import { isolate, ORIGIN } from "./helpers";

const externalRequests: string[] = [];
const cspViolations: string[] = [];

test.beforeEach(async ({ context }) => {
  externalRequests.length = 0;
  cspViolations.length = 0;
  await isolate(context, externalRequests, { alsoAllow: [E2E_OIDC_ISSUER] });
  // Every policy violation on the app's own pages fails the test.
  await context.exposeBinding("__reportCspViolation", (_source, violation: string) => {
    cspViolations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __reportCspViolation: (v: string) => void }).__reportCspViolation;
      report(`${location.pathname}: ${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
});

test.afterEach(() => {
  expect(externalRequests, "requests to hosts other than the Worker and the OpenID stub").toEqual([]);
  expect(cspViolations, "Content-Security-Policy violations").toEqual([]);
});

/** The local D1 the Worker under test uses, read-only. */
function d1() {
  const dir = path.join(E2E_STATE_DIR, "v3", "d1", "miniflare-D1DatabaseObject");
  const file = readdirSync(dir).find((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  if (!file) throw new Error(`no local D1 database in ${dir}`);
  return new Database(path.join(dir, file), { fileMustExist: true, readonly: true });
}

/** "Sign in with Google" on /login, then the provider's consent as `email`. */
async function signInWithGoogle(page: Page, email: string, givenName: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with Google" }).click();

  await page.waitForURL(`${E2E_OIDC_ISSUER}/authorize?**`);
  await expect(page.getByRole("heading", { name: "Sign in with the test provider" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("First name").fill(givenName);
  await page.getByLabel("Last name").fill("Tester");
  await page.getByRole("button", { name: "Continue" }).click();
}

/** A unique address per run and colour-scheme project (they share one database). */
function address(name: string, project: string) {
  return `${name}-${project}-${Date.now()}@example.com`;
}

test("an invitee signs up with Google and lands signed in on the app", async ({ page }, testInfo) => {
  const email = address("invitee", testInfo.project.name);
  // What /join does with a valid code: remember it for this address.
  const prepared = await page.request.post(`${ORIGIN}/api/trpc/invite.prepareRegistration`, {
    data: { json: { code: "ISO-SARAH-A2B3C4D5", email } },
  });
  expect(prepared.status()).toBe(200);

  await signInWithGoogle(page, email, "Invited");

  await page.waitForURL(/\/app(\/|$)/);
  expect(new URL(page.url()).origin).toBe(ORIGIN);
  const session = (await (await page.request.get(`${ORIGIN}/api/auth/session`)).json()) as {
    user?: { email?: string; firstName?: string; id?: string };
  };
  expect(session.user).toMatchObject({ email, firstName: "Invited" });

  const db = d1();
  try {
    const user = db
      .prepare('SELECT id, firstName, lastName, invitedByUserId FROM "User" WHERE email = ?')
      .get(email) as { firstName: string; id: string; invitedByUserId: string | null; lastName: string } | undefined;
    expect(user).toMatchObject({ firstName: "Invited", id: session.user?.id, invitedByUserId: "seed_u1", lastName: "Tester" });
    const accounts = db
      .prepare('SELECT provider, type, access_token, refresh_token, id_token FROM "Account" WHERE userId = ?')
      .all(user?.id);
    // The link only: no OAuth token is stored.
    expect(accounts).toEqual([
      { access_token: null, id_token: null, provider: "google", refresh_token: null, type: "oidc" },
    ]);
  } finally {
    db.close();
  }
});

test("an address without an invite is sent to /join and told it needs one", async ({ page }, testInfo) => {
  const email = address("stranger", testInfo.project.name);

  await signInWithGoogle(page, email, "Stranger");

  await page.waitForURL(`${ORIGIN}/join?error=invite_required`);
  await expect(page.getByText("You need a valid invite code to create an account.")).toBeVisible();
  const db = d1();
  try {
    expect(db.prepare('SELECT COUNT(*) AS n FROM "User" WHERE email = ?').get(email)).toEqual({ n: 0 });
  } finally {
    db.close();
  }
  const session: unknown = await (await page.request.get(`${ORIGIN}/api/auth/session`)).json();
  expect(session).toBeNull();
});

test("an account being deleted cannot sign in, and is told why", async ({ page }) => {
  await signInWithGoogle(page, E2E_DELETING_MEMBER.email, "Leaving");

  await page.waitForURL(`${ORIGIN}/login?error=deletion_pending`);
  await expect(page.getByTestId("login-error")).toHaveText(
    "This account is still being deleted. Try again in a few minutes or contact support.",
  );
  const session: unknown = await (await page.request.get(`${ORIGIN}/api/auth/session`)).json();
  expect(session).toBeNull();
});
