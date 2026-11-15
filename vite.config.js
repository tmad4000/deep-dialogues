import { readFileSync } from 'node:fs'
import { appInfo } from './scripts/build-info.mjs'
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const info = appInfo(version)

export default {
  plugins: [{ name: 'app-version', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(info) + '\n' })
  } }],
  base: process.env.VITE_BASE_PATH || '/',
  server: { port: 7842, proxy: { '/api': 'http://127.0.0.1:7845' } },
  preview: { port: 7843 },
}
