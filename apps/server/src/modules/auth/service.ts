import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@loreline/database/client";
import { redisSecondaryStorage } from "@/platform/redis";

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const googleProvider =
  googleClientId && googleClientSecret
    ? {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        overrideUserInfoOnSignIn: true,
      }
    : undefined;

export const auth = betterAuth({
  appName: "Loreline",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "local-development-only-secret-change-before-production",
  database: drizzleAdapter(db, { provider: "pg" }),
  secondaryStorage: redisSecondaryStorage,
  rateLimit: {
    enabled: true,
    storage: "secondary-storage",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-up/email": { window: 60 * 10, max: 5 },
      "/forget-password": { window: 60 * 15, max: 3 },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  account: {
    accountLinking: {
      updateUserInfoOnLink: true,
    },
  },
  socialProviders: googleProvider
    ? { google: googleProvider }
    : undefined,
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "loreline",
  },
});

export type Session = typeof auth.$Infer.Session;
