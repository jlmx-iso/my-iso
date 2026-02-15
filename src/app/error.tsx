"use client";

import ErrorBoundary from "~/app/_components/ErrorBoundary";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return <ErrorBoundary error={error} reset={reset} />;
}
