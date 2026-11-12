import { describe, expect, it, vi } from "vitest";

import { CLOUDINARY_DELETE_BATCH, cloudinaryPublicId, deleteCloudinaryImages } from "./cloudinaryDelete";

const CLOUD = "test-cloud";
const CREDENTIALS = { apiKey: "key", apiSecret: "secret", cloudName: CLOUD };
const url = (path: string) => `https://res.cloudinary.com/${CLOUD}/image/upload/${path}`;

describe("cloudinaryPublicId", () => {
  it("reads the public id from a delivery URL, without version or extension", () => {
    expect(cloudinaryPublicId(url("v1712/u1/portfolio/abc.jpg"), CLOUD)).toBe("u1/portfolio/abc");
    expect(cloudinaryPublicId(url("app/p1/events/x%20y.png"), CLOUD)).toBe("app/p1/events/x y");
    expect(cloudinaryPublicId(url("v1/noext"), CLOUD)).toBe("noext");
  });

  it("ignores anything that is not an image of this cloud", () => {
    expect(cloudinaryPublicId("not a url", CLOUD)).toBeNull();
    expect(cloudinaryPublicId("https://res.cloudinary.com/other/image/upload/v1/a.jpg", CLOUD)).toBeNull();
    expect(cloudinaryPublicId(`http://res.cloudinary.com/${CLOUD}/image/upload/v1/a.jpg`, CLOUD)).toBeNull();
    expect(cloudinaryPublicId(`https://evil.example/${CLOUD}/image/upload/v1/a.jpg`, CLOUD)).toBeNull();
    expect(cloudinaryPublicId(url("v1/a.jpg"), "")).toBeNull();
    expect(cloudinaryPublicId(url(""), CLOUD)).toBeNull();
    // A malformed escape would make decodeURIComponent throw.
    expect(cloudinaryPublicId(url("v1/bad%E0%A4%A.jpg"), CLOUD)).toBeNull();
  });
});

describe("deleteCloudinaryImages", () => {
  const ok = () => vi.fn(async () => new Response(JSON.stringify({ deleted: {} }), { status: 200 }));

  it("deletes each image of this cloud once, with Basic auth", async () => {
    const fetchImpl = ok();
    const count = await deleteCloudinaryImages(
      [url("v1/u1/a.jpg"), url("v2/u1/a.jpg"), url("v1/u1/b.jpg"), "https://elsewhere.example/c.jpg"],
      CREDENTIALS,
      fetchImpl,
    );
    expect(count).toBe(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [requestUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(requestUrl);
    expect(parsed.pathname).toBe(`/v1_1/${CLOUD}/resources/image/upload`);
    expect(parsed.searchParams.getAll("public_ids[]")).toEqual(["u1/a", "u1/b"]);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("key:secret")}`);
  });

  it("sends at most a batch per call", async () => {
    const fetchImpl = ok();
    const urls = Array.from({ length: CLOUDINARY_DELETE_BATCH + 1 }, (_, i) => url(`v1/u1/${i}.jpg`));
    await expect(deleteCloudinaryImages(urls, CREDENTIALS, fetchImpl)).resolves.toBe(CLOUDINARY_DELETE_BATCH + 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does nothing without images", async () => {
    const fetchImpl = ok();
    await expect(deleteCloudinaryImages([], CREDENTIALS, fetchImpl)).resolves.toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when Cloudinary refuses, or when it is not configured", async () => {
    const refused = vi.fn(async () => new Response("{}", { status: 420 }));
    await expect(deleteCloudinaryImages([url("v1/a.jpg")], CREDENTIALS, refused)).rejects.toThrow(/HTTP 420/);
    await expect(
      deleteCloudinaryImages([url("v1/a.jpg")], { ...CREDENTIALS, apiSecret: "" }, ok()),
    ).rejects.toThrow(/not configured/);
  });

  it("uses the global fetch by default", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(deleteCloudinaryImages([url("v1/a.jpg")], CREDENTIALS)).resolves.toBe(1);
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });
});
