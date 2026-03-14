"use client";

import { formatLocalDate } from "~/_lib/dayjs";

type LocalDateProps = {
  date: Date | string;
  format?: string;
};

/** Client component that formats a UTC date in the user's local timezone. Use this in server components. */
export default function LocalDate({ date, format }: LocalDateProps) {
  return <>{formatLocalDate(date, format)}</>;
}
