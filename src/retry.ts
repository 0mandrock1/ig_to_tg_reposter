const MAX_RETRIES = 3;

export async function withRetry<T>(fn: () => Promise<T>, label: string, logPrefix: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const backoffMs = 2 ** attempt * 1000;
      console.error(`${logPrefix} ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${(err as Error).message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError;
}
