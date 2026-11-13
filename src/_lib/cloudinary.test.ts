import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cloudinaryClient } from "./cloudinary";

// Cloudinary is never called: `fetch` is replaced at the boundary and the
// signatures are checked against an independent SHA-1 of the documented
// string-to-sign (parameters sorted, joined with &, then the API secret).
const fetchMock = vi.fn<typeof fetch>();
const NOW_MS = Date.UTC(2030, 0, 1, 12, 0, 0, 400);
const TIMESTAMP = Math.round(NOW_MS / 1000);
const SECRET = "test-cloudinary-secret";

const sha1 = (value: string) => createHash("sha1").update(value).digest("hex");
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });

function requestedUrl(call = 0): URL {
  const [input] = fetchMock.mock.calls[call] ?? [];
  if (typeof input !== "string") throw new Error("fetch was not called with a URL string");
  return new URL(input);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ now: NOW_MS, toFake: ["Date"] });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createImageTag", () => {
  it("points at the app's own cloud", () => {
    expect(cloudinaryClient.createImageTag("folder/pic")).toBe(
      '<img src="https://res.cloudinary.com/test-cloud/image/upload/folder/pic" />',
    );
  });
});

describe("getAssetInfo", () => {
  it("asks for the asset with a signed request and returns its first resource", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ resources: [{ secure_url: "https://res.cloudinary.com/x.jpg" }] }));

    await expect(cloudinaryClient.getAssetInfo("portfolio/1")).resolves.toEqual({
      secure_url: "https://res.cloudinary.com/x.jpg",
    });

    const url = requestedUrl();
    expect(`${url.origin}${url.pathname}`).toBe("https://api.cloudinary.com/v1_1/test-cloud/resources/image/upload");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_key: "test-cloudinary-key",
      public_ids: "portfolio/1",
      signature: sha1(`public_id=portfolio/1&timestamp=${TIMESTAMP}${SECRET}`),
      timestamp: String(TIMESTAMP),
    });
  });

  it("returns nothing when Cloudinary refuses, finds nothing, or cannot be reached", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    await expect(cloudinaryClient.getAssetInfo("a")).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: [] }));
    await expect(cloudinaryClient.getAssetInfo("a")).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(cloudinaryClient.getAssetInfo("a")).resolves.toBeUndefined();

    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    await expect(cloudinaryClient.getAssetInfo("a")).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe("getAssetsByPrefix", () => {
  it("lists up to five images under the prefix with a signed request", async () => {
    const resources = [{ public_id: "portfolios/u1/a" }, { public_id: "portfolios/u1/b" }];
    fetchMock.mockResolvedValue(jsonResponse({ resources }));

    await expect(cloudinaryClient.getAssetsByPrefix("portfolios/u1")).resolves.toEqual({
      isErr: false,
      isOk: true,
      value: { resources },
    });

    const url = requestedUrl();
    expect(`${url.origin}${url.pathname}`).toBe("https://api.cloudinary.com/v1_1/test-cloud/resources/image");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_key: "test-cloudinary-key",
      max_results: "5",
      prefix: "portfolios/u1",
      signature: sha1(`max_results=5&prefix=portfolios/u1&timestamp=${TIMESTAMP}&type=upload${SECRET}`),
      timestamp: String(TIMESTAMP),
      type: "upload",
    });
  });

  it("returns an error with the status when Cloudinary refuses", async () => {
    fetchMock.mockResolvedValue(new Response("Invalid signature", { status: 401 }));

    const result = await cloudinaryClient.getAssetsByPrefix("p");

    expect(result).toMatchObject({ isErr: true });
    expect(result.isErr && result.error.message).toBe("Cloudinary API error: 401");
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("Failed to fetch assets from Cloudinary");
  });

  it("returns the error when the request fails, and a generic one for a non-Error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    const failed = await cloudinaryClient.getAssetsByPrefix("p");
    expect(failed.isErr && failed.error.message).toBe("network down");

    fetchMock.mockRejectedValueOnce("socket hang up");
    const odd = await cloudinaryClient.getAssetsByPrefix("p");
    expect(odd.isErr && odd.error.message).toBe("An unknown error occurred while fetching assets.");
  });
});

describe("upload", () => {
  const image = { base64: "AAAA", mime: "image/png" };

  it("posts the image as a signed upload converted to JPEG", async () => {
    const uploaded = {
      bytes: 3,
      created_at: "2030-01-01T12:00:00Z",
      format: "jpg",
      height: 1,
      public_id: "u1/profile/x",
      secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v1/u1/profile/x.jpg",
      width: 1,
    };
    fetchMock.mockResolvedValue(jsonResponse(uploaded));

    await expect(cloudinaryClient.upload(image, "u1/profile")).resolves.toEqual({
      isErr: false,
      isOk: true,
      value: uploaded,
    });

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("https://api.cloudinary.com/v1_1/test-cloud/image/upload");
    expect(init?.method).toBe("POST");
    const body = init?.body;
    if (!(body instanceof FormData)) throw new Error("the upload is not multipart form data");
    expect(Object.fromEntries(body.entries())).toEqual({
      api_key: "test-cloudinary-key",
      file: "data:image/png;base64,AAAA",
      folder: "u1/profile",
      format: "jpg",
      // Every signed parameter, sorted; the file and api_key are not signed.
      signature: sha1(`folder=u1/profile&format=jpg&timestamp=${TIMESTAMP}${SECRET}`),
      timestamp: String(TIMESTAMP),
    });
  });

  it("returns Cloudinary's message and status when the upload is refused", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: "File size too large" } }, 400));

    await expect(cloudinaryClient.upload(image, "f")).resolves.toEqual({
      error: { http_code: 400, message: "File size too large" },
      isErr: true,
      isOk: false,
    });
  });

  it("says the upload failed when the refusal carries no message", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 502));

    await expect(cloudinaryClient.upload(image, "f")).resolves.toMatchObject({
      error: { http_code: 502, message: "Upload failed" },
    });
  });

  it("answers 500 when the request itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    await expect(cloudinaryClient.upload(image, "f")).resolves.toMatchObject({
      error: { http_code: 500, message: "network down" },
    });

    fetchMock.mockRejectedValueOnce(42);
    await expect(cloudinaryClient.upload(image, "f")).resolves.toMatchObject({
      error: { http_code: 500, message: "Unknown error" },
    });
  });
});
