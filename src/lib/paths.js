// Vite mirrors can live under a prefix; clean production readers still use /.
export function appRoute(path = '/', base = import.meta.env?.BASE_URL || '/') {
  return `${base}#${path}`;
}
