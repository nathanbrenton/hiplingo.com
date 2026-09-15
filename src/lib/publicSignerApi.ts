const configuredRightsApi = import.meta.env.VITE_RIGHTS_API_BASE_URL?.trim();

export const PUBLIC_SIGNER_API_BASE =
  configuredRightsApi || (import.meta.env.DEV ? "http://127.0.0.1:4175/api" : "/api");

export async function publicSignerRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${PUBLIC_SIGNER_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;

    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail || detail;
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }

    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}
