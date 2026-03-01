// Type declarations for image file imports.
// Next.js declares these via next/image-types/global, but that reference
// depends on next-env.d.ts loading .next/types/routes.d.ts which doesn't
// exist until after `next build` runs (e.g. in CI type-check steps).
// Duplicating them here ensures they're always available.
declare module "*.webp" {
  import type { StaticImageData } from "next/image";
  const content: StaticImageData;
  export default content;
}
