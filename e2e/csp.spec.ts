// The enforced Content-Security-Policy against the built Worker: the key
// pages load without a single violation, signed out and signed in, and the
// policy does block what it is there to block. docs/adr/0002-csp.md.

import { expect, type Page, test } from "@playwright/test";

import { isolate, ORIGIN, signIn } from "./helpers";

type Violation = { blockedURI: string; directive: string; disposition: string; page: string; sample: string };

const externalRequests: string[] = [];
const violations: Violation[] = [];
const consoleErrors: string[] = [];

test.beforeEach(async ({ context, page }) => {
  externalRequests.length = 0;
  violations.length = 0;
  consoleErrors.length = 0;
  await isolate(context, externalRequests);

  // Every `securitypolicyviolation` event of every document, reported back
  // to the test as it happens (a listener added before any page script).
  await context.exposeBinding("__reportCspViolation", (_source, violation: Violation) => {
    violations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __reportCspViolation: (v: unknown) => void })
        .__reportCspViolation;
      report({
        blockedURI: event.blockedURI,
        directive: event.effectiveDirective,
        disposition: event.disposition,
        page: location.pathname,
        sample: event.sample,
      });
    });
  });
  page.on("console", (message) => {
    if (/Content[- ]Security[- ]Policy/i.test(message.text())) consoleErrors.push(message.text());
  });
});

test.afterEach(() => {
  expect(externalRequests, "requests to hosts other than the Worker under test").toEqual([]);
});

/** Loads `path`, lets its scripts settle, and checks the policy it came with. */
async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response, path).not.toBeNull();
  const policy = await response?.headerValue("content-security-policy");
  expect(policy, `${path} is served with an enforced policy`).toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/,
  );
  await page.waitForLoadState("networkidle");
}

function expectNoViolations() {
  expect(violations, "Content-Security-Policy violations").toEqual([]);
  expect(consoleErrors, "Content-Security-Policy console errors").toEqual([]);
}

test("public pages load without a policy violation", async ({ page }) => {
  for (const path of [
    "/",
    "/login",
    "/join",
    "/waitlist",
    "/about",
    "/privacy",
    "/terms",
    "/contact",
    "/photographer/marcusrivera",
    "/no-such-page",
  ]) {
    await visit(page, path);
  }
  // Client-side navigation loads further chunks.
  await page.goto("/");
  await page.locator('a[href="/login"]:visible').first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.waitForLoadState("networkidle");
  expectNoViolations();
});

test("a signed-in member's pages load without a policy violation", async ({ context, page }) => {
  await signIn(context);
  await visit(page, "/app/events");

  // A conversation to open, started the way the app starts one.
  const threadId = await page.evaluate(async () => {
    const response = await fetch("/api/trpc/message.createThread", {
      body: JSON.stringify({ json: { initialMessage: "Hello from the CSP test", participants: ["seed_u2"] } }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return /"id":"([^"]+)"/.exec(await response.text())?.[1] ?? null;
  });
  expect(threadId).not.toBeNull();

  for (const path of [
    "/app/events/seed_e1",
    "/app/bookings",
    "/app/messages",
    `/app/messages/${threadId ?? ""}`,
    "/app/search",
    "/app/discover",
    "/app/profile",
    "/app/photographer/seed_u2",
    "/app/settings",
    "/app/notifications",
    "/photographer/sarahchen",
  ]) {
    await visit(page, path);
  }

  // A dialog (portals, transitions, inline styles).
  await visit(page, "/app/events");
  await page.getByRole("button", { exact: true, name: "Create event" }).click();
  await expect(page.getByRole("dialog", { name: "Create event" })).toBeVisible();
  expectNoViolations();
});

test("each response gets its own nonce, on every script it serves", async ({ request }) => {
  const nonces = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    const response = await request.get(`${ORIGIN}/about`);
    const policy = response.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1] ?? "";
    expect(nonce).not.toBe("");
    nonces.add(nonce);

    const scripts = (await response.text()).match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(script).toContain(` nonce="${nonce}"`);
  }
  expect(nonces.size).toBe(3);
});

test("the policy blocks an injected inline script and reports it", async ({ context, page }) => {
  // Markup an attacker managed to get into the page, without the nonce.
  await context.route(`${ORIGIN}/about`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      "</head>",
      "<script>window.__injected = true</script></head>",
    );
    await route.fulfill({ body: html, response });
  });
  await page.goto("/about");
  await page.waitForLoadState("networkidle");

  expect(await page.evaluate(() => "__injected" in window)).toBe(false);
  expect(violations).toEqual([
    expect.objectContaining({ directive: "script-src-elem", disposition: "enforce", page: "/about" }),
  ]);
  // The page itself still works.
  await expect(page.locator("body")).toContainText(/ISO/);
});
