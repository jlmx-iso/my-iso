"use client";

import NextError from "next/error";
import { useEffect } from "react";

import { captureBoundaryError } from "~/_lib/analyticsBrowser";

export default function GlobalError({ error }: { error: Error }) {
  useEffect(() => {
    captureBoundaryError(error, "global-error");
  }, [error]);

  return (
    <html lang="en-us">
      <body>
        <NextError statusCode={undefined as never} />
      </body>
    </html>
  );
};
