/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
 */
await import("./src/env.js");

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { buildSecurityHeaders } from "./src/securityHeaders.js";
import { TELEMETRY_FALLBACK_ROUTE, TELEMETRY_PROXY_PATH } from "./src/telemetryConfig.js";

/** Commit this build was made from, for /api/health. "unknown" outside git. */
function resolveCommit() {
  const fromCi = process.env.GITHUB_SHA ?? process.env.WORKERS_CI_COMMIT_SHA;
  if (fromCi) return fromCi.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/** Version from package.json, for /api/health. */
function resolveVersion() {
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  if (typeof manifest === "object" && manifest !== null && "version" in manifest) {
    return String(manifest.version);
  }
  return "unknown";
}

/** @type {import("next").NextConfig} */
const config = {
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  // Do not advertise the framework in an `X-Powered-By` response header.
  poweredByHeader: false,
  // Inlined at build time; reported by /api/health.
  env: {
    APP_COMMIT: resolveCommit(),
    APP_VERSION: resolveVersion(),
  },
  // Browser source maps are generated only when scripts/sourcemaps.mjs is
  // going to consume them (SOURCEMAPS=upload in a deploy, SOURCEMAPS=dry-run
  // in CI). That script removes them from the deployed assets either way;
  // they are never served.
  productionBrowserSourceMaps:
    process.env.SOURCEMAPS === "upload" || process.env.SOURCEMAPS === "dry-run",
  // PostHog's endpoints end in a slash (/e/, /flags/). In development, keep
  // Next.js from answering the proxied path with a redirect first. In a
  // production build the setting stays off, so pages keep redirecting
  // `/about/` to `/about`; on Cloudflare the Worker answers the telemetry
  // path before Next.js is involved at all.
  skipTrailingSlashRedirect: process.env.NODE_ENV === "development",
  images: {
    remotePatterns: [
      {
        hostname: "lh3.googleusercontent.com",
        protocol: "https",
      },
      {
        hostname: "res.cloudinary.com",
        protocol: "https",
      }
    ],
  },
  redirects: async () => [
    {
      source: "/register",
      destination: "/join",
      permanent: true,
    },
  ],
  // On Cloudflare the Worker entry (worker.ts) answers the telemetry path
  // before Next.js sees it. Without a Worker (`next dev`, `next start`) this
  // rewrite sends the same path to a route that forwards it the same way.
  rewrites: async () => [
    {
      source: `${TELEMETRY_PROXY_PATH}/:path*`,
      destination: `${TELEMETRY_FALLBACK_ROUTE}/:path*`,
    },
  ],
  headers: async () => (
    [
      {
        // Every route. Listed first: for a header set twice, the later
        // (more specific) entry below wins.
        source: "/:path*",
        headers: buildSecurityHeaders({
          baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
          isDevelopment: process.env.NODE_ENV === "development",
        }),
      },
      {
        source: "/login",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store",
          },
          {
            key: "Referrer-Policy",
            value: "same-origin",
          }
        ],
      }
    ]
  ),
};

export default config;
