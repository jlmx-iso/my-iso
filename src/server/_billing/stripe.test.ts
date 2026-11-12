import { describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => {
  const env: Record<string, string | undefined> = {
    NEXT_PUBLIC_BASE_URL: "https://app.example.com",
    NODE_ENV: "production",
    STRIPE_API_BASE_URL: "http://127.0.0.1:3851",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "",
  };
  return { env };
});
vi.mock("~/env", () => envMock);

import {
  getStripe,
  isProductionDeployment,
  isWebhookSecretConfigured,
  parseStripeApiBaseUrl,
} from "./stripe";

const local = { baseUrl: "http://localhost:3000", isWorkerRuntime: false, nodeEnv: "development", secretKey: "sk_test_abc" };

describe("STRIPE_API_BASE_URL", () => {
  it("is honoured for loopback addresses outside production", () => {
    expect(parseStripeApiBaseUrl(undefined)).toBeNull();
    expect(parseStripeApiBaseUrl("")).toBeNull();
    expect(parseStripeApiBaseUrl("http://127.0.0.1:3851")).toEqual({ host: "127.0.0.1", port: "3851", protocol: "http" });
    expect(parseStripeApiBaseUrl("https://localhost")).toEqual({ host: "localhost", port: "443", protocol: "https" });
    expect(parseStripeApiBaseUrl("http://[::1]:12111")).toMatchObject({ host: "[::1]" });
  });

  it.each(["https://api.stripe.com.evil.example", "http://10.0.0.5:3851", "http://localhost.evil.example", "http://127.0.0.1.nip.io"])(
    "is refused for anything that is not this machine (%s)",
    (value) => {
      expect(() => parseStripeApiBaseUrl(value)).toThrow("may only point at localhost");
    },
  );

  it("is refused when it is not a URL", () => {
    expect(() => parseStripeApiBaseUrl("localhost:3851/nope nope")).toThrow();
  });

  it("is refused outright in production, even for a loopback address", () => {
    expect(() => parseStripeApiBaseUrl("http://127.0.0.1:3851", { production: true })).toThrow(
      "must not be set in production",
    );
    // Unset is fine in production: that is the normal case.
    expect(parseStripeApiBaseUrl(undefined, { production: true })).toBeNull();
  });
});

describe("getStripe", () => {
  it("refuses to build a client in a deployed environment that has STRIPE_API_BASE_URL set, and works once it is removed", () => {
    expect(() => getStripe()).toThrow("must not be set in production");

    envMock.env.STRIPE_API_BASE_URL = undefined;
    expect(getStripe()).toBe(getStripe());
  });
});

describe("isProductionDeployment", () => {
  it("is false for local development, tests and a local `wrangler dev` build", () => {
    expect(isProductionDeployment(local)).toBe(false);
    expect(isProductionDeployment({ ...local, nodeEnv: "test" })).toBe(false);
    // An OpenNext build always has NODE_ENV=production, also under wrangler dev.
    expect(isProductionDeployment({ ...local, isWorkerRuntime: true, nodeEnv: "production" })).toBe(false);
  });

  it.each(["sk_live_abc", "rk_live_abc"])("is true with a live-mode key (%s)", (secretKey) => {
    expect(isProductionDeployment({ ...local, secretKey })).toBe(true);
  });

  it("is true when the app is served from anywhere but this machine", () => {
    expect(isProductionDeployment({ ...local, baseUrl: "https://app.example.com", isWorkerRuntime: true, nodeEnv: "production" })).toBe(true);
    expect(isProductionDeployment({ ...local, baseUrl: "https://staging.example.com" })).toBe(true);
    expect(isProductionDeployment({ ...local, baseUrl: undefined })).toBe(true);
    expect(isProductionDeployment({ ...local, baseUrl: "not a url" })).toBe(true);
  });

  it("is true for a production Node server", () => {
    expect(isProductionDeployment({ ...local, nodeEnv: "production" })).toBe(true);
  });
});

describe("isWebhookSecretConfigured", () => {
  it("is false for a missing or blank secret", () => {
    expect(isWebhookSecretConfigured()).toBe(false);
    expect(isWebhookSecretConfigured("   ")).toBe(false);
    expect(isWebhookSecretConfigured("whsec_x")).toBe(true);
  });
});
