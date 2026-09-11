/**
 * Super admin panel (/admin).
 *
 * A separate sign-in from the main app: the panel holds a short-lived bearer
 * token of its own, so being signed in as an employee grants nothing here and
 * closing the panel does not disturb the ordinary session.
 */

const API_BASE_URL = "/api";
const TOKEN_KEY = "sa_token";

export interface AdminUser {
  usrid: string;
  name: string;
  ulevl: string;
  enabled: boolean;
  mobile: string;
  ecode: string;
  companies: string[];
  branches: string[];
  is_super_admin: boolean;
}

export interface ScopeOption {
  code: string;
  name: string;
}

export interface BranchOption extends ScopeOption {
  compc: string;
}

export interface NewUserPayload {
  usrid: string;
  name?: string;
  password: string;
  ulevl?: "M" | "U";
  mobile?: string;
  ecode?: string;
  companies: string[];
  branches: string[];
}

export const getToken = () =>
  typeof window === "undefined" ? null : window.sessionStorage.getItem(TOKEN_KEY);

// sessionStorage, not localStorage: the token dies with the tab, which suits a
// panel that can rewrite everyone's access rights.
export const setToken = (token: string) => window.sessionStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => window.sessionStorage.removeItem(TOKEN_KEY);

async function adminRequest<T>(
  endpoint: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}/admin${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    // An expired or revoked token must not leave a half-usable screen behind.
    if (res.status === 401 && auth) clearToken();
    const err = await res.json().catch(() => ({}));
    const d = err?.detail;
    const msg =
      typeof d === "string"
        ? d
        : Array.isArray(d)
          ? d.map((x) => x?.msg ?? String(x)).join(", ")
          : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

export const superAdminService = {
  async login(usrid: string, password: string) {
    const res = await adminRequest<{
      token: string;
      user: { usrid: string; name: string; ulevl: string };
    }>("/login", { method: "POST", body: { usrid, password }, auth: false });
    setToken(res.token);
    return res.user;
  },

  /** Confirms a token kept from a page reload is still valid. */
  me: () => adminRequest<{ usrid: string }>("/me"),

  listUsers: () => adminRequest<{ items: AdminUser[] }>("/users"),

  scope: () =>
    adminRequest<{ companies: ScopeOption[]; branches: BranchOption[] }>("/scope"),

  setCompanies: (usrid: string, companies: string[]) =>
    adminRequest(`/users/${encodeURIComponent(usrid)}/companies`, {
      method: "PUT",
      body: { companies },
    }),

  setBranches: (usrid: string, branches: string[]) =>
    adminRequest(`/users/${encodeURIComponent(usrid)}/branches`, {
      method: "PUT",
      body: { branches },
    }),

  setStatus: (usrid: string, enabled: boolean) =>
    adminRequest(`/users/${encodeURIComponent(usrid)}/status`, {
      method: "PUT",
      body: { enabled },
    }),

  setPassword: (usrid: string, password: string) =>
    adminRequest(`/users/${encodeURIComponent(usrid)}/password`, {
      method: "PUT",
      body: { password },
    }),

  createUser: (payload: NewUserPayload) =>
    adminRequest<{ usrid: string }>("/users", { method: "POST", body: payload }),
};
