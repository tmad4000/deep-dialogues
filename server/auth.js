// Optional "Sign in with Ideaflow" (OpenID Connect, authorization code + PKCE).
// Reading never requires an account. Sessions are opaque random cookies; only their
// SHA-256 hash is stored. No third-party dependencies: Node's crypto verifies ID tokens.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature } from 'node:crypto';

const SESSION_COOKIE = 'dd_session';
const FLOW_COOKIE = 'dd_oidc';
const SESSION_DAYS = 30;
const FLOW_MINUTES = 10;

const b64url = buffer => Buffer.from(buffer).toString('base64url');
const sha256 = value => createHash('sha256').update(value).digest();
const random = (bytes = 32) => b64url(randomBytes(bytes));

export function authConfigFromEnv(env = process.env) {
  const issuer = env.IDEAFLOW_ISSUER || 'https://id.ideaflow.app/api/auth';
  const clientId = env.IDEAFLOW_CLIENT_ID, clientSecret = env.IDEAFLOW_CLIENT_SECRET;
  const publicOrigin = (env.PUBLIC_BASE_URL || 'https://deep-dialogues.ideaflow.app').replace(/\/$/, '');
  const list = value => (value || '').split(',').map(v => v.trim()).filter(Boolean);
  return {
    enabled: !!(clientId && clientSecret),
    issuer, clientId, clientSecret, publicOrigin,
    redirectUri: env.IDEAFLOW_REDIRECT_URI || `${publicOrigin}/auth/callback`,
    adminSubs: list(env.DD_ADMIN_SUBS),
    adminEmails: list(env.DD_ADMIN_EMAILS).map(e => e.toLowerCase()),
    // Secure cookies everywhere except an explicit plain-HTTP development origin.
    secureCookies: !publicOrigin.startsWith('http://'),
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const key = part.slice(0, i).trim();
      try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
    }
  }
  return out;
}

function cookie(name, value, { maxAge, secure, path = '/' }) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${maxAge}`;
}

// Only same-site relative paths may be used as post-login destinations.
export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || /[\r\n]/.test(value)) return '/';
  return value.slice(0, 500);
}

export function createAuth(store, config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  let discovery, discoveryAt = 0, jwks = new Map(), jwksAt = 0;

  async function getDiscovery() {
    if (discovery && now() - discoveryAt < 3600_000) return discovery;
    const response = await fetchImpl(`${config.issuer}/.well-known/openid-configuration`);
    if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
    const doc = await response.json();
    if (doc.issuer !== config.issuer) throw new Error('OIDC issuer mismatch');
    discovery = doc; discoveryAt = now();
    return doc;
  }

  async function keyFor(kid, refresh = false) {
    if (refresh || !jwks.size || now() - jwksAt > 3600_000) {
      const response = await fetchImpl((await getDiscovery()).jwks_uri);
      if (!response.ok) throw new Error(`JWKS fetch failed (${response.status})`);
      jwks = new Map((await response.json()).keys.map(k => [k.kid, k]));
      jwksAt = now();
    }
    const jwk = kid ? jwks.get(kid) : jwks.size === 1 ? [...jwks.values()][0] : undefined;
    if (!jwk && !refresh) return keyFor(kid, true);
    if (!jwk) throw new Error('Unknown ID token signing key');
    return jwk;
  }

  async function verifyIdToken(idToken, nonce) {
    const parts = String(idToken).split('.');
    if (parts.length !== 3) throw new Error('Malformed ID token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    const algorithms = { RS256: 'sha256', PS256: 'sha256', ES256: 'sha256', ES384: 'sha384', EdDSA: null };
    if (!(header.alg in algorithms)) throw new Error(`Unsupported ID token algorithm ${header.alg}`);
    const key = createPublicKey({ key: await keyFor(header.kid), format: 'jwk' });
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    const options = header.alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' }
      : header.alg === 'PS256' ? { key, padding: 6, saltLength: 32 } : key;
    if (!verifySignature(algorithms[header.alg], data, options, signature)) throw new Error('Invalid ID token signature');
    const seconds = Math.floor(now() / 1000);
    if (claims.iss !== config.issuer) throw new Error('ID token issuer mismatch');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(config.clientId)) throw new Error('ID token audience mismatch');
    if (audiences.length > 1 && claims.azp !== config.clientId) throw new Error('ID token azp mismatch');
    if (typeof claims.exp !== 'number' || claims.exp < seconds - 60) throw new Error('ID token expired');
    if (typeof claims.iat !== 'number' || claims.iat > seconds + 60 || claims.iat < seconds - 3600) throw new Error('ID token issued outside the accepted window');
    if (!claims.sub) throw new Error('ID token has no subject');
    const expected = Buffer.from(nonce), actual = Buffer.from(String(claims.nonce || ''));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('ID token nonce mismatch');
    return claims;
  }

  // Prepared lazily so tests may pass minimal fake stores that never touch sessions.
  const statements = {};
  const stmt = (name, sql) => statements[name] ||= store.db.prepare(sql);
  const insertSession = { run: (...a) => stmt('insert', 'INSERT INTO sessions (id_hash, sub, name, email, email_verified, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...a) };
  const readSession = { get: (...a) => stmt('read', 'SELECT sub, name, email, email_verified, expires_at FROM sessions WHERE id_hash = ?').get(...a) };
  const deleteSession = { run: (...a) => stmt('delete', 'DELETE FROM sessions WHERE id_hash = ?').run(...a) };
  const pruneSessions = { run: (...a) => stmt('prune', 'DELETE FROM sessions WHERE expires_at < ?').run(...a) };

  function isAdmin(user) {
    if (!user) return false;
    if (config.adminSubs.includes(user.sub)) return true;
    return !!(user.email_verified && user.email && config.adminEmails.includes(user.email.toLowerCase()));
  }

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const row = readSession.get(b64url(sha256(token)));
    if (!row || Date.parse(row.expires_at) < now()) return null;
    const user = { sub: row.sub, name: row.name || null, email: row.email || null, email_verified: !!row.email_verified };
    return { ...user, admin: isAdmin(user) };
  }

  // Signed state is unnecessary: the flow cookie is HttpOnly, short-lived and bound to state.
  async function login(req, res) {
    if (!config.enabled) return res.status(503).type('text').send('Sign-in is not configured');
    const d = await getDiscovery();
    const state = random(), nonce = random(), verifier = random(48);
    const returnTo = safeReturnPath(req.query.return);
    res.append('Set-Cookie', cookie(FLOW_COOKIE, JSON.stringify({ state, nonce, verifier, returnTo }), { maxAge: FLOW_MINUTES * 60, secure: config.secureCookies, path: '/auth' }));
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri,
      scope: 'openid profile email', state, nonce,
      code_challenge: b64url(sha256(verifier)), code_challenge_method: 'S256',
    }).toString();
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, url.toString());
  }

  async function callback(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const clearFlow = cookie(FLOW_COOKIE, '', { maxAge: 0, secure: config.secureCookies, path: '/auth' });
    let flow;
    try { flow = JSON.parse(parseCookies(req.headers.cookie)[FLOW_COOKIE] || 'null'); } catch { flow = null; }
    const fail = (status, message) => { res.append('Set-Cookie', clearFlow); return res.status(status).type('html').send(`<!doctype html><title>Sign-in failed — Deep Dialogues</title><p>${message}</p><p><a href="/">Back to Deep Dialogues</a></p>`); };
    if (!config.enabled) return fail(503, 'Sign-in is not configured.');
    if (req.query.error) return fail(400, 'Sign-in was cancelled or refused.');
    if (!flow || typeof req.query.state !== 'string' || req.query.state !== flow.state || typeof req.query.code !== 'string') return fail(400, 'Sign-in expired. Please try again.');
    if (req.query.iss !== undefined && req.query.iss !== config.issuer) return fail(400, 'Unexpected identity provider.');
    try {
      const d = await getDiscovery();
      const response = await fetchImpl(d.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64')}`,
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: config.redirectUri, code_verifier: flow.verifier }).toString(),
      });
      if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
      const tokens = await response.json();
      const claims = await verifyIdToken(tokens.id_token, flow.nonce);
      const token = random(32);
      const created = new Date(now());
      pruneSessions.run(created.toISOString());
      insertSession.run(b64url(sha256(token)), claims.sub,
        String(claims.name || claims.preferred_username || '').slice(0, 200) || null,
        claims.email ? String(claims.email).slice(0, 320) : null, claims.email_verified ? 1 : 0,
        created.toISOString(), new Date(now() + SESSION_DAYS * 86400_000).toISOString());
      res.append('Set-Cookie', clearFlow);
      res.append('Set-Cookie', cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: config.secureCookies }));
      res.redirect(302, safeReturnPath(flow.returnTo));
    } catch (error) {
      console.error('Sign-in failed:', error.message);
      return fail(502, 'Sign-in could not be completed. Please try again.');
    }
  }

  function logout(req, res) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) deleteSession.run(b64url(sha256(token)));
    res.append('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies }));
    res.status(204).end();
  }

  return { login, callback, logout, currentUser, verifyIdToken, isAdmin };
}

// Cookie-authenticated writes must come from this origin's own scripts.
export function requireSameOrigin(config) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    const allowed = origin === config.publicOrigin || (!config.secureCookies && origin && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin));
    if (!allowed || req.headers['x-requested-with'] !== 'deep-dialogues') return res.status(403).json({ error: 'Cross-site request refused' });
    next();
  };
}
