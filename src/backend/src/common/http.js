import { AppError } from "./errors.js";

// Wrap async route handlers so rejections reach the error middleware.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Standard list response: { data, count } (api-contract.md §1).
export function sendList(res, rows, extra = {}) {
  res.json({ data: rows, count: rows.length, ...extra });
}

// Fallback for unknown /api routes (no endpoint matches) — standard 404 envelope.
export function unknownRouteHandler(_req, res) {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Unknown API endpoint",
      details: {},
    },
  });
}

// Central error mapping: AppError -> envelope; malformed JSON -> 400; else 500.
export function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    return res.status(error.status).json(error.toEnvelope());
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Malformed JSON body", details: {} },
    });
  }
  console.error(error);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Unexpected server error", details: {} },
  });
}
