/** Petit wrapper fetch côté client. */
export async function api<T = any>(
  url: string,
  options?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = options || {};
  const res = await fetch(url, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(rest.headers || {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data as T;
}
