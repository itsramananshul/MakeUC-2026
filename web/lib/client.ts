import { DEMO_CODE } from "./world";

export function sessionUrl(code = DEMO_CODE, action = "") {
  return `/api/sessions/${encodeURIComponent(code)}${action ? `/${action}` : ""}`;
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The drill server is unavailable.");
  return result as T;
}
export const send = <T>(code: string, action: string, data: unknown) => api<T>(sessionUrl(code, action), {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});
export const timeLabel = (timestamp: string) => new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
