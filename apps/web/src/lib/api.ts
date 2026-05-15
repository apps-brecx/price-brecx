const TOKEN_KEY = 'priceobo.token';
const WORKSPACE_KEY = 'priceobo.workspaceId';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getWorkspaceId() {
  return localStorage.getItem(WORKSPACE_KEY);
}
export function setWorkspaceId(id: string | null) {
  if (id) localStorage.setItem(WORKSPACE_KEY, id);
  else localStorage.removeItem(WORKSPACE_KEY);
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const BASE = (import.meta as any).env?.VITE_API_URL || '';

export async function api<T = any>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const wsId = getWorkspaceId();
  if (wsId) headers['x-workspace-id'] = wsId;

  let body = init.body;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers, body });
  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = (isJson && (payload?.error || payload?.message)) || `HTTP ${res.status}`;
    if (res.status === 401) {
      setToken(null);
      setWorkspaceId(null);
      if (!location.pathname.startsWith('/sign-in')) location.assign('/sign-in');
    }
    throw new ApiError(res.status, msg, payload);
  }
  return payload as T;
}
