"use client";

import { toast } from "sonner";
import { toUserMessage } from "@/lib/errors";

export function showErrorToast(error: unknown, fallback?: string) {
  toast.error(toUserMessage(error, fallback), {
    duration: 5_000,
  });
}
