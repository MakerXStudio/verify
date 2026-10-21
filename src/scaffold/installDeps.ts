import fs from 'node:fs'
import path from 'node:path'

import { parse } from 'yaml'

import { detectPackageManager, PACKAGE_MANAGER_COMMANDS, type PackageManager } from '../shared/packageManager.ts'
import { runArgvCommand } from '../shared/spawn.ts'

export type Runner = (argv: readonly string[], opts: { cwd: string }) => Promise<number>

export type InstallReport = {
  /** Already declared in package.json or present in node_modules — left untouched (no version bump). */
  skipped: string[]
  /** Newly installed successfully. */
  installed: string[]
  /** Attempted but the install exited non-zero (e.g. a peer-dependency conflict); surfaced for the user to resolve. */
  failed: string[]
}

export type InstallOptions = {
  /** Defaults to the manager detected from `cwd`. */
  packageManager?: PackageManager
  /** Packages whose build scripts pnpm should record as declined (npm ignores them). */
  declineBuilds?: readonly string[]
  run?: Runner
}

type Outcome = Pick<InstallReport, 'installed' | 'failed'>

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

type PackageJson = Partial<Record<(typeof DEP_FIELDS)[number], Record<string, string>>>

function declaredDeps(cwd: string): Set<string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')) as PackageJson
    return new Set(DEP_FIELDS.flatMap((field) => Object.keys(pkg[field] ?? {})))
  } catch {
    return new Set()
  }
}

/**
 * True when the dep is already available — declared in package.json (any dependency field) or resolvable
 * under node_modules. Either way we skip it so `init` never re-installs and bumps an existing version.
 */
function isInstalled(name: string, cwd: string, declared: Set<string>): boolean {
  return declared.has(name) || fs.existsSync(path.join(cwd, 'node_modules', name, 'package.json'))
}

function nearestAllowBuilds(cwd: string): Record<string, unknown> {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'pnpm-workspace.yaml')
    if (fs.existsSync(file)) {
      try {
        const allowBuilds: unknown = (parse(fs.readFileSync(file, 'utf-8')) as { allowBuilds?: unknown } | null)?.allowBuilds
        return allowBuilds && typeof allowBuilds === 'object' && !Array.isArray(allowBuilds) ? (allowBuilds as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    }
    if (path.dirname(dir) === dir) return {}
  }
}

/** True when `key` is `pkg@<version>` (a scoped name's own leading `@` is part of `pkg`). */
function isVersionKeyFor(key: string, pkg: string): boolean {
  return key.startsWith(`${pkg}@`) && key.length > pkg.length + 1
}

/**
 * A version-keyed `true` in `allowBuilds` counts as decided, since the decline flag would revoke it; a version-keyed
 * `false` does not, as it covers one version. A non-boolean value is not a decision. pnpm 11+ ignores
 * `onlyBuiltDependencies` and `ignoredBuiltDependencies`.
 */
function undecidedBuilds(packages: readonly string[], cwd: string): string[] {
  const entries = Object.entries(nearestAllowBuilds(cwd))
  return packages.filter(
    (pkg) => !entries.some(([key, value]) => (key === pkg && typeof value === 'boolean') || (value === true && isVersionKeyFor(key, pkg))),
  )
}

/** npm: one batch, then per-package installs on failure (the batch is atomic) so one bad package can't block the rest. */
async function installWithNpm(toInstall: string[], cwd: string, run: Runner): Promise<Outcome> {
  const { addDevDependencies } = PACKAGE_MANAGER_COMMANDS.npm
  if ((await run(addDevDependencies(toInstall), { cwd })) === 0) return { installed: toInstall, failed: [] }

  const installed: string[] = []
  const failed: string[] = []
  for (const dep of toInstall) {
    ;((await run(addDevDependencies([dep]), { cwd })) === 0 ? installed : failed).push(dep)
  }
  return { installed, failed }
}

/**
 * pnpm: one batch only. A failed batch has usually written every dep already (e.g. it stopped on an unapproved build),
 * and every later `pnpm add` fails the same way, so a per-package retry would only repeat the failure.
 */
async function installWithPnpm(toInstall: string[], cwd: string, declineBuilds: readonly string[], run: Runner): Promise<Outcome> {
  const argv = PACKAGE_MANAGER_COMMANDS.pnpm.addDevDependencies(toInstall, undecidedBuilds(declineBuilds, cwd))
  return (await run(argv, { cwd })) === 0 ? { installed: toInstall, failed: [] } : { installed: [], failed: toInstall }
}

/** Install the devDeps not already present. Failures are reported instead of aborting `init`. */
export async function installDevDeps(devDeps: readonly string[], cwd: string, options: InstallOptions = {}): Promise<InstallReport> {
  const { packageManager = detectPackageManager(cwd), declineBuilds = [], run = runArgvCommand } = options
  const declared = declaredDeps(cwd)
  const skipped: string[] = []
  const toInstall: string[] = []
  for (const dep of devDeps) (isInstalled(dep, cwd, declared) ? skipped : toInstall).push(dep)

  if (toInstall.length === 0) return { skipped, installed: [], failed: [] }

  const outcome =
    packageManager === 'pnpm' ? await installWithPnpm(toInstall, cwd, declineBuilds, run) : await installWithNpm(toInstall, cwd, run)
  return { skipped, ...outcome }
}
