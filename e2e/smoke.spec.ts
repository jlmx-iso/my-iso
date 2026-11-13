// Smoke test of the built Worker in workerd (wrangler dev) with a local D1:
// the pages render, and a signed-in member can load the feed and post an
// event. See docs/TESTING.md, "End-to-end".

import { expect, test } from "@playwright/test";

import { isolate, signIn } from "./helpers";

/** Hosts other than the Worker under test the browser tried (e2e/helpers.ts). */
const externalRequests: string[] = [];

test.beforeEach(async ({ context }) => {
  externalRequests.length = 0;
  await isolate(context, externalRequests);
});

test.afterEach(() => {
  expect(externalRequests, "requests to hosts other than the Worker under test").toEqual([]);
});

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
  await page.getByRole("button", { exact: true, name: "Create event" }).click();
  const dialog = page.getByRole("dialog", { name: "Create event" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Description").fill("Created by the end-to-end smoke test.");
  // The date is left at the form's default (tomorrow, 10:00), which the
  // form and the server must accept as it is.
  await expect(dialog.getByLabel("Date and time")).not.toHaveText("");
  await dialog.getByLabel("Location").fill("Austin, TX");
  await dialog.getByRole("button", { exact: true, name: "Create event" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(`"${title}" is live`)).toBeVisible();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});

test("the page follows the system colour scheme", async ({ context, page }, testInfo) => {
  await signIn(context);
  const scheme = testInfo.project.use.colorScheme === "dark" ? "dark" : "light";

  await page.goto("/app/events");

  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", scheme);
  // The page background is the scheme's: white, or the dark page colour
  // (dark.7, #212328).
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe(scheme === "dark" ? "rgb(33, 35, 40)" : "rgb(255, 255, 255)");
});
