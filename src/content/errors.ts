export type ErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "ID_CONFLICT"
  | "VERSION_CONFLICT"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "GITHUB_ERROR"
  | "BUILD_FAILED";

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
