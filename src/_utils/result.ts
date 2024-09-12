type OkResult<T> = { value: T; isOk: true; isErr: false };
type ErrResult<T> = { error: T; isErr: true; isOk: false };

export type Result<TOk = unknown, TErr = Error> = OkResult<TOk> | ErrResult<TErr>;


// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Result {
  export function ok<T>(value: T): OkResult<T> {
    return { isErr: false, isOk: true, value };
  }

  export function err<T>(error: T): ErrResult<T> {
    return { error, isErr: true, isOk: false };
  }
}

// Example usage
// function generateResult(): Result<number> {
//   const random = Math.random();
//   if (random > 0.5) {
//     return Result.ok(42);
//   }
//   return Result.err("Something went wrong");
// }

// function consumeResult(result: Result<number>) {
//   if (result.isOk) {
//     return console.log(result.value);
//   }
//   return console.log(result.error);
// }
