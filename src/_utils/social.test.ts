import { describe, expect, it } from "vitest";
import {
  facebookUrl,
  isValidSocialHandle,
  normalizeFacebookHandle,
  normalizeTikTokHandle,
  normalizeTwitterHandle,
  normalizeVimeoHandle,
  normalizeYouTubeHandle,
  tikTokUrl,
  toSafeWebsiteUrl,
  twitterUrl,
  vimeoUrl,
  youTubeUrl,
} from "./social";

// ---------------------------------------------------------------------------
// Per-platform normalize
// ---------------------------------------------------------------------------

describe("normalizeFacebookHandle", () => {
  it("strips full URL", () => {
    expect(normalizeFacebookHandle("https://facebook.com/mypage")).toBe("mypage");
  });

  it("strips www URL", () => {
    expect(normalizeFacebookHandle("https://www.facebook.com/mypage")).toBe("mypage");
  });

  it("strips leading @", () => {
    expect(normalizeFacebookHandle("@mypage")).toBe("mypage");
  });

  it("passes through bare handle", () => {
    expect(normalizeFacebookHandle("mypage")).toBe("mypage");
  });
});

describe("normalizeTwitterHandle", () => {
  it("strips twitter.com URL", () => {
    expect(normalizeTwitterHandle("https://twitter.com/user")).toBe("user");
  });

  it("strips x.com URL", () => {
    expect(normalizeTwitterHandle("https://x.com/user")).toBe("user");
  });

  it("strips leading @", () => {
    expect(normalizeTwitterHandle("@user")).toBe("user");
  });
});

describe("normalizeTikTokHandle", () => {
  it("strips tiktok.com URL with @", () => {
    expect(normalizeTikTokHandle("https://tiktok.com/@user")).toBe("user");
  });

  it("strips tiktok.com URL without @", () => {
    expect(normalizeTikTokHandle("https://tiktok.com/user")).toBe("user");
  });

  it("strips leading @", () => {
    expect(normalizeTikTokHandle("@user")).toBe("user");
  });
});

describe("normalizeVimeoHandle", () => {
  it("strips vimeo.com URL", () => {
    expect(normalizeVimeoHandle("https://vimeo.com/myname")).toBe("myname");
  });

  it("passes through bare handle", () => {
    expect(normalizeVimeoHandle("myname")).toBe("myname");
  });
});

describe("normalizeYouTubeHandle", () => {
  it("strips youtube.com URL with @", () => {
    expect(normalizeYouTubeHandle("https://youtube.com/@channel")).toBe("channel");
  });

  it("strips youtube.com URL without @", () => {
    expect(normalizeYouTubeHandle("https://youtube.com/channel")).toBe("channel");
  });
});

// ---------------------------------------------------------------------------
// isValidSocialHandle
// ---------------------------------------------------------------------------

describe("isValidSocialHandle", () => {
  it("accepts alphanumeric handles", () => {
    expect(isValidSocialHandle("user123")).toBe(true);
  });

  it("accepts handles with dots, underscores, and dashes", () => {
    expect(isValidSocialHandle("my.handle_test-ok")).toBe(true);
  });

  it("accepts handles with leading @", () => {
    expect(isValidSocialHandle("@user")).toBe(true);
  });

  it("rejects handles longer than 100 characters", () => {
    expect(isValidSocialHandle("a".repeat(101))).toBe(false);
  });

  it("rejects handles with spaces", () => {
    expect(isValidSocialHandle("my handle")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

describe("facebookUrl", () => {
  it("constructs URL from bare handle", () => {
    expect(facebookUrl("mypage")).toBe("https://facebook.com/mypage");
  });

  it("passes through valid facebook.com URL", () => {
    const url = "https://facebook.com/mypage";
    expect(facebookUrl(url)).toBe(url);
  });

  it("passes through www.facebook.com URL", () => {
    const url = "https://www.facebook.com/mypage";
    expect(facebookUrl(url)).toBe(url);
  });
});

describe("twitterUrl", () => {
  it("constructs URL from bare handle", () => {
    expect(twitterUrl("user")).toBe("https://x.com/user");
  });

  it("passes through x.com URL", () => {
    const url = "https://x.com/user";
    expect(twitterUrl(url)).toBe(url);
  });

  it("passes through twitter.com URL", () => {
    const url = "https://twitter.com/user";
    expect(twitterUrl(url)).toBe(url);
  });
});

describe("tikTokUrl", () => {
  it("constructs URL from bare handle with @", () => {
    expect(tikTokUrl("user")).toBe("https://tiktok.com/@user");
  });

  it("passes through tiktok.com URL", () => {
    const url = "https://tiktok.com/@user";
    expect(tikTokUrl(url)).toBe(url);
  });
});

describe("vimeoUrl", () => {
  it("constructs URL from bare handle", () => {
    expect(vimeoUrl("myname")).toBe("https://vimeo.com/myname");
  });

  it("passes through vimeo.com URL", () => {
    const url = "https://vimeo.com/myname";
    expect(vimeoUrl(url)).toBe(url);
  });
});

describe("youTubeUrl", () => {
  it("constructs URL from bare handle with @", () => {
    expect(youTubeUrl("channel")).toBe("https://youtube.com/@channel");
  });

  it("passes through youtube.com URL", () => {
    const url = "https://youtube.com/@channel";
    expect(youTubeUrl(url)).toBe(url);
  });
});

// ---------------------------------------------------------------------------
// toSafeWebsiteUrl
// ---------------------------------------------------------------------------

describe("toSafeWebsiteUrl", () => {
  it("returns URL as-is for valid https URL", () => {
    expect(toSafeWebsiteUrl("https://example.com")).toBe("https://example.com/");
  });

  it("returns URL as-is for valid http URL", () => {
    expect(toSafeWebsiteUrl("http://example.com")).toBe("http://example.com/");
  });

  it("prepends https to bare domain", () => {
    expect(toSafeWebsiteUrl("example.com")).toBe("https://example.com/");
  });

  it("rejects javascript: scheme", () => {
    expect(toSafeWebsiteUrl("javascript:alert(1)")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(toSafeWebsiteUrl("not a url !!!")).toBeNull();
  });
});
