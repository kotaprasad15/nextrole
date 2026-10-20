import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Log in" };

// The form is server-rendered; only its cross-link reads the URL (inside its own Suspense).
export default function LoginPage() {
  return (
    <AuthForm mode="login" />
  );
}
