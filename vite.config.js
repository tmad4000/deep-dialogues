export default {
  base: process.env.VITE_BASE_PATH || '/',
  server: { port: 7842, proxy: { '/api': 'http://127.0.0.1:7845' } },
  preview: { port: 7843 },
}
