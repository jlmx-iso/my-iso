"use client";

import NextError from "next/error";
import posthog from "posthog-js";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error }) {
  useEffect(() => {
    // No-op until PostHog is initialised (src/instrumentation-client.ts).
    posthog.captureException(error, { boundary: "global-error" });
  }, [error]);

  return (
    <html lang="en-us">
      <body>
        <NextError statusCode={undefined as never} />
      </body>
    </html>
  );
};
