import { type MetadataRoute } from "next";

import { SITE_URL } from "~/_lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app/", "/api/"],
      },
      {
        userAgent: "GPTBot",
        allow: "/",
        disallow: ["/app/", "/api/"],
      },
      {
        userAgent: "ClaudeBot",
        allow: "/",
        disallow: ["/app/", "/api/"],
      },
      {
        userAgent: "PerplexityBot",
        allow: "/",
        disallow: ["/app/", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
