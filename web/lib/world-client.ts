export const incidentPath = (id: string, operation?: string) =>
  `/api/incidents/${encodeURIComponent(id)}${operation ? `/${operation}` : ""}`;
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || "The server is temporarily unavailable.");
  return body as T;
}
export function postJson<T>(url: string, body: unknown, key?: string) {
  return fetchJson<T>(url, {
    method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
}
