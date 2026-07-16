export const DEFAULT_ERROR_MESSAGE =
  "Something went wrong. Please try again in a moment.";

export class UserFacingError extends Error {
  readonly name = "UserFacingError";

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function toUserMessage(
  error: unknown,
  fallback = DEFAULT_ERROR_MESSAGE,
) {
  if (error instanceof UserFacingError) return error.message;
  return fallback;
}
