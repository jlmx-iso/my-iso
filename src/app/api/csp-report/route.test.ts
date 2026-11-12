import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("~/server/_lib/posthog", () => ({ captureEvent: mocks.captureEvent }));
vi.mock("~/server/_utils/rateLimit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/_lib/site", () => ({ SITE_URL: "https://myiso.app" }));

import { POST } from "./route";

function report(body: Record<string, unknown>): Request {
  return new Request("https://myiso.app/api/csp-report", {
    body: JSON.stringify({ "csp-report": body }),
    headers: { "Content-Type": "application/csp-report" },
    method: "POST",
  });
}

const probe = {
  "blocked-uri": "eval",
  disposition: "report",
  "document-uri": "https://myiso.app/app/events",
  "effective-directive": "script-src",
  "source-file": "https://myiso.app/_next/static/chunks/5678-ef01.js",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 1, retryAfter: 0 });
});

describe("POST /api/csp-report", () => {
  it("drops the first-party eval probe before the rate-limit write, with no event", async () => {
    const response = await POST(report(probe));
    expect(response.status).toBe(204);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });

  it("records an eval probe from a /_next/static/ script on another origin", async () => {
    const response = await POST(
      report({ ...probe, "source-file": "https://cdn.example/_next/static/chunks/5678-ef01.js" }),
    );
    expect(response.status).toBe(204);
    expect(mocks.checkRateLimit).toHaveBeenCalledOnce();
    expect(mocks.captureEvent).toHaveBeenCalledOnce();
  });

  it("drops a probe without a source file only for the app's own page", async () => {
    const { "source-file": _source, ...withoutSource } = probe;
    await POST(report(withoutSource));
    expect(mocks.captureEvent).not.toHaveBeenCalled();

    await POST(report({ ...withoutSource, "document-uri": "https://elsewhere.example/page" }));
    expect(mocks.captureEvent).toHaveBeenCalledOnce();
  });

  it("still records a real violation", async () => {
    const response = await POST(
      report({ ...probe, "blocked-uri": "https://evil.example/x.js", "effective-directive": "script-src-elem" }),
    );
    expect(response.status).toBe(204);
    expect(mocks.checkRateLimit).toHaveBeenCalledOnce();
    expect(mocks.captureEvent).toHaveBeenCalledExactlyOnceWith(
      "csp-report",
      "csp_violation",
      expect.objectContaining({ blocked: "https://evil.example/x.js", documentPath: "/app/events" }),
    );
  });
});
