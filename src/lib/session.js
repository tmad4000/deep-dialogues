// Optional Ideaflow sign-in state. Account routes are same-origin only, so static mirrors
// (or any failure) simply behave as signed out; reading never depends on this.
const apiBase = (import.meta.env.VITE_API_BASE_URL || import.meta.env.BASE_URL).replace(/\/$/, '');
const sameOrigin = !import.meta.env.VITE_API_BASE_URL;
let current = null;

export async function loadSession(force = false) {
  if (current && !force) return current;
  if (!sameOrigin) return (current = { signInAvailable: false, user: null });
  try {
    const response = await fetch(`${apiBase}/api/me`, { credentials: 'same-origin' });
    current = response.ok ? await response.json() : { signInAvailable: false, user: null };
  } catch { current = { signInAvailable: false, user: null }; }
  return current;
}

export function signInHref(returnTo = location.pathname + location.search + location.hash) {
  return `${apiBase}/auth/login?return=${encodeURIComponent(returnTo)}`;
}

export async function account(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method, credentials: 'same-origin',
    headers: { 'X-Requested-With': 'deep-dialogues', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result?.error || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return result;
}

export async function signOut() {
  await account('/auth/logout', { method: 'POST' });
  current = null;
}

export const accountHeaders = { 'X-Requested-With': 'deep-dialogues' };
