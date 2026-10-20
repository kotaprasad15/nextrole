import { describe, expect, it } from "vitest";
import { ApiError } from "./api/client";
import { mapAuthError } from "./auth-errors";

describe("mapAuthError", () => {
  it("puts 'already registered' on the email field", () => {
    const m = mapAuthError("signup", new ApiError("email already registered", 409));
    expect(m.field).toBe("email");
    expect(m.message).toMatch(/already exists/i);
  });

  it("keeps wrong email and wrong password indistinguishable (form-level, no field)", () => {
    const m = mapAuthError("login", new ApiError("invalid email or password", 401));
    expect(m.field).toBeUndefined();
    expect(m.message).toMatch(/don't match/i);
  });

  it("maps 422 messages to the right field", () => {
    expect(mapAuthError("signup", new ApiError("invalid email", 422)).field).toBe("email");
    expect(mapAuthError("signup", new ApiError("String should have at least 8 characters", 422)).field).toBe("password");
  });

  it("handles rate limits, network failures and unknown errors", () => {
    expect(mapAuthError("login", new ApiError("x", 429)).message).toMatch(/too many/i);
    expect(mapAuthError("login", new ApiError("Cannot reach the server.", 0, "network")).message).toBe("Cannot reach the server.");
    expect(mapAuthError("login", new Error("boom")).message).toMatch(/something went wrong/i);
  });
});
