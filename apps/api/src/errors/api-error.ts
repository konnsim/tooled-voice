export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_TOOL'
  | 'INVALID_TOOL_ARGUMENTS'
  | 'PERMISSION_DENIED'
  | 'INTEGRATION_UNAVAILABLE'
  | 'INTEGRATION_AUTH_EXPIRED'
  | 'OAUTH_INVALID_STATE'
  | 'OAUTH_EXCHANGE_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TOOL_IN_PROGRESS'
  | 'TOOL_TIMEOUT'
  | 'TOOL_EXECUTION_FAILED'
  | 'DATABASE_ERROR'
  | 'REALTIME_SESSION_FAILED'
  | 'INTERNAL_ERROR';
const retryableDatabaseStatePattern = /^(08|40|53|57P)/;
const databaseCodePattern = /^[0-9A-Z]{5}$/;
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}
export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isDatabaseError(error)) {
    const state = typeof error.code === 'string' ? error.code : '';
    return new ApiError(
      'DATABASE_ERROR',
      'The database request failed',
      503,
      retryableDatabaseStatePattern.test(state),
      { cause: error }
    );
  }
  return new ApiError(
    'INTERNAL_ERROR',
    'An unexpected error occurred',
    500,
    false,
    { cause: error }
  );
}
function isDatabaseError(
  error: unknown
): error is { name?: string; code?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { name?: unknown }).name === 'PostgresError' ||
      (typeof (error as { code?: unknown }).code === 'string' &&
        databaseCodePattern.test((error as { code: string }).code)))
  );
}
