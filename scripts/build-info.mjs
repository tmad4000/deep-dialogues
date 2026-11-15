import { execFileSync } from 'node:child_process'

export function appInfo(version) {
  // The same immutable metadata drives the footer and the deploy-check endpoint.
  const buildTime = new Date().toISOString()
  let commit = '', commitTime = '', event = 'build'
  try {
    commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()
    commitTime = execFileSync('git', ['log', '-1', '--format=%cI', 'HEAD'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()
    event = dirty ? 'build' : 'commit'
    if (dirty) commit += '-dirty'
  } catch { /* Source archives without git use the recorded build time. */ }
  return { version, commit, commitTime, buildTime, event }
}
