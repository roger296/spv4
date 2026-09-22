/**
 * Application errors carry an HTTP status and a stable machine-readable code.
 * The error handler turns them into `{ error: { code, message, details } }`.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(what: string, id?: string) {
    super(404, 'not_found', id ? `${what} ${id} not found` : `${what} not found`);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'validation', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in required') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not allowed') {
    super(403, 'forbidden', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'conflict', message, details);
  }
}

/** Order cannot be labelled until the caller supplies the listed fields (spec section 9). */
export class NeedsInformationError extends AppError {
  constructor(
    public readonly reference: string,
    public readonly missing: { path: string; reason: string; alternatives?: string[]; options?: string[] }[],
    public readonly orderStatus: string,
  ) {
    super(422, 'needs_information', `Order ${reference} needs more information`, missing);
  }
}

export class NoMethodError extends AppError {
  constructor(public readonly reference: string, public readonly dropped: { name: string; reason: string }[]) {
    super(422, 'no_method', `No shipping method fits order ${reference}`, dropped);
  }
}

export class AddressFailedError extends AppError {
  constructor(public readonly reference: string, message: string) {
    super(422, 'address_failed', message);
  }
}

export class CourierRejectedError extends AppError {
  constructor(message: string, public readonly retryable: boolean, details?: unknown) {
    super(502, 'courier_rejected', message, details);
  }
}

export class SubscriptionBlockedError extends AppError {
  constructor() {
    super(402, 'subscription_blocked', 'This account cannot buy labels until its subscription is paid');
  }
}
