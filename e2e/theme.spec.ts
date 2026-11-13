// The appearance setting (System / Light / Dark) against the built Worker:
// the choice is applied to <html> at once, kept across a reload, applied
// before the app's JavaScript runs (no flash: the nonce'd ColorSchemeScript
// in <head> does it), and System follows the device. Runs in both the light
// and the dark project.

import { expect, type Page, test } from "@playwright/test";

import { isolate, ORIGIN, signIn } from "./helpers";

const externalRequests: string[] = [];
const hydrationMessages: string[] = [];
const violations: string[] = [];

test.beforeEach(async ({ context, page }) => {
  externalRequests.length = 0;
  hydrationMessages.length = 0;
  violations.length = 0;
  await isolate(context, externalRequests);
  // A privacy choice already made, so the consent banner covers nothing.
  await context.addCookies([{ name: "iso_consent", url: ORIGIN, value: "denied" }]);
  // Switching schemes injects a <style> (Mantine pauses transitions): the
  // policy must allow it, as it allows the rest of Mantine's styles.
  await context.exposeBinding("__reportCspViolation", (_source, directive: string) => {
    violations.push(directive);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __reportCspViolation: (d: string) => void }).__reportCspViolation(event.effectiveDirective);
    });
  });
  page.on("console", (message) => {
    // Production React reports a mismatch as a minified error (#418, #423, #425).
    if (/hydrat|did not match|didn't match|react\.dev\/errors\/4(18|19|22|23|25)/i.test(message.text())) {
      hydrationMessages.push(message.text());
    }
  });
});

test.afterEach(() => {
  expect(externalRequests, "requests to hosts other than the Worker under test").toEqual([]);
  expect(hydrationMessages, "hydration warnings").toEqual([]);
  expect(violations, "Content-Security-Policy violations").toEqual([]);
});

const scheme = (page: Page) => page.locator("html");

async function choose(page: Page, option: "System" | "Light" | "Dark", within = page.locator("footer")) {
  const group = within.getByRole("radiogroup", { name: "Appearance" });
  await group.getByText(option, { exact: true }).click();
  await expect(group.getByRole("radio", { name: option })).toBeChecked();
}

test("signed out: Dark from the footer applies at once, survives a reload and is applied before hydration", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "light");

  await choose(page, "Dark");
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "dark");
  expect(await page.evaluate(() => window.localStorage.getItem("mantine-color-scheme-value"))).toBe("dark");

  // A reload: dark, and the control shows the choice.
  await page.reload();
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "dark");
  await expect(page.locator("footer").getByRole("radio", { name: "Dark" })).toBeChecked();

  // Again with the app's own JavaScript refused: nothing hydrates, so the
  // attribute can only come from the inline script in <head>, which runs
  // before the body is painted. The server HTML itself says "light".
  await page.route(/\/_next\/static\/.*\.js$/, (route) => route.abort("blockedbyclient"));
  const response = await page.reload();
  expect(await response?.text()).toContain('data-mantine-color-scheme="light"');
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "dark");
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // dark.7, the page colour (#111a2b).
  expect(background).toBe("rgb(17, 26, 43)");
});

test("System follows the device's colour scheme, and Light overrides it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await choose(page, "Light");
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "light");

  await choose(page, "System");
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "dark");

  // After a reload too.
  await page.reload();
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "dark");
  await expect(page.locator("footer").getByRole("radio", { name: "System" })).toBeChecked();
});

test("signed in: the choice made in Settings carries over to the rest of the app", async ({ context, page }) => {
  await signIn(context);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/app/settings");
  await choose(page, "Dark", page.getByRole("main"));
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "dark");

  await page.goto("/app/events");
  await expect(scheme(page)).toHaveAttribute("data-mantine-color-scheme", "dark");
});
