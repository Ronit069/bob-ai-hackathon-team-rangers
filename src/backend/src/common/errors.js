// Standard error envelope (api-contract.md §1.1).
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  SEMANTIC_ERROR: "SEMANTIC_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  BOB_UNAVAILABLE: "BOB_UNAVAILABLE",
};

const HTTP_STATUS = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SEMANTIC_ERROR: 422,
  INTERNAL_ERROR: 500,
  BOB_UNAVAILABLE: 503,
};

export class AppError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.status = HTTP_STATUS[code] ?? 500;
  }

  toEnvelope() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const notFound = (entity, id) => new AppError("NOT_FOUND", `${entity} ${id} does not exist`, { entity, id });
export const conflict = (message, details = {}) => new AppError("CONFLICT", message, details);
export const validationError = (message, details = {}) => new AppError("VALIDATION_ERROR", message, details);

// Map PostgreSQL constraint errors to the standard envelope (used by repositories/services).
export function fromPgError(error) {
  if (error instanceof AppError) return error;
  switch (error?.code) {
    case "23503":
      return new AppError("VALIDATION_ERROR", "Referenced record does not exist", {
        constraint: error.constraint,
        detail: error.detail,
      });
    case "23505":
      return new AppError("CONFLICT", "Duplicate record", { constraint: error.constraint, detail: error.detail });
    case "23514":
    case "23502":
      return new AppError("VALIDATION_ERROR", "Record violates a database constraint", {
        constraint: error.constraint,
        detail: error.detail,
      });
    default:
      return new AppError("INTERNAL_ERROR", "Unexpected database error", { pgCode: error?.code ?? null });
  }
}
