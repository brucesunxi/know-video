function errorRecord(error: unknown): Record<string, unknown> | undefined {
  return error !== null && (typeof error === "object" || typeof error === "function")
    ? error as Record<string, unknown>
    : undefined;
}

export function externalErrorText(error: unknown, field: string) {
  const value = errorRecord(error)?.[field];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function externalErrorNumber(error: unknown, field: string) {
  const value = errorRecord(error)?.[field];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function externalErrorCode(error: unknown) {
  return externalErrorText(error, "code");
}

export function externalErrorStatus(error: unknown) {
  return externalErrorNumber(error, "status");
}

export function externalErrorName(error: unknown) {
  return externalErrorText(error, "name");
}

export function externalErrorMessage(error: unknown) {
  return externalErrorText(error, "message");
}
