import { ImageResponse } from "workers-og";

export const runtime = "edge";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = escapeHtml(searchParams.get("title") || "ISO");
  const subtitle = escapeHtml(searchParams.get("subtitle") || "The Photographer Network");

  const html = `
    <div style="display: flex; flex-direction: column; width: 1200px; height: 630px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 60px; justify-content: center; align-items: center;">
      <div style="font-size: 72px; font-weight: 800; color: white; margin-bottom: 16px; text-align: center;">${title}</div>
      <div style="font-size: 32px; color: rgba(255,255,255,0.7); text-align: center;">${subtitle}</div>
      <div style="font-size: 20px; color: rgba(255,255,255,0.4); margin-top: 40px;">myiso.app</div>
    </div>
  `;

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}
