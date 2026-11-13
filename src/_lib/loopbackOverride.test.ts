import { describe, expect, it } from "vitest";

import { isLoopbackUrl, isProductionDeployment, parseLoopbackOverride } from "./loopbackOverride";

describe("isLoopbackUrl", () => {
  it("accepts this machine's names only", () => {
    expect(isLoopbackUrl("http://localhost:3000")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:8788")).toBe(true);
    expect(isLoopbackUrl("https://localhost.example.com")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});

describe("isProductionDeployment", () => {
  const local = { baseUrl: "http://localhost:8788", isWorkerRuntime: true, nodeEnv: "production", secretKey: "sk_test_x" };

  it("is false for a local Worker build", () => {
    expect(isProductionDeployment(local)).toBe(false);
  });

  it("is true for a deployment that says it is production or staging, wherever it runs", () => {
    expect(isProductionDeployment({ ...local, appEnv: "production" })).toBe(true);
    expect(isProductionDeployment({ ...local, appEnv: "staging" })).toBe(true);
    expect(isProductionDeployment({ ...local, appEnv: "development" })).toBe(false);
  });

  it("is true for a live key, a public origin, or a Node production server", () => {
    expect(isProductionDeployment({ ...local, secretKey: "rk_live_x" })).toBe(true);
    expect(isProductionDeployment({ ...local, baseUrl: "https://myiso.example" })).toBe(true);
    expect(isProductionDeployment({ ...local, isWorkerRuntime: false })).toBe(true);
  });
});

describe("parseLoopbackOverride", () => {
  it("names the variable in every refusal", () => {
    expect(() => parseLoopbackOverride("SOME_URL", "http://127.0.0.1", { production: true })).toThrow(
      "SOME_URL must not be set in production",
    );
    expect(() => parseLoopbackOverride("SOME_URL", "::", { production: false })).toThrow("SOME_URL is not a valid URL");
    expect(() => parseLoopbackOverride("SOME_URL", "http://192.168.1.2", { production: false })).toThrow(
      "SOME_URL may only point at localhost",
    );
  });

  it("returns the URL when allowed, and null when unset", () => {
    expect(parseLoopbackOverride("SOME_URL", "http://localhost:9/x", { production: false })?.pathname).toBe("/x");
    expect(parseLoopbackOverride("SOME_URL", undefined, { production: true })).toBeNull();
  });
});
