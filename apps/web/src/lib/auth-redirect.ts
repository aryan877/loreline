export const DEFAULT_AUTH_REDIRECT = "/library";

export function safeAuthRedirect(next: string | null | undefined) {
  if (!next?.startsWith("/") || next.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT;
  }
  return next;
}
