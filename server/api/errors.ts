export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(message, 409);
  }
}
