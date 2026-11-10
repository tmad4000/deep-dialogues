import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { openStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { authConfigFromEnv, createAuth, safeReturnPath } from '../server/auth.js';

const ISSUER = 'https://id.example.test/api/auth';
const ORIGIN = 'https://dd.example.test';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'EdDSA', use: 'sig' };

function idToken(claims) {
  const enc = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg: 'EdDSA', kid: 'k1', typ: 'JWT' }), body = enc(claims);
  return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

// A fake Ideaflow ID: discovery, JWKS and a token endpoint that returns whatever claims the test queues.
function fakeIssuer() {
  const issued = [];
  let next = null;
  const fetchImpl = async (url, init = {}) => {
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url === `${ISSUER}/.well-known/openid-configuration`) return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth2/authorize`, token_endpoint: `${ISSUER}/oauth2/token`, jwks_uri: `${ISSUER}/jwks` });
    if (url === `${ISSUER}/jwks`) return json({ keys: [jwk] });
    if (url === `${ISSUER}/oauth2/token`) {
      const form = new URLSearchParams(init.body);
      issued.push({ form, authorization: init.headers.Authorization });
      return json({ access_token: 'unused', id_token: idToken(next(form)) });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, issued, setClaims: fn => { next = fn; } };
}

async function startApp(env = {}, noos = null) {
  const store = openStore(':memory:');
  const authConfig = authConfigFromEnv({ IDEAFLOW_ISSUER: ISSUER, IDEAFLOW_CLIENT_ID: 'dd-client', IDEAFLOW_CLIENT_SECRET: 's3cret', PUBLIC_BASE_URL: ORIGIN, DD_ADMIN_EMAILS: 'admin@example.test', ...env });
  const issuer = fakeIssuer();
  const auth = createAuth(store, authConfig, { fetchImpl: issuer.fetchImpl });
  const server = createApp(store, process.cwd(), { authConfig, auth, noos }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { store, issuer, url, close: () => new Promise(resolve => server.close(() => { store.db.close(); resolve(); })) };
}

const cookieValue = (res, name) => res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith(name + '='));

async function signIn(ctx, claims, returnTo = '/#/my') {
  const login = await fetch(`${ctx.url}/auth/login?return=${encodeURIComponent(returnTo)}`, { redirect: 'manual' });
  assert.equal(login.status, 302);
  const authorize = new URL(login.headers.get('location'));
  assert.equal(authorize.origin + authorize.pathname, `${ISSUER}/oauth2/authorize`);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback`);
  assert.equal(authorize.searchParams.get('scope'), 'openid profile email');
  const flow = cookieValue(login, 'dd_oidc');
  ctx.issuer.setClaims(() => ({ iss: ISSUER, aud: 'dd-client', exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000), nonce: authorize.searchParams.get('nonce'), ...claims }));
  const callback = await fetch(`${ctx.url}/auth/callback?code=abc&state=${authorize.searchParams.get('state')}&iss=${encodeURIComponent(ISSUER)}`, { redirect: 'manual', headers: { cookie: flow } });
  return { callback, session: cookieValue(callback, 'dd_session'), authorize };
}

const write = (session, extra = {}) => ({ 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Requested-With': 'deep-dialogues', cookie: session, ...extra });
const sample = { title: 'Signed-in dialogue', messages: [{ role: 'user', content: 'Q1' }, { role: 'ai', content: 'A1' }, { role: 'user', content: 'Q2' }, { role: 'ai', content: 'A2' }] };

test('sign in, credited submission, own edits and admin publication of full and highlights', async () => {
  const ctx = await startApp();
  try {
    assert.deepEqual(await (await fetch(`${ctx.url}/api/me`)).json(), { signInAvailable: true, user: null });

    const { callback, session } = await signIn(ctx, { sub: 'user-1', name: 'Ada', email: 'ada@example.test', email_verified: true });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/#/my');
    assert.match(callback.headers.getSetCookie().join('\n'), /dd_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Secure/);
    const [{ form, authorization }] = ctx.issuer.issued;
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.ok(form.get('code_verifier').length >= 43);
    assert.equal(authorization, 'Basic ' + Buffer.from('dd-client:s3cret').toString('base64'));
    assert.deepEqual((await (await fetch(`${ctx.url}/api/me`, { headers: { cookie: session } })).json()).user, { name: 'Ada', email: 'ada@example.test', admin: false });

    // Submission is credited to the Ideaflow identity, but that identity never reaches public responses.
    const submitted = await (await fetch(`${ctx.url}/api/conversations`, { method: 'POST', headers: write(session), body: JSON.stringify(sample) })).json();
    assert.equal(submitted.status, 'pending');
    assert.equal(submitted.contributor_name, 'Ada');
    assert.equal(submitted.submitted_by.sub, 'user-1');
    // A cross-site page cannot attribute or read through the session.
    const crossSite = await (await fetch(`${ctx.url}/api/conversations`, { method: 'POST', headers: write(session, { Origin: 'https://evil.example' }), body: JSON.stringify(sample) })).json();
    assert.equal(crossSite.submitted_by, undefined);
    assert.equal((await fetch(`${ctx.url}/api/my/submissions`, { headers: { cookie: session } })).status, 200);
    assert.equal((await fetch(`${ctx.url}/api/my/submissions/${submitted.slug}`, { method: 'PUT', headers: write(session, { Origin: 'https://evil.example' }), body: JSON.stringify(sample) })).status, 403);
    assert.equal((await fetch(`${ctx.url}/api/my/submissions`, { headers: { cookie: session } })).headers.get('access-control-allow-origin'), null);

    const mine = await (await fetch(`${ctx.url}/api/my/submissions`, { headers: { cookie: session } })).json();
    assert.deepEqual(mine.map(r => r.slug), [submitted.slug]);
    const edited = await fetch(`${ctx.url}/api/my/submissions/${submitted.slug}`, { method: 'PUT', headers: write(session), body: JSON.stringify({ ...sample, title: 'Edited title', tags: ['edited'] }) });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).title, 'Edited title');

    // Another account can neither see nor edit it, and non-admins cannot review.
    const other = (await signIn(ctx, { sub: 'user-2', name: 'Bo' })).session;
    assert.equal((await fetch(`${ctx.url}/api/my/submissions/${submitted.slug}`, { headers: { cookie: other } })).status, 404);
    assert.equal((await fetch(`${ctx.url}/api/my/submissions/${submitted.slug}`, { method: 'PUT', headers: write(other), body: JSON.stringify(sample) })).status, 404);
    assert.equal((await fetch(`${ctx.url}/api/admin/queue`, { headers: { ...write(other) } })).status, 403);
    assert.equal((await fetch(`${ctx.url}/api/admin/queue`)).status, 401);

    // An unverified email never grants admin rights.
    const spoof = (await signIn(ctx, { sub: 'user-3', email: 'admin@example.test', email_verified: false })).session;
    assert.equal((await fetch(`${ctx.url}/api/admin/queue`, { headers: write(spoof) })).status, 403);

    const admin = (await signIn(ctx, { sub: 'admin-1', name: 'Jacob', email: 'admin@example.test', email_verified: true })).session;
    const queue = await (await fetch(`${ctx.url}/api/admin/queue`, { headers: write(admin) })).json();
    // The cross-site submission above is queued too, but anonymously.
    assert.deepEqual(queue.map(r => r.submitted_by?.name ?? null).sort(), ['Ada', null]);
    assert.ok(queue.some(r => r.slug === submitted.slug));
    const review = await fetch(`${ctx.url}/api/admin/conversations/${submitted.slug}/review`, { method: 'POST', headers: write(admin), body: JSON.stringify({ action: 'publish', version: 'both', highlights: [2, 3] }) });
    assert.equal(review.status, 200);
    const { rows } = await review.json();
    const highlightsSlug = rows[1].slug;
    assert.match(highlightsSlug, /-highlights$/);

    const full = await (await fetch(`${ctx.url}/api/conversations/${submitted.slug}`)).json();
    assert.deepEqual(full.versions, { full: submitted.slug, highlights: highlightsSlug });
    for (const key of ['submitted_by', 'review', 'highlight_source_indices']) assert.equal(full[key], undefined);
    const highlights = await (await fetch(`${ctx.url}/api/conversations/${highlightsSlug}`)).json();
    assert.deepEqual(highlights.messages.map(m => m.content), ['Q2', 'A2']);
    assert.equal(highlights.contributor_name, 'Ada');
    assert.equal(highlights.submitted_by, undefined);
    assert.ok(!JSON.stringify(await (await fetch(`${ctx.url}/api/conversations?limit=100`)).json()).includes('user-1'));

    // Once published, the contributor sees the outcome but can no longer edit.
    assert.equal((await fetch(`${ctx.url}/api/my/submissions/${submitted.slug}`, { method: 'PUT', headers: write(session), body: JSON.stringify(sample) })).status, 409);
    assert.equal((await (await fetch(`${ctx.url}/api/my/submissions/${submitted.slug}`, { headers: { cookie: session } })).json()).status, 'published');

    // Unpublishing one version removes the public link to it from the other.
    await fetch(`${ctx.url}/api/admin/conversations/${highlightsSlug}/review`, { method: 'POST', headers: write(admin), body: JSON.stringify({ action: 'unpublish' }) });
    assert.equal((await fetch(`${ctx.url}/api/conversations/${highlightsSlug}`)).status, 404);
    assert.equal((await (await fetch(`${ctx.url}/api/conversations/${submitted.slug}`)).json()).versions, undefined);

    // Logout revokes the server-side session.
    assert.equal((await fetch(`${ctx.url}/auth/logout`, { method: 'POST', headers: write(session) })).status, 204);
    assert.equal((await (await fetch(`${ctx.url}/api/me`, { headers: { cookie: session } })).json()).user, null);
  } finally { await ctx.close(); }
});

test('highlights-only publication keeps the full transcript private, and rejection is visible to the contributor', async () => {
  const ctx = await startApp({ DD_ADMIN_SUBS: 'admin-sub' });
  try {
    const user = (await signIn(ctx, { sub: 'u' })).session;
    const admin = (await signIn(ctx, { sub: 'admin-sub' })).session;
    const a = await (await fetch(`${ctx.url}/api/conversations`, { method: 'POST', headers: write(user), body: JSON.stringify({ ...sample, original_url: 'https://example.test/full-transcript' }) })).json();
    const b = await (await fetch(`${ctx.url}/api/conversations`, { method: 'POST', headers: write(user), body: JSON.stringify({ ...sample, title: 'Second' }) })).json();
    const bad = await fetch(`${ctx.url}/api/admin/conversations/${a.slug}/review`, { method: 'POST', headers: write(admin), body: JSON.stringify({ action: 'publish', version: 'highlights', highlights: [0, 1, 2, 3] }) });
    assert.equal(bad.status, 409);
    const { rows } = await (await fetch(`${ctx.url}/api/admin/conversations/${a.slug}/review`, { method: 'POST', headers: write(admin), body: JSON.stringify({ action: 'publish', version: 'highlights', highlights: [0, 1], highlights_title: 'Short' }) })).json();
    assert.equal(rows[0].status, 'superseded');
    assert.equal((await fetch(`${ctx.url}/api/conversations/${a.slug}`)).status, 404);
    const short = await (await fetch(`${ctx.url}/api/conversations/${rows[1].slug}`)).json();
    assert.equal(short.title, 'Short');
    assert.equal(short.versions, undefined);
    assert.equal(short.original_url, undefined);
    assert.equal(ctx.store.readRaw(rows[1].slug).original_url, undefined);
    await fetch(`${ctx.url}/api/admin/conversations/${b.slug}/review`, { method: 'POST', headers: write(admin), body: JSON.stringify({ action: 'reject', reason: 'Duplicate' }) });
    const mine = await (await fetch(`${ctx.url}/api/my/submissions`, { headers: { cookie: user } })).json();
    assert.deepEqual(Object.fromEntries(mine.map(r => [r.title, r.status])), { Second: 'rejected', 'Signed-in dialogue': 'superseded', Short: 'published' });
    assert.equal(mine.find(r => r.title === 'Second').review.reason, 'Duplicate');
  } finally { await ctx.close(); }
});

test('callback rejects forged state, wrong audience and replayed nonce; login degrades without configuration', async () => {
  const ctx = await startApp();
  try {
    const login = await fetch(`${ctx.url}/auth/login`, { redirect: 'manual' });
    const flow = cookieValue(login, 'dd_oidc');
    const nonce = new URL(login.headers.get('location')).searchParams.get('nonce');
    const state = new URL(login.headers.get('location')).searchParams.get('state');
    assert.equal((await fetch(`${ctx.url}/auth/callback?code=x&state=forged`, { redirect: 'manual', headers: { cookie: flow } })).status, 400);
    const base = { iss: ISSUER, sub: 'x', exp: Math.floor(Date.now() / 1000) + 60, iat: Math.floor(Date.now() / 1000) };
    ctx.issuer.setClaims(() => ({ ...base, aud: 'someone-else', nonce }));
    assert.equal((await fetch(`${ctx.url}/auth/callback?code=x&state=${state}`, { redirect: 'manual', headers: { cookie: flow } })).status, 502);
    ctx.issuer.setClaims(() => ({ ...base, aud: 'dd-client', nonce: 'other' }));
    assert.equal((await fetch(`${ctx.url}/auth/callback?code=x&state=${state}`, { redirect: 'manual', headers: { cookie: flow } })).status, 502);
    assert.equal((await fetch(`${ctx.url}/auth/callback?code=x&state=${state}&iss=https://evil.example`, { redirect: 'manual', headers: { cookie: flow } })).status, 400);
  } finally { await ctx.close(); }
  const off = openStore(':memory:');
  const config = authConfigFromEnv({});
  const server = createApp(off, process.cwd(), { authConfig: config }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${url}/auth/login`, { redirect: 'manual' })).status, 503);
    assert.deepEqual(await (await fetch(`${url}/api/me`)).json(), { signInAvailable: false, user: null });
    assert.equal((await fetch(`${url}/api/conversations`)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); off.db.close(); }
});

test('post-login destinations stay on this site', () => {
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/x\r\nSet-Cookie: a=b', undefined]) assert.equal(safeReturnPath(bad), '/');
  assert.equal(safeReturnPath('/read/x?at=message-2'), '/read/x?at=message-2');
});


test('review responds before Noos synchronization finishes', async () => {
  let release, started;
  const blocked = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  let finished = false;
  const noos = { enabled: true, status: () => null, syncSlugs: async () => { started(); await blocked; finished = true; } };
  const ctx = await startApp({}, noos);
  try {
    const { session } = await signIn(ctx, { sub: 'admin', email: 'admin@example.test', email_verified: true });
    const row = ctx.store.save({ slug: 'queued-review', title: 'Queued', messages: [{ role: 'human', content: 'Hello' }] });
    const response = await fetch(`${ctx.url}/api/admin/conversations/${row.slug}/review`, { method: 'POST', headers: write(session), body: JSON.stringify({ action: 'publish' }) });
    const result = await response.json();
    await entered;
    assert.equal(response.status, 200);
    assert.equal(ctx.store.readRaw(row.slug).status, 'published');
    assert.deepEqual(result.noos, [{ slug: row.slug, state: 'queued' }]);
    assert.equal(finished, false);
    release();
    await blocked;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, true);
  } finally { release(); await ctx.close(); }
});
