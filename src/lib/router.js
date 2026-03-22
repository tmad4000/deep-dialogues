/**
 * Minimal hash-based router.
 * Routes: #/ (gallery), #/read/:slug (reader), #/submit
 */

const routes = [];
let currentCleanup = null;

export function route(pattern, handler) {
  routes.push({ pattern, handler });
}

export function navigate(path) {
  window.location.hash = path;
}

export function currentPath() {
  return window.location.hash.slice(1) || '/';
}

function match(path) {
  // Separate path from query string
  const [pathname, queryString] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));

  for (const r of routes) {
    if (typeof r.pattern === 'string') {
      if (r.pattern === pathname) return { handler: r.handler, params: {}, query };
    } else {
      const m = pathname.match(r.pattern);
      if (m) return { handler: r.handler, params: m.groups || {}, query };
    }
  }
  return null;
}

export function startRouter(container) {
  function handleRoute() {
    const path = currentPath();
    const result = match(path);

    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }

    if (result) {
      window.scrollTo(0, 0);
      currentCleanup = result.handler(container, result.params, result.query) || null;
    }

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
      const href = link.getAttribute('href');
      if (href === `#${path}` || (path.startsWith('/read/') && href === '#/')) {
        link.classList.toggle('active', href === `#${path}`);
      } else {
        link.classList.toggle('active', href === `#${path}`);
      }
    });
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
