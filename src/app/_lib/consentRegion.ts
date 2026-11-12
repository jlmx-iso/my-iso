// Whether the current request comes from a region where analytics wait for
// an explicit yes. For server components (the root layout).

import { headers } from "next/headers";

import { consentRequiresOptIn, COUNTRY_HEADER } from "~/_lib/consent";

/** Reads only the country header the Worker entry set (src/worker/country.ts). */
export async function requestRequiresOptIn(): Promise<boolean> {
  return consentRequiresOptIn((await headers()).get(COUNTRY_HEADER));
}
