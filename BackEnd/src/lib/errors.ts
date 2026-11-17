/** Expected, client-facing failure. `code` is machine readable, `status` is the HTTP status. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    message = code,
  ) {
    super(message);
  }
}
