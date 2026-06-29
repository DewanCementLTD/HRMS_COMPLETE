// Use Next.js rewrite proxy to avoid CORS issues with the backend
const API_BASE_URL = "/api";

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const config: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    // `detail` may be a string, an object (e.g. FORCE_UPDATE), or a list of
    // validation errors (FastAPI 422). Always surface a readable string so the
    // UI never shows "[object Object]".
    const d = error?.detail;
    let msg: string;
    if (typeof d === "string") msg = d;
    else if (Array.isArray(d)) msg = d.map((x) => x?.msg || (typeof x === "string" ? x : JSON.stringify(x))).join(", ");
    else if (d && typeof d === "object") msg = d.message || d.msg || JSON.stringify(d);
    else msg = `HTTP ${response.status}`;
    throw new Error(msg || `HTTP ${response.status}`);
  }

  return response.json();
}
