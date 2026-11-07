export function checkpointFromQR(value: string, code: string, ids: string[]): string | null {
  const payload = value.trim().toUpperCase();
  const match = /^AFTERMAP:([A-Z0-9]+):([A-Z0-9-]+)$/.exec(payload);
  if (match && match[1] !== code.toUpperCase()) return null;
  const id = match ? match[2] : payload;
  return ids.includes(id) ? id : null;
}
