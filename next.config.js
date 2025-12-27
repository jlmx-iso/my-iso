/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await import("./src/env.js");
import { withSentryConfig } from "@sentry/nextjs";

/** @type {import("next").NextConfig} */
const config = {
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
  headers: async () => (
    [
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
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      config.resolve.fallback = { fs: false };
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return config;
  }
};

export default withSentryConfig(
  config,
  {
    //  For all available options, see:
    // https://github.com/getsentry/sentry-webpack-plugin#options

    org: "myiso",
    project: "iso-app",

    // Only print logs for uploading source maps in CI
    silent: !process.env.CI,

    // For all available options, see:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
    // This can increase your server load as well as your hosting bill.
    // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
    // side errors will fail.
    tunnelRoute: "/monitoring",

    // Source maps configuration - delete after upload for security
    sourcemaps: {
      deleteSourcemapsAfterUpload: true,
    },

    // Webpack-specific Sentry options (merged from third parameter in Sentry v8+)
    webpack: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      treeshake: {
        removeDebugLogging: true,
      },
      // Enables automatic instrumentation of Vercel Cron Monitors
      automaticVercelMonitors: true,
    },
  }
);