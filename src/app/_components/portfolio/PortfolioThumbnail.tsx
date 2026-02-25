"use client";

import { Box } from "@mantine/core";
import { IconCamera } from "@tabler/icons-react";
import Image from "next/image";
import { useState } from "react";

export function PortfolioThumbnail({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);

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
        <IconCamera size={24} color="var(--mantine-color-gray-4)" />
      </Box>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      style={{ objectFit: "cover" }}
      onError={() => setBroken(true)}
    />
  );
}
