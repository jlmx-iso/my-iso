/** Path of the realtime endpoint served by the Worker entry (worker.ts). */
export const REALTIME_PATH = "/api/messages/ws";

export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Delay before reconnect attempt number `attempt` (0-based): exponential,
 * capped, with up to 25% subtracted at random so that clients dropped
 * together do not reconnect together.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const exponential = RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 16);
  const capped = Math.min(exponential, RECONNECT_MAX_DELAY_MS);
  return Math.round(capped * (1 - 0.25 * random()));
}

export type HandshakeFailure =
  /** Not signed in, or not a participant: retrying cannot succeed. */
  | "denied"
  /** This deployment has no realtime endpoint (`next dev`, `next start`). */
  | "unavailable"
  /** Anything else (network error, 5xx, dropped handshake): worth retrying. */
  | "retry";

/**
 * Classifies a failed WebSocket handshake from the HTTP status of a plain GET
 * to the same URL (`null` when that request itself failed). The WebSocket API
 * does not expose the handshake status, and the endpoint answers a plain
 * request with the same 401/403 it would give the upgrade.
 */
export function classifyHandshakeFailure(probeStatus: number | null): HandshakeFailure {
  if (probeStatus === 401 || probeStatus === 403) return "denied";
  if (probeStatus === 404) return "unavailable";
  return "retry";
}
