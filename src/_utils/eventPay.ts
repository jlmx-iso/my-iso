/**
 * Event pay: what a lead photographer offers the second shooter for the
 * whole event, in US dollars. Stored as whole cents (`Event.payCents`); the
 * form takes dollars. One module for the form, the server and every place
 * the amount is shown, so "$450" reads the same everywhere.
 */

/** The most an event may list: $100,000. */
export const MAX_EVENT_PAY_CENTS = 100_000_00;

const usd = new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" });
const usdWhole = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });

/**
 * "$450", "$1,200", "$87.50": whole dollars without ".00". Null for an
 * event with no listed pay (or a value that is not a sensible amount).
 */
export function formatPay(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || !Number.isInteger(cents) || cents < 0) return null;
  return cents % 100 === 0 ? usdWhole.format(cents / 100) : usd.format(cents / 100);
}

/**
 * The form's value (dollars, as Mantine's NumberInput gives it: a number,
 * or "" when empty) as cents. Null when the field is empty: pay is optional.
 */
export function payDollarsToCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const dollars = typeof value === "number" ? value : Number(value);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

/** Cents as the form's dollar value; "" for no listed pay. */
export function payCentsToDollars(cents: number | null | undefined): number | "" {
  return cents === null || cents === undefined ? "" : cents / 100;
}

/**
 * The form's check of the pay field. Null when fine (including empty).
 * Messages say what to type, not just what is wrong.
 */
export function payError(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const dollars = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(dollars)) return "Enter the pay as a number of dollars, like 450";
  if (dollars < 0) return "Pay can't be negative. Leave it empty if you'd rather discuss it";
  if (Math.abs(dollars * 100 - Math.round(dollars * 100)) > 1e-6) return "Use at most two decimal places, like 87.50";
  if (Math.round(dollars * 100) > MAX_EVENT_PAY_CENTS) return `Enter an amount up to ${formatPay(MAX_EVENT_PAY_CENTS)}`;
  return null;
}
