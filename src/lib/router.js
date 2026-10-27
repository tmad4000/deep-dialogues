/**
 * Hash routes take precedence over clean reader paths.
 * Public reader URL and passage-link usage is documented in README.md.
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
  if (window.location.hash.startsWith('#/')) return window.location.hash.slice(1);
  return window.location.pathname.startsWith('/read/') ? window.location.pathname + window.location.search : '/';
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
  let generation=0;
  async function handleRoute() {
    const thisGeneration=++generation;
    const path = currentPath();
    const result = match(path);

    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }

    if (result) {
      window.scrollTo(0, 0);
      const cleanup = await result.handler(container, result.params, result.query, {isCurrent:()=>generation===thisGeneration});
      if (generation!==thisGeneration) { if(typeof cleanup==='function')cleanup(); return; }
      currentCleanup = typeof cleanup==='function' ? cleanup : null;
    }

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
      const href = link.hash;
      link.classList.toggle('active', href === `#${path}`);
    });
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
