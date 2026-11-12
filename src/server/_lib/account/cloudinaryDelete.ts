// Deleting a member's uploaded images from Cloudinary (account deletion).
// Uses the Admin API's "delete resources" call with HTTP Basic auth, over
// fetch, like the rest of the Workers-compatible client in ~/_lib/cloudinary.

/** The Admin API deletes at most this many public ids per call. */
export const CLOUDINARY_DELETE_BATCH = 100;

export type CloudinaryCredentials = { apiKey: string; apiSecret: string; cloudName: string };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The public id of an image delivered from `cloudName`, from its stored
 * `secure_url` (`https://res.cloudinary.com/<cloud>/image/upload/v<version>/<public id>.<ext>`),
 * or null for any other URL. Only URLs of this app's own cloud are ever
 * deleted.
 */
export function cloudinaryPublicId(url: string, cloudName: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const prefix = `/${cloudName}/image/upload/`;
  if (
    cloudName.length === 0 ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "res.cloudinary.com" ||
    !parsed.pathname.startsWith(prefix)
  ) {
    return null;
  }
  let rest: string;
  try {
    rest = decodeURIComponent(parsed.pathname.slice(prefix.length)).replace(/^v\d+\//, "");
  } catch {
    // A malformed escape (URIError): not a URL this app stored.
    return null;
  }
  const publicId = rest.replace(/\.[A-Za-z0-9]+$/, "");
  return publicId.length > 0 ? publicId : null;
}

/**
 * Deletes the images at `urls` (those of this cloud; duplicates once).
 * An image that is already gone counts as deleted, so a retry is safe.
 * Throws when Cloudinary refuses or cannot be reached, so the deletion is
 * retried later rather than leaving photos behind.
 */
export async function deleteCloudinaryImages(
  urls: readonly string[],
  credentials: CloudinaryCredentials,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<number> {
  const publicIds = [
    ...new Set(
      urls
        .map((url) => cloudinaryPublicId(url, credentials.cloudName))
        .filter((id): id is string => id !== null),
    ),
  ];
  if (publicIds.length === 0) return 0;
  if (!credentials.apiKey || !credentials.apiSecret) {
    throw new Error("Cloudinary credentials are not configured; images cannot be deleted");
  }

  const authorization = `Basic ${btoa(`${credentials.apiKey}:${credentials.apiSecret}`)}`;
  for (let start = 0; start < publicIds.length; start += CLOUDINARY_DELETE_BATCH) {
    const batch = publicIds.slice(start, start + CLOUDINARY_DELETE_BATCH);
    const url = new URL(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/resources/image/upload`,
    );
    for (const id of batch) url.searchParams.append("public_ids[]", id);
    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: authorization },
      method: "DELETE",
    });
    // Drain the body either way; it says "deleted" or "not_found" per id.
    await response.arrayBuffer();
    if (!response.ok) {
      throw new Error(`Cloudinary refused to delete images (HTTP ${response.status})`);
    }
  }
  return publicIds.length;
}
