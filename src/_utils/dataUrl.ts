/**
 * Extract the base64 payload from a `FileReader.readAsDataURL` result
 * (`data:<mime>;base64,<payload>`).
 *
 * Returns `undefined` when the reader produced no string result or the value
 * is not a data URL with a payload.
 */
export function dataUrlToBase64(
  result: string | ArrayBuffer | null,
): string | undefined {
  if (typeof result !== "string") return undefined;
  return result.split(",")[1] || undefined;
}
