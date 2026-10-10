/** Error codes the web app understands. They match the ones the Firebase build used. */
export type ErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'already-exists'
  | 'failed-precondition'
  | 'invalid-argument'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  'failed-precondition': 412,
  'invalid-argument': 400,
  internal: 500,
};

export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/**
 * Turns an error raised by an `admin_*` database function into a readable one. `self` is
 * what the Owner tried to do to their own account, for the one message that needs it.
 */
export function fromDatabase(error: { message: string }, self = 'change'): HttpError {
  switch (error.message) {
    case 'not_owner':
      return new HttpError('permission-denied', 'Only the Owner can do this.');
    case 'user_not_found':
      return new HttpError('not-found', 'User not found.');
    case 'account_off':
      return new HttpError('failed-precondition', 'This account is turned off.');
    case 'self_forbidden':
      return new HttpError('failed-precondition', `You cannot ${self} your own account.`);
    case 'user_code_taken':
      return new HttpError('already-exists', 'This user code is already taken.');
    case 'invalid_input':
      return new HttpError('invalid-argument', 'Invalid input.');
    default:
      // The detail goes to the function log (SEC-14), never to the caller.
      console.error('admin-users: database error', error.message);
      return new HttpError('internal', 'Something went wrong. Try again.');
  }
}
