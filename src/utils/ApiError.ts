/** An operational error with an HTTP status code, handled by the central error handler. */
export class ApiError extends Error {
  readonly statusCode: number
  readonly details?: unknown

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.details = details
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new ApiError(400, message, details)
  }

  /** Authentication missing or invalid. */
  static unauthorized(message = 'Authentication is required') {
    return new ApiError(401, message)
  }

  /** Authenticated, but not allowed. */
  static forbidden(message = 'You do not have access to this area') {
    return new ApiError(403, message)
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message)
  }

  /** The frontend renders distinct screens for 409 — "already registered", "already voted". */
  static conflict(message = 'That action conflicts with the current state', details?: unknown) {
    return new ApiError(409, message, details)
  }

  /** A registration session that has expired. */
  static gone(message = 'This session has expired') {
    return new ApiError(410, message)
  }

  /** Well-formed, but semantically rejected — a DOB mismatch or an under-age applicant. */
  static unprocessable(message = 'The submitted details could not be accepted', details?: unknown) {
    return new ApiError(422, message, details)
  }

  /** A step must happen elsewhere first — used by the trustee share endpoint. */
  static preconditionRequired(message = 'A required step has not been completed', details?: unknown) {
    return new ApiError(428, message, details)
  }

  static tooManyRequests(message = 'Too many attempts, please try again later') {
    return new ApiError(429, message)
  }

  static internal(message = 'Internal server error', details?: unknown) {
    return new ApiError(500, message, details)
  }

  static notImplemented(message = 'Not implemented yet') {
    return new ApiError(501, message)
  }

  static serviceUnavailable(message = 'Service unavailable') {
    return new ApiError(503, message)
  }
}
