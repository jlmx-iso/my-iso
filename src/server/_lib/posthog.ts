import { PostHog } from "posthog-node";
import { env } from "~/env";

let _client: PostHog | null = null;

export function getPostHogClient(): PostHog | null {
  if (env.NODE_ENV === "test") return null;
  if (!process.env.POSTHOG_API_KEY) return null;
  if (!_client) {
    _client = new PostHog(process.env.POSTHOG_API_KEY, {
      host: "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return _client;
}

export async function shutdownPostHog(): Promise<void> {
  if (_client) {
    await _client.shutdown();
    _client = null;
  }
}

// Feature flag helpers
export async function isFoundingMember(userId: string): Promise<boolean> {
  const ph = getPostHogClient();
  if (!ph) return false;
  return (await ph.isFeatureEnabled("founding_member", userId)) === true;
}

export async function hasProAccess(userId: string): Promise<boolean> {
  const ph = getPostHogClient();
  if (!ph) return false;
  return (await ph.isFeatureEnabled("pro_access", userId)) === true;
}

export async function isFoundingMemberPricingActive(): Promise<boolean> {
  const ph = getPostHogClient();
  if (!ph) return true; // default open if PostHog unavailable
  return (await ph.isFeatureEnabled("founding_member_pricing_active", "anonymous")) === true;
}

export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  const ph = getPostHogClient();
  if (!ph) return;
  try {
    ph.capture({ distinctId, event, properties: properties ?? {} });
  } catch (err) {
    console.warn("[posthog] capture failed:", err);
  }
}
