/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
await import("./src/env.js");

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
      config.resolve.fallback = { fs: false };
    }

    return config;
  },
};

export default config;
