"use client";

import { useEffect, useState } from "react";

import { formatLocalDate } from "~/_lib/dayjs";

type LocalDateProps = {
  date: string;
  format?: string;
};

/** Client component that formats a UTC date in the user's local timezone. Use this in server components. */
export default function LocalDate({ date, format }: LocalDateProps) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    setFormatted(formatLocalDate(date, format));
  }, [date, format]);

  if (!formatted) return null;
  return <>{formatted}</>;
}
