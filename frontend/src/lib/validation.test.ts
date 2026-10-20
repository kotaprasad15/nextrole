import { describe, expect, it } from "vitest";
import { EMAIL_RE, fieldErrors, loginSchema, passwordStrength, signupSchema } from "./validation";

describe("email rule matches the backend regex", () => {
  it.each(["a@b.co", "first.last+tag@sub.example.com", "x@y.z"])("accepts %s", (e) => {
    expect(EMAIL_RE.test(e)).toBe(true);
  });
  it.each(["", "plain", "a@b", "a b@c.de", "@x.com", "a@.com ".trim() + " "])("rejects %j", (e) => {
    expect(EMAIL_RE.test(e)).toBe(false);
  });
});

describe("signupSchema", () => {
  it("accepts a valid pair and trims the email", () => {
    const r = signupSchema.safeParse({ email: "  a@b.co ", password: "longenough" });
    expect(r.success && r.data.email).toBe("a@b.co");
  });

  it("explains each problem in plain language, per field", () => {
    const r = signupSchema.safeParse({ email: "nope", password: "short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error)).toEqual({
        email: "Enter a valid email address, like name@example.com.",
        password: "Use at least 8 characters.",
      });
    }
  });

  it("enforces the backend's upper bounds too", () => {
    expect(signupSchema.safeParse({ email: `${"a".repeat(250)}@b.co`, password: "longenough" }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "a@b.co", password: "x".repeat(257) }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("only requires presence of a password (existing accounts may predate rules)", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    const r = loginSchema.safeParse({ email: "", password: "" });
    expect(!r.success && fieldErrors(r.error)).toEqual({ email: "Enter your email address.", password: "Enter your password." });
  });
});

describe("passwordStrength (advisory)", () => {
  it("is empty for no input and flags short passwords", () => {
    expect(passwordStrength("")).toEqual({ level: 0, label: "" });
    expect(passwordStrength("abc123")).toEqual({ level: 1, label: "Too short" });
  });
  it("rewards length and variety", () => {
    expect(passwordStrength("aaaaaaaa").label).toBe("Weak");
    expect(passwordStrength("abcdefgh1234").level).toBe(2);
    expect(passwordStrength("Correct-Horse-Battery9").label).toBe("Strong");
  });
});
