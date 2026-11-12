/**
 * How a person is named everywhere in the app: by their own name. A business
 * name, where there is one, is secondary text next to it, never a
 * replacement.
 */
export function fullName(
  person: { firstName?: string | null; lastName?: string | null } | null | undefined,
  fallback = "ISO member",
): string {
  return `${person?.firstName ?? ""} ${person?.lastName ?? ""}`.replace(/\s+/g, " ").trim() || fallback;
}

/**
 * The business name to show under a person's name, or null when there is
 * none or it only repeats the name.
 */
export function businessName(
  person: { firstName?: string | null; lastName?: string | null } | null | undefined,
  companyName: string | null | undefined,
): string | null {
  const company = companyName?.replace(/\s+/g, " ").trim();
  if (!company) return null;
  return company.toLowerCase() === fullName(person, "").toLowerCase() ? null : company;
}
