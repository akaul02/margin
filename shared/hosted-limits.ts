// Deliberate headroom below Vercel's 4.5 MB request AND response limits.
export const HOSTED_PROJECT_BYTES = 1_500_000;
export const HOSTED_OPERATION_BYTES = 3_100_000;
export function jsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).length; }
function assertDatabaseText(value: unknown): void {
  if (typeof value === 'string') {
    // Postgres jsonb cannot represent NUL or lone UTF-16 surrogates. Reject;
    // never rewrite the source text or adjust its stable offsets.
    if (/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('This text contains characters that hosted storage cannot preserve. Your local copy is unchanged; export it and continue locally.');
  } else if (Array.isArray(value)) value.forEach(assertDatabaseText);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertDatabaseText);
}
export function assertHostedProject(value: unknown) {
  if (jsonBytes(value) > HOSTED_PROJECT_BYTES) throw new Error('Shared projects can hold up to 1.5 MB. Your browser copy is unchanged. Export a backup and use smaller projects to share.');
  assertDatabaseText(value);
}
export function assertHostedOperation(value: unknown) {
  if (jsonBytes(value) > HOSTED_OPERATION_BYTES) throw new Error('This edit is too large to share at once. Your previous work is unchanged. Split the edit into smaller steps.');
  assertDatabaseText(value);
}
