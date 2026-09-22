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

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message)
  }

  static notImplemented(message = 'Not implemented yet') {
    return new ApiError(501, message)
  }

  static serviceUnavailable(message = 'Service unavailable') {
    return new ApiError(503, message)
  }
}
