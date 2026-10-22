import fs from 'node:fs'
import path from 'node:path'

import type { CheckMode } from '../checks/types.ts'
import { detectPackageManager, PACKAGE_MANAGER_COMMANDS } from '../shared/packageManager.ts'
import { runShellCommand } from '../shared/spawn.ts'

export type VerifyEntry = {
  name: string
  command: string
  cwd: string
  /** Extra env for the child, merged over `process.env`. */
  env?: Record<string, string>
}

export function scriptEntry(name: string, dir: string): VerifyEntry {
  const { command, env } = PACKAGE_MANAGER_COMMANDS[detectPackageManager(dir)].runScript(name)
  return env ? { name, command, cwd: dir, env } : { name, command, cwd: dir }
}

export function runEntryCommand(entry: VerifyEntry): Promise<number> {
  return runShellCommand(entry.command, { cwd: entry.cwd, env: entry.env, quiet: true })
}

const VERIFY_PREFIX = 'verify:'
const FIX_SUFFIX = ':fix'

/** The check a `verify:*` script targets, ignoring a trailing `:fix`. `verify:lint` and `verify:lint:fix` → `lint`. */
export function entryCheckName(entryName: string): string {
  const withoutPrefix = entryName.startsWith(VERIFY_PREFIX) ? entryName.slice(VERIFY_PREFIX.length) : entryName
  return withoutPrefix.endsWith(FIX_SUFFIX) ? withoutPrefix.slice(0, -FIX_SUFFIX.length) : withoutPrefix
}

/** Walk up from `startDir` to the nearest package.json. */
function findPackageJson(startDir: string): string | null {
  let dir = path.resolve(startDir)
  for (;;) {
    const candidate = path.join(dir, 'package.json')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

type PackageJson = { scripts?: Record<string, string> }

/** The nearest package.json's scripts + its directory, or null when none is found / it can't be parsed. */
export function loadPackageScripts(cwd: string = process.cwd()): { scripts: Record<string, string>; dir: string } | null {
  const pkgPath = findPackageJson(cwd)
  if (!pkgPath) return null
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJson
    return { scripts: pkg.scripts ?? {}, dir: path.dirname(pkgPath) }
  } catch {
    return null
  }
}

/** Collect the project's `verify:*` scripts as parallelisable entries, nearest package.json wins. */
export function resolveEntries(cwd: string = process.cwd()): VerifyEntry[] {
  const loaded = loadPackageScripts(cwd)
  if (!loaded) return []
  return Object.keys(loaded.scripts)
    .filter((name) => name.startsWith(VERIFY_PREFIX))
    .map((name) => scriptEntry(name, loaded.dir))
}

/**
 * Collapse `verify:<name>` / `verify:<name>:fix` pairs to one entry per check for the run mode: fix mode
 * prefers the `:fix` variant (falling back to the base), check mode uses the base only. This is what bare
 * `verifyx` runs.
 */
export function selectEntries(entries: readonly VerifyEntry[], mode: CheckMode): VerifyEntry[] {
  const byCheck = new Map<string, { base?: VerifyEntry; fix?: VerifyEntry }>()
  for (const entry of entries) {
    const key = entryCheckName(entry.name)
    const group = byCheck.get(key) ?? {}
    if (entry.name.endsWith(FIX_SUFFIX)) group.fix = entry
    else group.base = entry
    byCheck.set(key, group)
  }
  const selected: VerifyEntry[] = []
  for (const { base, fix } of byCheck.values()) {
    const chosen = mode === 'fix' ? (fix ?? base) : base
    if (chosen) selected.push(chosen)
  }
  return selected
}

/** The override script for a built-in `<checkName>` under `verifyx all`: the `:fix` variant in fix mode, else the base. */
export function resolveOverride(entries: readonly VerifyEntry[], checkName: string, mode: CheckMode): VerifyEntry | undefined {
  const fix = entries.find((entry) => entry.name === `${VERIFY_PREFIX}${checkName}${FIX_SUFFIX}`)
  const base = entries.find((entry) => entry.name === `${VERIFY_PREFIX}${checkName}`)
  return mode === 'fix' ? (fix ?? base) : base
}
