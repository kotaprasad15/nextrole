import { describe, expect, it } from "vitest";
import { EMAIL_RE, fieldErrors, loginSchema, signupSchema, unmetPasswordRules } from "./validation";

describe("email rule matches the backend regex", () => {
  it.each(["a@b.co", "first.last+tag@sub.example.com", "x@y.z"])("accepts %s", (e) => {
    expect(EMAIL_RE.test(e)).toBe(true);
  });
  it.each(["", "plain", "a@b", "a b@c.de", "@x.com", "a@.com ".trim() + " "])("rejects %j", (e) => {
    expect(EMAIL_RE.test(e)).toBe(false);
  });
});

const GOOD = "Correct-horse9";
const signup = (over: Partial<{ email: string; password: string; confirmPassword: string }> = {}) =>
  signupSchema.safeParse({ email: "a@b.co", password: GOOD, confirmPassword: GOOD, ...over });

describe("signupSchema", () => {
  it("accepts a valid pair and trims the email", () => {
    const r = signup({ email: "  a@b.co " });
    expect(r.success && r.data.email).toBe("a@b.co");
  });

  it("explains each problem in plain language, per field", () => {
    const r = signup({ email: "nope", password: "short", confirmPassword: "other" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error)).toEqual({
        email: "Enter a valid email address, like name@example.com.",
        password: "Your password still needs: at least 8 characters, one uppercase letter, one special character, like ! ? # %.",
        confirmPassword: "The two passwords do not match.",
      });
    }
  });

  it.each([
    ["Sh0rt!", "length"],
    ["alllowercase1!", "upper"],
    ["ALLUPPERCASE1!", "lower"],
    ["NoSpecialChar1", "special"],
    ["Has Space Only1", "special"],
  ])("rejects %j (missing %s)", (pw, missing) => {
    expect(signup({ password: pw, confirmPassword: pw }).success).toBe(false);
    expect(unmetPasswordRules(pw).map((r) => r.id)).toContain(missing);
  });

  it("requires the confirmation to match exactly", () => {
    expect(signup({ confirmPassword: "Correct-horse8" }).success).toBe(false);
    expect(signup({ confirmPassword: "" }).success).toBe(false);
  });

  it("enforces the backend's upper bounds too", () => {
    expect(signup({ email: `${"a".repeat(250)}@b.co` }).success).toBe(false);
    const long = `Aa!${"x".repeat(260)}`;
    expect(signup({ password: long, confirmPassword: long }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("only requires presence of a password (existing accounts may predate rules)", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    const r = loginSchema.safeParse({ email: "", password: "" });
    expect(!r.success && fieldErrors(r.error)).toEqual({ email: "Enter your email address.", password: "Enter your password." });
  });
});
