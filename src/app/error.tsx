"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { showErrorToast } from "@/lib/toast-error";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => showErrorToast(error), [error]);

  return (
    <main className="grid min-h-[70vh] place-items-center p-6 text-center">
      <div className="max-w-md">
        <p className="text-sm font-semibold text-brand-ink">A brief pause</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">
          That page didn’t come together.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Nothing was lost. Try the action again.
        </p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
