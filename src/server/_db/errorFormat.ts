import type { Prisma } from "@prisma/client";

/**
 * How Prisma words its errors.
 *
 * In the default formats a failed call's message reprints the call with its
 * arguments: message bodies, bios, phone numbers, email addresses. Those
 * messages are logged and, as a tRPC error's `cause`, sent to error
 * tracking. "minimal" keeps the error code and what went wrong without
 * echoing any argument. Development keeps the readable format.
 */
export function prismaErrorFormat(nodeEnv: string | undefined): Prisma.PrismaClientOptions["errorFormat"] {
  return nodeEnv === "development" ? "pretty" : "minimal";
}
