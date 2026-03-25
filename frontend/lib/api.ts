export const API_BASE = "";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/api/proxy${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`GET ${path} => ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_BASE}/api/proxy${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`POST ${path} => ${res.status} ${txt}`);
  }
  return res.json() as Promise<T>;
}