import { z } from "zod";

/** A message as the thread query returns it and as the feed renders it. */
export type ThreadMessage = {
  content: string;
  createdAt: Date;
  id: string;
  sender: {
    firstName: string;
    id: string;
    lastName: string;
    profilePic: string | null;
  };
};

const threadMessageEventSchema = z.object({
  message: z.object({
    content: z.string(),
    createdAt: z.iso.datetime().transform((value) => new Date(value)),
    id: z.string().min(1),
    sender: z.object({
      firstName: z.string(),
      id: z.string().min(1),
      lastName: z.string(),
      profilePic: z.string().nullable(),
    }),
  }),
  type: z.literal("message"),
});

/**
 * Parses a realtime frame (see publishThreadMessage). Returns null for
 * anything that is not a well-formed message event.
 */
export function parseThreadMessageEvent(data: unknown): ThreadMessage | null {
  if (typeof data !== "string") return null;

  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }

  const result = threadMessageEventSchema.safeParse(json);
  return result.success ? result.data.message : null;
}

/**
 * Merges `incoming` into `existing`: one entry per id (the incoming copy
 * wins), oldest first. The same message can arrive through the thread query,
 * the realtime socket and the sender's own mutation; merging through here is
 * what keeps it from being rendered twice or out of order.
 */
export function mergeThreadMessages<T extends { createdAt: Date; id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);

  return [...byId.values()].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}

/**
 * Whether the thread has messages older than the ones on screen.
 *
 * `snapshotTotal` is the thread's message count when the thread query last
 * answered, and `snapshot` the messages that answer held. Messages that have
 * arrived since (over the socket, or sent from here) are on screen but not in
 * that total, so they are left out of the comparison: otherwise a busy
 * conversation would stop offering "Load earlier messages" while there are
 * still earlier ones.
 */
export function hasEarlierMessages({
  snapshotTotal,
  snapshot,
  shown,
}: {
  snapshotTotal: number;
  snapshot: ReadonlyArray<{ createdAt: Date }>;
  shown: ReadonlyArray<{ createdAt: Date }>;
}): boolean {
  const newestInSnapshot = snapshot.reduce((latest, message) => Math.max(latest, message.createdAt.getTime()), -Infinity);
  // On screen and already counted in the total: nothing newer than the snapshot.
  const counted = shown.filter((message) => message.createdAt.getTime() <= newestInSnapshot).length;
  return snapshotTotal > counted;
}
