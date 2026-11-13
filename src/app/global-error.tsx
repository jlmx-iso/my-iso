"use client";

import Link from "next/link";
import { useEffect } from "react";

import { captureBoundaryError } from "~/_lib/analyticsBrowser";

/**
 * Last-resort error screen: it replaces the root layout, so it cannot rely on
 * the theme provider or any shared component and is styled inline with the
 * brand colours from `theme/colors.ts`.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureBoundaryError(error, "global-error");
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong | ISO</title>
      </head>
      <body
        style={{
          alignItems: "center",
          background: "#f8f9fa",
          color: "#1b1c1f",
          display: "flex",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          justifyContent: "center",
          margin: 0,
          minHeight: "100vh",
          padding: 24,
        }}
      >
        <main style={{ maxWidth: 440, textAlign: "center" }}>
          <p
            style={{
              color: "#af351a",
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: 2,
              margin: "0 0 24px",
            }}
          >
            ISO
          </p>
          <h1 style={{ fontSize: 26, lineHeight: 1.25, margin: "0 0 12px" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#5f6268", lineHeight: 1.6, margin: "0 0 24px" }}>
            ISO hit an unexpected problem. It has been reported, and trying
            again usually fixes it.
          </p>
          {error.digest && (
            <p style={{ color: "#5f6268", fontSize: 12, margin: "0 0 24px" }}>
              Reference: {error.digest}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#e98f7b",
                border: 0,
                borderRadius: 8,
                color: "#1b1c1f",
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 600,
                padding: "10px 20px",
              }}
            >
              Try again
            </button>
            <Link
              href="/"
              prefetch={false}
              style={{
                border: "1px solid #878a90",
                borderRadius: 8,
                color: "#1b1c1f",
                fontSize: 16,
                fontWeight: 600,
                padding: "9px 20px",
                textDecoration: "none",
              }}
            >
              Go home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
