export class OperationDeadlineExceededError extends Error {
  constructor(operation: string) {
    super(`${operation} did not have enough time remaining in this request.`);
    this.name = "OperationDeadlineExceededError";
  }
}

export function boundedOperationTimeout(input: {
  operation: string;
  deadlineMs?: number;
  maxTimeoutMs: number;
  reserveMs?: number;
  minimumTimeoutMs?: number;
  nowMs?: number;
}) {
  const maximum = Math.max(1, Math.floor(input.maxTimeoutMs));
  if (!input.deadlineMs) return maximum;
  const available = Math.floor(
    input.deadlineMs - (input.nowMs ?? Date.now()) - Math.max(0, input.reserveMs ?? 0)
  );
  const minimum = Math.max(1, Math.floor(input.minimumTimeoutMs ?? 1));
  if (available < minimum) throw new OperationDeadlineExceededError(input.operation);
  return Math.min(maximum, available);
}
