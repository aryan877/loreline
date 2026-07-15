"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL:
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window === "undefined"
      ? "http://localhost:3000"
      : window.location.origin),
});

export const { signIn, signOut, signUp, useSession } = authClient;
