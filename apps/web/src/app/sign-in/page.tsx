"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth-client";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { UserFacingError } from "@/lib/errors";
import { showErrorToast } from "@/lib/toast-error";

function authErrorMessage(mode: "signin" | "signup", message?: string) {
  if (message && /already|exist/i.test(message))
    return "An account with this email already exists.";
  if (mode === "signin" && message && /invalid|password|credential/i.test(message))
    return "Email or password is incorrect.";
  return mode === "signin"
    ? "We couldn’t sign you in. Please try again."
    : "We couldn’t create your account. Please try again.";
}

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      data-icon="inline-start"
      viewBox="0 0 24 24"
    >
      <path
        fill="currentColor"
        d="M21.35 12.18c0-.72-.06-1.41-.19-2.07H12v3.92h5.24a4.48 4.48 0 0 1-1.94 2.94v2.54h3.15c1.85-1.7 2.9-4.21 2.9-7.33Z"
      />
      <path
        fill="currentColor"
        d="M12 21.68c2.62 0 4.82-.87 6.43-2.37l-3.15-2.54c-.87.58-1.99.92-3.28.92-2.53 0-4.67-1.71-5.44-4.01H3.3v2.62A9.72 9.72 0 0 0 12 21.68Z"
        opacity=".75"
      />
      <path
        fill="currentColor"
        d="M6.56 13.68A5.85 5.85 0 0 1 6.25 12c0-.58.1-1.14.31-1.68V7.7H3.3A9.72 9.72 0 0 0 2.28 12c0 1.56.37 3.04 1.02 4.3l3.26-2.62Z"
        opacity=".5"
      />
      <path
        fill="currentColor"
        d="M12 6.31c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.81 3.37 14.62 2.32 12 2.32A9.72 9.72 0 0 0 3.3 7.7l3.26 2.62c.77-2.3 2.91-4.01 5.44-4.01Z"
        opacity=".9"
      />
    </svg>
  );
}

function AuthForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const redirectPath = safeAuthRedirect(search.get("next"));
  const oauthError = search.get("error");

  useEffect(() => {
    if (!oauthError) return;

    showErrorToast(
      new UserFacingError(
        "Google sign-in wasn’t completed. Please try again.",
      ),
    );
    router.replace("/sign-in");
  }, [oauthError, router]);

  const authMutation = useMutation({
    mutationFn: async (form: {
      name: string;
      email: string;
      password: string;
    }) => {
      const result =
        mode === "signup"
          ? await signUp.email({
              name: form.name,
              email: form.email,
              password: form.password,
            })
          : await signIn.email({ email: form.email, password: form.password });
      if (result.error) {
        throw new UserFacingError(
          authErrorMessage(mode, result.error.message),
        );
      }
      return result;
    },
    onSuccess: () => router.push(redirectPath),
  });

  const googleMutation = useMutation({
    mutationFn: async () => {
      const result = await signIn.social({
        provider: "google",
        callbackURL: redirectPath,
        errorCallbackURL: "/sign-in",
      });
      if (result.error) {
        throw new UserFacingError(
          authErrorMessage("signin", result.error.message),
        );
      }
      return result;
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    authMutation.mutate({
      name: String(data.get("name") ?? "Reader"),
      email: String(data.get("email")),
      password: String(data.get("password")),
    });
  }

  return (
    <div className="min-h-screen bg-background p-3 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-3">
      <div className="relative hidden overflow-hidden rounded-[2.5rem] bg-card p-12 lg:flex lg:flex-col">
        <Logo />
        <div className="my-auto max-w-xl">
          <p className="mb-5 text-sm font-semibold text-brand-ink">
            Your private reading room
          </p>
          <h1 className="max-w-xl text-6xl font-semibold leading-[1.05] tracking-[-0.05em]">
            A better conversation starts with the page.
          </h1>
          <div className="mt-10 space-y-4 text-sm text-muted-foreground">
            {[
              "Your PDFs stay scoped to your account",
              "Page-first answers with optional book retrieval",
              "Voice, visual explanations, notes, and progress together",
            ].map((point) => (
              <div key={point} className="flex items-center gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-brand-soft text-brand-ink">
                  <Check className="size-3.5" />
                </span>
                {point}
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Loreline · Read deeply. Keep wondering.
        </p>
      </div>

      <div className="flex min-h-[calc(100vh-1.5rem)] flex-col bg-background p-5 sm:p-8">
        <div className="flex items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
        </div>
        <div className="m-auto w-full max-w-md py-14">
          <p className="text-sm font-semibold text-brand-ink">
            {mode === "signin" ? "Welcome back" : "Begin your library"}
          </p>
          <h2 className="mt-3 text-5xl font-semibold leading-[1.08] tracking-[-0.047em]">
            {mode === "signin"
              ? "Return to your books."
              : "Make reading feel alive."}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {mode === "signin"
              ? "Sign in to pick up exactly where you left off."
              : "Create an account. Your first book is a few seconds away."}
          </p>

          <div className="mt-9 space-y-5">
            <Button
              type="button"
              variant="outline"
              size="xl"
              className="w-full"
              disabled={googleMutation.isPending}
              onClick={() => googleMutation.mutate()}
            >
              {googleMutation.isPending ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span>or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={submit} className="space-y-5">
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    autoComplete="name"
                    required
                    placeholder="How should Loreline address you?"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  minLength={10}
                  required
                  placeholder="At least 10 characters"
                />
              </div>
              <Button
                type="submit"
                size="xl"
                className="w-full"
                disabled={authMutation.isPending}
              >
                {authMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : null}
                {mode === "signin" ? "Sign in" : "Create account"}
                <ArrowRight data-icon="inline-end" />
              </Button>
            </form>
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "New to Loreline?" : "Already have a library?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
              }}
              className="font-semibold text-foreground underline-offset-4 hover:underline"
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </p>
          <p className="mt-10 text-center text-xs text-muted-foreground">
            By continuing, you agree to Loreline&apos;s{" "}
            <Link href="/privacy" className="underline">
              privacy principles
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}
