// Smoke test of the built Worker in workerd (wrangler dev) with a local D1:
// the pages render, and a signed-in member can load the feed and post an
// event. See docs/TESTING.md, "End-to-end".

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";

import { E2E_AUTH_SECRET, E2E_MEMBER, E2E_PORT } from "./config.mjs";

const ORIGIN = `http://localhost:${E2E_PORT}`;
// On plain http Auth.js uses the unprefixed cookie name, which is also the
// salt of the encrypted token.
const SESSION_COOKIE = "authjs.session-token";

/**
 * Signs `context` in as the seeded member: the same encrypted JWT Auth.js
 * would set after a sign-in (this app uses the JWT session strategy).
 */
async function signIn(context: BrowserContext) {
  const value = await encode({
    salt: SESSION_COOKIE,
    secret: E2E_AUTH_SECRET,
    token: {
      email: E2E_MEMBER.email,
      firstName: E2E_MEMBER.firstName,
      id: E2E_MEMBER.id,
      lastName: E2E_MEMBER.lastName,
      name: `${E2E_MEMBER.firstName} ${E2E_MEMBER.lastName}`,
      profilePic: null,
      sub: E2E_MEMBER.id,
    },
  });
  await context.addCookies([
    { httpOnly: true, name: SESSION_COOKIE, sameSite: "Lax", url: ORIGIN, value },
  ]);
}

/**
 * Picks the day `days` from today in the create-event form's date picker,
 * keeping the time it shows. (The field starts at "now", which the form
 * refuses as not in the future.)
 */
async function pickDateDaysAhead(page: Page, days: number) {
  const today = new Date();
  const target = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  await page.getByRole("dialog").getByLabel("Date").click();
  if (target.getMonth() !== today.getMonth()) {
    await page.locator('[data-direction="next"]').first().click();
  }
  const label = target.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  await page.getByRole("button", { exact: true, name: label }).click();
  await page.locator(".mantine-DateTimePicker-submitButton").click();
}

test("the landing page renders", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toContainText(/second shooter/i);
});

test("the sign-in page renders", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("textbox", { name: /email/i }).first()).toBeVisible();
});

test("an anonymous visitor to the app is sent to sign in", async ({ page }) => {
  await page.goto("/app/events");
  await expect(page).toHaveURL(/\/login/);
});

test("a signed-in member loads the feed and creates an event", async ({ context, page }) => {
  await signIn(context);

  const response = await page.goto("/app/events");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  // The seeded feed.
  await expect(page.getByText("Spring Wedding at Barton Creek", { exact: false }).first()).toBeVisible();

  const title = `E2E shoot ${Date.now()}`;
  await page.getByRole("button", { name: "Create Event" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Description").fill("Created by the end-to-end smoke test.");
  await pickDateDaysAhead(page, 7);
  await dialog.getByLabel("Location").fill("Austin, TX");
  await dialog.getByRole("button", { name: "Create Event" }).click();

  await expect(dialog.getByText("Event created successfully!")).toBeVisible();
  await page.goto("/app/events");
  await expect(page.getByText(title)).toBeVisible();
});
