import { ApiError } from "./api/client";

export interface MappedAuthError {
  /** Message to show. */
  message: string;
  /** Attach it to this field when the server's message is about that field; otherwise form-level. */
  field?: "email" | "password";
}

/**
 * Turn a backend/network error into friendly copy, placed on the right field. The backend's own
 * messages are terse (`invalid email or password`, `email already registered`), and it
 * deliberately answers wrong-email and wrong-password identically (no account enumeration), so
 * we keep that behaviour and never hint which half was wrong.
 */
export function mapAuthError(mode: "login" | "signup", err: unknown): MappedAuthError {
  if (!(err instanceof ApiError)) return { message: "Something went wrong. Please try again." };
  if (err.kind === "network") return { message: err.message };

  if (err.status === 409) {
    return { field: "email", message: "An account with this email already exists. Log in instead." };
  }
  if (err.status === 401) {
    return { message: "That email and password don't match. Check them and try again." };
  }
  if (err.status === 429) return { message: "Too many attempts. Wait a moment and try again." };
  if (err.status === 422) {
    if (/email/i.test(err.message)) return { field: "email", message: "Enter a valid email address." };
    if (/password|character/i.test(err.message)) return { field: "password", message: "Use at least 8 characters." };
  }
  return { message: err.message || (mode === "login" ? "Could not log in." : "Could not create your account.") };
}
