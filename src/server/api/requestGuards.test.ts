import { describe, expect, it } from "vitest";

import {
  countBatchedProcedures,
  guardTrpcRequest,
  MAX_TRPC_BATCH_SIZE,
  MAX_TRPC_BODY_BYTES,
} from "./requestGuards";

const ENDPOINT = "/api/trpc";
const ORIGIN = "https://myiso.app";

function request(path: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

const procedures = (count: number) =>
  Array.from({ length: count }, () => "auth.verifyMobileOtp").join(",");

describe("countBatchedProcedures", () => {
  it("counts the comma-separated procedures of a tRPC path", () => {
    expect(countBatchedProcedures("/api/trpc/user.getMe", ENDPOINT)).toBe(1);
    expect(countBatchedProcedures("/api/trpc/a.b,c.d,e.f", ENDPOINT)).toBe(3);
    expect(countBatchedProcedures("/api/trpc/a.b%2Cc.d", ENDPOINT)).toBe(2);
    expect(countBatchedProcedures("/api/trpc/", ENDPOINT)).toBe(0);
  });
});

describe("guardTrpcRequest", () => {
  it("lets single calls and small query batches through", () => {
    expect(guardTrpcRequest(request("/api/trpc/user.getMe"), ENDPOINT)).toBeNull();
    expect(
      guardTrpcRequest(request(`/api/trpc/${procedures(MAX_TRPC_BATCH_SIZE)}?batch=1`), ENDPOINT),
    ).toBeNull();
    expect(
      guardTrpcRequest(
        request("/api/trpc/auth.verifyMobileOtp", { body: "{}", method: "POST" }),
        ENDPOINT,
      ),
    ).toBeNull();
  });

  it("refuses a query batch over the cap", async () => {
    const response = guardTrpcRequest(
      request(`/api/trpc/${procedures(MAX_TRPC_BATCH_SIZE + 1)}?batch=1`),
      ENDPOINT,
    );
    expect(response?.status).toBe(400);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses any batched mutation, however small", () => {
    const response = guardTrpcRequest(
      request(`/api/trpc/${procedures(2)}?batch=1`, { body: "{}", method: "POST" }),
      ENDPOINT,
    );
    expect(response?.status).toBe(400);
  });

  it("refuses a batched mutation that hides its commas with URL encoding", () => {
    const encoded = procedures(3).replaceAll(",", "%2C");
    const response = guardTrpcRequest(
      request(`/api/trpc/${encoded}?batch=1`, { body: "{}", method: "POST" }),
      ENDPOINT,
    );
    expect(response?.status).toBe(400);
  });

  it("refuses a body larger than the limit by its declared length", () => {
    const tooLarge = request("/api/trpc/photographer.addPortfolioImage", {
      body: "{}",
      headers: { "content-length": String(MAX_TRPC_BODY_BYTES + 1) },
      method: "POST",
    });
    expect(guardTrpcRequest(tooLarge, ENDPOINT)?.status).toBe(413);

    const atLimit = request("/api/trpc/photographer.addPortfolioImage", {
      body: "{}",
      headers: { "content-length": String(MAX_TRPC_BODY_BYTES) },
      method: "POST",
    });
    expect(guardTrpcRequest(atLimit, ENDPOINT)).toBeNull();
  });

  it("answers a malformed path with 400 instead of throwing", () => {
    expect(guardTrpcRequest(request("/api/trpc/%E0%A4%A"), ENDPOINT)?.status).toBe(400);
  });
});
