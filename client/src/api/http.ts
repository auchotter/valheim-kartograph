export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await request(path, options);
  return (await response.json()) as T;
}

export async function requestEmpty(path: string, options: RequestInit = {}): Promise<void> {
  await request(path, options);
}

async function request(path: string, options: RequestInit): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new ApiClientError(
      typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status}).`,
      response.status,
    );
  }
  return response;
}
