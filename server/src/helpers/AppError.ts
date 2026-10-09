/**
 * Typed operational error. Throw this in route handlers instead of calling apiFailure() directly.
 * The global error handler catches it and returns the correct HTTP status + JSON error body.
 *
 * @example
 *   throw new AppError(404, 'Resource not found');
 *   throw new AppError(403, 'Forbidden');
 *   throw new AppError(422, 'Validation failed');
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
