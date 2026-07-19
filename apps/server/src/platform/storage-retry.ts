const transientStorageCodes = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ERR_SSL_SSL/TLS_ALERT_BAD_RECORD_MAC",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function property(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

export function isTransientStorageFailure(cause: unknown) {
  const code = property(cause, "code");
  if (typeof code === "string" && transientStorageCodes.has(code)) return true;

  const metadata = property(cause, "$metadata");
  const httpStatusCode = property(metadata, "httpStatusCode");
  return (
    typeof httpStatusCode === "number" &&
    (httpStatusCode === 429 || httpStatusCode >= 500)
  );
}

type RetryStorageOptions = {
  maxAttempts?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export async function retryTransientStorage<T>(
  operation: () => Promise<T>,
  options: RetryStorageOptions = {},
) {
  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? wait;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (cause) {
      if (attempt >= maxAttempts || !isTransientStorageFailure(cause))
        throw cause;
      await sleep(200 * 2 ** (attempt - 1));
    }
  }
}
