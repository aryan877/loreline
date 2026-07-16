import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { currentUserResponseSchema } from "@loreline/contracts/auth";

const serverUrl = process.env.SERVER_INTERNAL_URL ?? "http://127.0.0.1:3001";

export const getCurrentUser = cache(async () => {
  const requestHeaders = await headers();

  try {
    const response = await fetch(`${serverUrl}/api/auth/get-session`, {
      cache: "no-store",
      headers: {
        cookie: requestHeaders.get("cookie") ?? "",
        "x-forwarded-host": requestHeaders.get("host") ?? "localhost:3000",
        "x-forwarded-proto": requestHeaders.get("x-forwarded-proto") ?? "http",
      },
    });
    if (!response.ok) return null;

    const result = currentUserResponseSchema.safeParse(await response.json());
    return result.success ? result.data.user : null;
  } catch (error) {
    console.error("Loreline session service unavailable", error);
    return null;
  }
});
