export type ErrorCode = 'AUTH_REQUIRED'|'AUTH_INVALID'|'INVALID_REQUEST'|'UNKNOWN_TOOL'|'INVALID_TOOL_ARGUMENTS'|'PERMISSION_DENIED'|'INTEGRATION_UNAVAILABLE'|'TOOL_IN_PROGRESS'|'TOOL_TIMEOUT'|'TOOL_EXECUTION_FAILED'|'DATABASE_ERROR'|'REALTIME_SESSION_FAILED'|'INTERNAL_ERROR';
export class ApiError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly status: number, public readonly retryable = false, options?: ErrorOptions) { super(message, options); }
}
export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError('INTERNAL_ERROR', 'An unexpected error occurred', 500, false, { cause: error });
}
