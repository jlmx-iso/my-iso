import { describe, expect, it } from "vitest";

import {
  actionableViolations,
  type CspViolation,
  genericPath,
  isFirstPartyEvalProbe,
  MAX_CSP_REPORT_BYTES,
  MAX_REPORTS_PER_REQUEST,
  parseCspReports,
  readBodyCapped,
} from "~/server/_lib/cspReport";

const legacy = {
  "csp-report": {
    "blocked-uri": "https://evil.example/x.js?token=abc#frag",
    disposition: "report",
    "document-uri": "https://myiso.app/app/messages?email=a%40b.co&code=123456",
    "effective-directive": "script-src-elem",
    "line-number": 12,
    "original-policy": "default-src 'self'; ...",
    referrer: "https://myiso.app/login?callbackUrl=%2Fapp",
    "script-sample": "alert(document.cookie)",
    "source-file": "https://myiso.app/_next/static/chunks/a.js?v=1",
    "violated-directive": "script-src-elem",
  },
};

describe("parseCspReports", () => {
  it("reads a report-uri report, keeping only safe fields", () => {
    expect(parseCspReports(legacy)).toEqual([
      {
        blocked: "https://evil.example/x.js",
        directive: "script-src-elem",
        disposition: "report",
        documentOrigin: "https://myiso.app",
        documentPath: "/app/messages",
        lineNumber: 12,
        sourceFile: "https://myiso.app/_next/static/chunks/a.js",
      },
    ]);
  });

  it("never keeps query strings, referrers, the policy or script samples", () => {
    const serialized = JSON.stringify(parseCspReports(legacy));
    for (const secret of ["token=abc", "a%40b.co", "123456", "callbackUrl", "alert(", "original"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("reads Reporting API batches and ignores other report types", () => {
    const reports = parseCspReports([
      { body: { id: "x" }, type: "deprecation" },
      {
        body: {
          blockedURL: "inline",
          disposition: "report",
          documentURL: "https://myiso.app/app?x=1",
          effectiveDirective: "style-src-attr",
          lineNumber: 3,
          sourceFile: "https://myiso.app/app",
        },
        type: "csp-violation",
      },
    ]);
    expect(reports).toEqual([
      {
        blocked: "inline",
        directive: "style-src-attr",
        disposition: "report",
        documentOrigin: "https://myiso.app",
        documentPath: "/app",
        lineNumber: 3,
        sourceFile: "https://myiso.app/app",
      },
    ]);
  });

  it("reduces non-http blocked URLs to their scheme", () => {
    const [report] = parseCspReports({
      "csp-report": { "blocked-uri": "data:text/html;base64,AAAA", "effective-directive": "img-src" },
    });
    expect(report?.blocked).toBe("data");
  });

  it("caps how many reports one request contributes", () => {
    const many = Array.from({ length: 50 }, () => ({
      body: { effectiveDirective: "img-src" },
      type: "csp-violation",
    }));
    expect(parseCspReports(many)).toHaveLength(MAX_REPORTS_PER_REQUEST);
  });

  it("truncates long values", () => {
    const [report] = parseCspReports({
      "csp-report": { "effective-directive": "x".repeat(5000) },
    });
    expect(report?.directive).toHaveLength(200);
  });

  it.each([
    ["null", null],
    ["a string", "report"],
    ["a number", 7],
    ["an empty object", {}],
    ["a report without a body", { "csp-report": null }],
    ["a report without a directive", { "csp-report": { "blocked-uri": "https://x.example" } }],
    ["an array of junk", [1, "two", null, { type: "csp-violation" }]],
    ["wrong types throughout", { "csp-report": { "effective-directive": 5, "line-number": "12" } }],
  ])("yields nothing for %s", (_name, payload) => {
    expect(parseCspReports(payload)).toEqual([]);
  });
});

describe("identifying path segments", () => {
  it("are replaced in the document path and the blocked URL, route names kept", () => {
    const [parsed] = parseCspReports({
      "csp-report": {
        "blocked-uri": "https://cdn.example/download/private-token-a1b2c3/x.js",
        "document-uri": "https://myiso.app/app/messages/cm9x2k7q10000abcdxyz",
        "effective-directive": "script-src-elem",
        "source-file": "https://myiso.app/_next/static/chunks/1234-abcd.js",
      },
    });
    expect(parsed?.documentPath).toBe("/app/messages/:id");
    expect(parsed?.blocked).toBe("https://cdn.example/download/:id/x.js");
    // The script that caused it stays exact: it is the app's own file.
    expect(parsed?.sourceFile).toBe("https://myiso.app/_next/static/chunks/1234-abcd.js");
    expect(genericPath("/download/averyveryveryverylongopaquetoken")).toBe("/download/:id");
  });
});

describe("isFirstPartyEvalProbe", () => {
  const APP = new Set(["https://myiso.app"]);
  const evalReport = (overrides: Partial<CspViolation> = {}): CspViolation => ({
    blocked: "eval",
    directive: "script-src",
    disposition: "report",
    documentOrigin: "https://myiso.app",
    documentPath: "/app/events",
    lineNumber: 1,
    sourceFile: "https://myiso.app/_next/static/chunks/zod.js",
    ...overrides,
  });

  it("recognises the eval probe from the app's own bundle, as browsers report it", () => {
    const [parsed] = parseCspReports({
      "csp-report": {
        "blocked-uri": "eval",
        disposition: "report",
        "document-uri": "https://myiso.app/app/messages",
        "effective-directive": "script-src",
        "source-file": "https://myiso.app/_next/static/chunks/1234-abcd.js",
      },
    });
    expect(parsed && isFirstPartyEvalProbe(parsed, APP)).toBe(true);
  });

  it("keeps a /_next/static/ eval served from another origin", () => {
    for (const sourceFile of [
      "https://cdn.example/_next/static/chunks/x.js",
      "https://myiso.app.evil.example/_next/static/chunks/x.js",
      "http://myiso.app/_next/static/chunks/x.js",
    ]) {
      expect(isFirstPartyEvalProbe(evalReport({ sourceFile }), APP)).toBe(false);
    }
  });

  it("drops a report without a source file only when the page is the app's", () => {
    expect(isFirstPartyEvalProbe(evalReport({ sourceFile: null }), APP)).toBe(true);
    expect(isFirstPartyEvalProbe(evalReport({ documentOrigin: "https://other.example", sourceFile: null }), APP)).toBe(false);
    expect(isFirstPartyEvalProbe(evalReport({ documentOrigin: null, sourceFile: null }), APP)).toBe(false);
  });

  it("keeps an eval from anywhere else, and every other violation", () => {
    expect(isFirstPartyEvalProbe(evalReport({ sourceFile: "https://cdn.example/x.js" }), APP)).toBe(false);
    expect(isFirstPartyEvalProbe(evalReport({ sourceFile: "https://myiso.app/app/page.js" }), APP)).toBe(false);
    expect(isFirstPartyEvalProbe(evalReport({ blocked: "inline" }), APP)).toBe(false);
    expect(isFirstPartyEvalProbe(evalReport({ directive: "style-src" }), APP)).toBe(false);
  });

  it("drops only the probes from a batch", () => {
    const real = evalReport({ blocked: "https://evil.example/x.js", directive: "script-src-elem" });
    const foreign = evalReport({ sourceFile: "https://cdn.example/_next/static/chunks/x.js" });
    expect(actionableViolations([evalReport(), real, evalReport({ sourceFile: null }), foreign], APP)).toEqual([
      real,
      foreign,
    ]);
  });
});

describe("readBodyCapped", () => {
  const request = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("https://myiso.app/api/csp-report", { body, headers, method: "POST" });

  it("returns the body when it fits", async () => {
    await expect(readBodyCapped(request('{"a":1}'), 100)).resolves.toBe('{"a":1}');
    await expect(readBodyCapped(request(null), 100)).resolves.toBe("");
  });

  it("refuses on the declared length alone", async () => {
    const big = request("x", { "Content-Length": String(MAX_CSP_REPORT_BYTES + 1) });
    await expect(readBodyCapped(big, MAX_CSP_REPORT_BYTES)).resolves.toBeNull();
  });

  it("stops reading a body that turns out larger than declared or undeclared", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const streamed = new Request("https://myiso.app/api/csp-report", {
      body: endless,
      duplex: "half",
      method: "POST",
    } as RequestInit);

    await expect(readBodyCapped(streamed, 4096)).resolves.toBeNull();
    expect(pulled).toBeLessThan(20);
  });

  it("decodes multi-byte text split across chunks", async () => {
    const bytes = new TextEncoder().encode("héllo");
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    const streamed = new Request("https://myiso.app/api/csp-report", {
      body: split,
      duplex: "half",
      method: "POST",
    } as RequestInit);
    await expect(readBodyCapped(streamed, 100)).resolves.toBe("héllo");
  });
});
