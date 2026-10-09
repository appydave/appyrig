const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/** Error thrown when an API request receives a non-2xx HTTP response. */
class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options?: RequestInit & { signal?: AbortSignal }
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    throw new ApiError(res.status, `Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Typed HTTP request helpers for the AppyStack template.
 * All methods throw ApiError on non-2xx responses.
 */
export const api = {
  /** Send a GET request and return the parsed JSON response. */
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  /** Send a POST request with a JSON body and return the parsed JSON response. */
  post: <T>(path: string, body: unknown, signal?: AbortSignal) =>
    request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      signal,
    }),
};

export { ApiError };
