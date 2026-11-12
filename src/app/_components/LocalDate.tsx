"use client";

import { useSyncExternalStore } from "react";

import { type DateFormatName, formatDate } from "~/_lib/dayjs";

type LocalDateProps = {
  date: string;
  format?: DateFormatName;
};

/** Client component that formats a UTC date in the user's local timezone. Use this in server components. */
export default function LocalDate({ date, format }: LocalDateProps) {
  // Render nothing on the server and during hydration: the server's timezone
  // is not the user's, so formatting there would cause a hydration mismatch.
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  if (!isClient) return null;
  const formatted = formatDate(date, format);
  if (!formatted) return null;
  return <>{formatted}</>;
}

function subscribeToNothing() {
  return () => undefined;
}
