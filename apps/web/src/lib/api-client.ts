import { UserFacingError } from "@/lib/errors";

export type ApiErrorResponse = { error?: unknown };

function publicApiMessage(data: ApiErrorResponse, status: number) {
  if (
    typeof data.error === "string" &&
    data.error.length > 0 &&
    data.error.length <= 200 &&
    !/[\r\n]/.test(data.error)
  ) {
    return data.error;
  }
  return status === 401
    ? "Please sign in to continue."
    : "We couldn’t complete that request. Please try again.";
}

export async function apiJson<T extends object>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as
    | T
    | ApiErrorResponse;
  if (!response.ok) {
    throw new UserFacingError(
      publicApiMessage(data as ApiErrorResponse, response.status),
      response.status,
    );
  }
  return data as T;
}
