// Standard API error — mirrors the backend error envelope
// { error: { code, message, details } } (api-contract.md §1.1).
export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  isValidation() {
    return this.status === 400 || this.code === "VALIDATION_ERROR";
  }

  isNotFound() {
    return this.status === 404 || this.code === "NOT_FOUND";
  }

  isConflict() {
    return this.status === 409 || this.code === "CONFLICT";
  }

  isBobUnavailable() {
    return this.status === 503 || this.code === "BOB_UNAVAILABLE";
  }

  isServerError() {
    return this.status >= 500;
  }
}

export function isApiError(value) {
  return value instanceof ApiError;
}
