"use client";

import { Box } from "@mantine/core";
import { IconCamera } from "@tabler/icons-react";
import Image from "next/image";
import { useState } from "react";

type PortfolioThumbnailProps = {
  src: string;
  /** Empty when the image is decorative. */
  alt: string;
  /** Load eagerly: for images above the fold. */
  priority?: boolean;
  sizes?: string;
};

/** Cover-fit image filling its (positioned) parent, with a broken-image fallback. */
export function PortfolioThumbnail({ src, alt, priority, sizes = "(min-width: 75em) 1200px, 100vw" }: PortfolioThumbnailProps) {
  // Track which src failed so a new image gets a fresh attempt.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const broken = brokenSrc === src;

  if (broken) {
    return (
      <Box
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--mantine-color-gray-1)",
        }}
      >
        <IconCamera size={24} color="var(--mantine-color-gray-6)" aria-hidden />
        {alt && <span className="sr-only">{alt} (image unavailable)</span>}
      </Box>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      style={{ objectFit: "cover" }}
      onError={() => setBrokenSrc(src)}
    />
  );
}
