import { describe, expect, it } from "vitest";

import { isJobsRoutePath, JOBS_ROUTE_PREFIX, jobToken } from "./jobToken";

describe("isJobsRoutePath", () => {
  it.each([
    JOBS_ROUTE_PREFIX,
    `${JOBS_ROUTE_PREFIX}/`,
    `${JOBS_ROUTE_PREFIX}/purge-expired`,
    // Percent-encoded letters, once and twice.
    "/api/internal/%6Aobs/purge-expired",
    "/api/internal/%256Aobs/purge-expired",
    "/%61pi/internal/jobs",
    // Encoded and doubled slashes, backslashes.
    "/api%2Finternal%2Fjobs/purge-expired",
    "/api%2finternal/jobs",
    "//api/internal/jobs/purge-expired",
    "/api//internal///jobs",
    "/api\\internal\\jobs",
    "/api/internal/jobs%5Cpurge-expired",
    // Dot segments, raw and encoded.
    "/api/x/../internal/jobs/purge-expired",
    "/api/internal/./jobs",
    "/api/internal/x/%2E%2E/jobs/purge-expired",
    // Letter case.
    "/API/Internal/JOBS/purge-expired",
    // A malformed escape elsewhere does not stop the rest from decoding.
    "/api/internal/%6Aobs/%E0%A4%A",
  ])("matches %s", (path) => {
    expect(isJobsRoutePath(path)).toBe(true);
  });

  it.each([
    "/",
    "/api/internal",
    "/api/internal/jobsx",
    "/api/internal/job",
    "/api/health",
    "/app/jobs",
    "/api/internal/%E0%A4%A",
  ])("leaves %s alone", (path) => {
    expect(isJobsRoutePath(path)).toBe(false);
  });

  it("agrees with the URL parser on paths the Worker sees", () => {
    for (const raw of ["https://h/api/internal/%6Aobs/x", "https://h/api/internal/./jobs", "https://h/api\\internal\\jobs"]) {
      expect(isJobsRoutePath(new URL(raw).pathname)).toBe(true);
    }
  });
});

describe("jobToken", () => {
  it("is bound to the secret and the job name", async () => {
    const token = await jobToken("secret", "purge-expired");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await jobToken("secret", "purge-expired")).toBe(token);
    expect(await jobToken("secret", "expire-matches")).not.toBe(token);
    expect(await jobToken("other", "purge-expired")).not.toBe(token);
  });
});
