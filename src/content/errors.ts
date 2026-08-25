export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "ID_CONFLICT",
  "VERSION_CONFLICT",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "GITHUB_ERROR",
  "BUILD_FAILED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}
