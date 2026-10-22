import fs from 'node:fs'
import path from 'node:path'

// Ported from https://github.com/MakerXStudio data-streams CLI upgrade-docs.ts writeManaged.
type ManagedAction = 'unchanged' | 'updated' | 'created' | 'appended'

export type ManagedFileResult = {
  path: string
  action: ManagedAction
}

/** One-character prefix shown per action in scaffold reports. */
export const ACTION_MARK: Record<ManagedAction, string> = { created: '+', appended: '»', updated: '~', unchanged: ' ' }

function readIfExists(file: string): string | null {
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf-8')
}

function createFile(file: string, contents: string, results: ManagedFileResult[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents, { encoding: 'utf8', flag: 'wx' })
  results.push({ path: file, action: 'created' })
}

/** Guard before overwriting an existing path: never write through a symlink or over a non-regular file. */
function assertRegularFile(file: string): void {
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink()) throw new Error(`Refusing to write through symlink at ${file}`)
  if (!stat.isFile()) throw new Error(`Refusing to write to non-regular file at ${file}`)
}

/**
 * Idempotently write a CLI-managed file: create if missing, rewrite if changed, leave alone if identical.
 * Refuses to write through a symlink or over a non-regular file.
 */
export function writeManaged(file: string, contents: string, results: ManagedFileResult[]): void {
  const existing = readIfExists(file)
  if (existing === null) return createFile(file, contents, results)
  if (existing === contents) {
    results.push({ path: file, action: 'unchanged' })
    return
  }
  assertRegularFile(file)
  fs.writeFileSync(file, contents, { encoding: 'utf8', flag: 'w' })
  results.push({ path: file, action: 'updated' })
}

/**
 * Ensure a user-owned file (CLAUDE.md / AGENTS.md) contains a pointer block. Creates the file with the block
 * when missing; appends the block when the file exists but contains none of `markers`; otherwise leaves the file
 * untouched. Never rewrites existing content.
 */
export function ensurePointer(file: string, block: string, markers: readonly string[], results: ManagedFileResult[]): void {
  const existing = readIfExists(file)
  if (existing === null) return createFile(file, block, results)
  if (markers.some((marker) => existing.includes(marker))) {
    results.push({ path: file, action: 'unchanged' })
    return
  }
  assertRegularFile(file)
  const separator = existing.endsWith('\n') ? '\n' : '\n\n'
  fs.writeFileSync(file, existing + separator + block, { encoding: 'utf8', flag: 'w' })
  results.push({ path: file, action: 'appended' })
}

export function summarise(results: readonly ManagedFileResult[]): {
  created: number
  updated: number
  unchanged: number
  appended: number
} {
  return {
    created: results.filter((r) => r.action === 'created').length,
    updated: results.filter((r) => r.action === 'updated').length,
    unchanged: results.filter((r) => r.action === 'unchanged').length,
    appended: results.filter((r) => r.action === 'appended').length,
  }
}
