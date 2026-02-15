type OkResult<T> = { value: T; isOk: true; isErr: false };
type ErrResult<T> = { error: T; isErr: true; isOk: false };

export type Result<TOk = unknown, TErr = Error> = OkResult<TOk> | ErrResult<TErr>;


// eslint-disable-next-line @typescript-eslint/no-namespace
/**
 * Result type for functional error handling
 *
 * Usage:
 * - Return Result.ok(value) for success
 * - Return Result.err(error) for failure
 * - Check result.isOk before accessing result.value
 * - Check result.isErr before accessing result.error
 */
export namespace Result {
  export function ok<T>(value: T): OkResult<T> {
    return { isErr: false, isOk: true, value };
  }

  export function err<T>(error: T): ErrResult<T> {
    return { error, isErr: true, isOk: false };
  }
}
