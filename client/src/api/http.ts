export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new ApiClientError(
      typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status}).`,
      response.status,
    );
  }
  return (await response.json()) as T;
}
