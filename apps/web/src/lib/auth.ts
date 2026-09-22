const TOKEN_KEY = 'spv4_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export type Role = 'OWNER' | 'MANAGER' | 'OPERATOR' | 'READ_ONLY';

export interface DecodedJwt {
  kind?: 'user' | 'admin';
  userId?: string;
  accountId?: string;
  email?: string;
  role?: Role;
  iat?: number;
  exp?: number;
}

export function decodeJwt(token: string): DecodedJwt | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised + '==='.slice((normalised.length + 3) % 4);
    return JSON.parse(atob(padded)) as DecodedJwt;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  const decoded = decodeJwt(token);
  if (!decoded?.exp) return true;
  return decoded.exp * 1000 > Date.now();
}

export function currentUser(): DecodedJwt | null {
  const token = getToken();
  return token ? decodeJwt(token) : null;
}

const ROLE_RANK: Record<Role, number> = { READ_ONLY: 0, OPERATOR: 1, MANAGER: 2, OWNER: 3 };

/** True when the signed-in user holds `role` or a higher one. */
export function hasRole(role: Role): boolean {
  const user = currentUser();
  if (!user?.role) return false;
  return ROLE_RANK[user.role] >= ROLE_RANK[role];
}
