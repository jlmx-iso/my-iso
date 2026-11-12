import { ImageResponse } from "next/og";

import { SITE_HOST } from "~/_lib/site";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Length-capped: these are rendered into an image from a public URL.
  const title = (searchParams.get("title") || "ISO").slice(0, 80);
  const subtitle = (searchParams.get("subtitle") || "The Photographer Network").slice(0, 120);

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background:
            "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
          display: "flex",
          flexDirection: "column",
          height: 630,
          justifyContent: "center",
          padding: 60,
          width: 1200,
        }}
      >
        <div
          style={{
            color: "white",
            fontSize: 72,
            fontWeight: 800,
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: 32,
            textAlign: "center",
          }}
        >
          {subtitle}
        </div>
        <div
          style={{
            color: "rgba(255,255,255,0.4)",
            fontSize: 20,
            marginTop: 40,
          }}
        >
          {SITE_HOST}
        </div>
      </div>
    ),
    {
      headers: {
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
      height: 630,
      width: 1200,
    },
  );
}
