// Use Next.js rewrite proxy to avoid CORS issues with the backend
const API_BASE_URL = "/api";

/** The signed login token of the signed-in user, if any. */
export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const u = JSON.parse(window.localStorage.getItem("lms_user") || "null");
    return typeof u?.session_token === "string" && u.session_token ? u.session_token : null;
  } catch {
    return null;
  }
}

/** Authorization header for raw fetch() calls (uploads, downloads). */
export function sessionHeaders(): Record<string, string> {
  const t = getSessionToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Adds the login token to an API URL the browser loads by itself (<img src>,
 * download links), which cannot carry an Authorization header.
 */
export function withSession(url: string): string {
  const t = getSessionToken();
  if (!t) return url;
  return `${url}${url.includes("?") ? "&" : "?"}session_token=${encodeURIComponent(t)}`;
}

/** The server no longer accepts this login (missing, expired or forged token). */
function endSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("lms_user");
  if (window.location.pathname !== "/") window.location.href = "/";
}

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
      ...sessionHeaders(),
      ...headers,
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    if (response.status === 401 && error?.detail?.code === "SESSION_REQUIRED") endSession();
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
