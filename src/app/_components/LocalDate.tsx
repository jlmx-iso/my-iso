"use client";

import { useSyncExternalStore } from "react";

import { type DateFormatName, formatDate } from "~/_lib/dayjs";

type LocalDateProps = {
  date: Date | string;
  format?: DateFormatName;
};

/**
 * A date written in the reader's own time zone. Use it for every date shown
 * in a page, in server AND client components: client components are
 * rendered on the server first, where formatting would use the server's
 * zone (UTC), and suppressHydrationWarning would keep that wrong text.
 */
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
