"use client";

import ErrorBoundary from "~/app/_components/ErrorBoundary";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorBoundary error={error} reset={reset} homeHref="/app/events" />;
}
