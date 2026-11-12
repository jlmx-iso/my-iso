import { TRPCError } from "@trpc/server";

import type { ErrorReason } from "~/_utils/errorReason";

/**
 * The `cause` of a TRPCError that has a machine-readable reason. The error
 * formatter (see trpc.ts) copies `reason` into `error.data.reason`.
 */
export class ErrorWithReason extends Error {
  readonly reason: ErrorReason;

  constructor(reason: ErrorReason, message: string) {
    super(message);
    this.name = "ErrorWithReason";
    this.reason = reason;
  }
}

/** A TRPCError the client can recognise by `error.data.reason`. */
export function reasonedError(
  code: TRPCError["code"],
  reason: ErrorReason,
  message: string,
): TRPCError {
  return new TRPCError({ cause: new ErrorWithReason(reason, message), code, message });
}

/** The reason attached to `error` by `reasonedError`, or null. */
export function reasonOf(error: unknown): ErrorReason | null {
  return error instanceof TRPCError && error.cause instanceof ErrorWithReason
    ? error.cause.reason
    : null;
}
