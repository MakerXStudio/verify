import fs from 'node:fs'
import path from 'node:path'

export type PackageManager = 'npm' | 'pnpm'

type ScriptCommand = { command: string; env?: Record<string, string> }

export type PackageManagerCommands = {
  runScript: (script: string) => ScriptCommand
  /** `declineBuilds` lists packages whose build scripts must not run; npm ignores it. */
  addDevDependencies: (deps: readonly string[], declineBuilds?: readonly string[]) => string[]
  /** Doc string: run the verify gate. */
  runGate: string
  /** Doc string: run the verifyx CLI. */
  runCli: string
  /** Strings whose presence in an agent file means it already points to verify. */
  pointerMarkers: readonly string[]
}

export const PACKAGE_MANAGER_COMMANDS: Record<PackageManager, PackageManagerCommands> = {
  npm: {
    runScript: (script) => ({ command: `npm run ${script}` }),
    addDevDependencies: (deps) => ['npm', 'install', '--save-dev', ...deps],
    runGate: 'npm run verify',
    runCli: 'npx verifyx',
    pointerMarkers: ['npm run verify'],
  },
  pnpm: {
    // Children of a parallel run must not check (and maybe install) dependencies; the outer `pnpm verify` already did.
    runScript: (script) => ({ command: `pnpm run ${script}`, env: { pnpm_config_verify_deps_before_run: 'false' } }),
    addDevDependencies: (deps, declineBuilds = []) => [
      'pnpm',
      'add',
      '-D',
      '--ignore-workspace-root-check',
      ...declineBuilds.map((pkg) => `--allow-build=!${pkg}`),
      ...deps,
    ],
    runGate: 'pnpm verify',
    runCli: 'pnpm exec verifyx',
    pointerMarkers: ['pnpm verify', 'pnpm run verify'],
  },
}

type Signal = PackageManager | 'unsupported' | undefined

const PNPM_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml']
const NPM_FILES = ['package-lock.json', 'npm-shrinkwrap.json']

const cache = new Map<string, PackageManager>()

function managerFromName(name: unknown): Signal {
  if (typeof name !== 'string' || name === '') return undefined
  return name === 'npm' || name === 'pnpm' ? name : 'unsupported'
}

function packageManagerName(value: string): string {
  const at = value.lastIndexOf('@')
  return at > 0 ? value.slice(0, at) : value
}

function readPackageJson(dir: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function fieldSignal(dir: string): Signal {
  const pkg = readPackageJson(dir)
  if (!pkg) return undefined

  const devEngines = pkg.devEngines
  if (devEngines && typeof devEngines === 'object') {
    const entry = (devEngines as { packageManager?: unknown }).packageManager
    const first: unknown = Array.isArray(entry) ? entry[0] : entry
    if (first && typeof first === 'object') {
      const signal = managerFromName((first as { name?: unknown }).name)
      if (signal) return signal
    }
  }

  const packageManager = pkg.packageManager
  if (typeof packageManager === 'string') return managerFromName(packageManagerName(packageManager))
  return undefined
}

function lockfileSignal(dir: string): Signal {
  const has = (files: string[]) => files.some((file) => fs.existsSync(path.join(dir, file)))
  if (has(PNPM_FILES)) return 'pnpm'
  if (has(NPM_FILES)) return 'npm'
  return undefined
}

/**
 * The first directory at or above `startDir` with a signal decides, defaulting to npm. Memoised per resolved start
 * directory for the process lifetime.
 */
export function detectPackageManager(startDir: string): PackageManager {
  const start = path.resolve(startDir)
  const cached = cache.get(start)
  if (cached) return cached

  let result: PackageManager = 'npm'
  let dir = start
  for (;;) {
    const signal = fieldSignal(dir) ?? lockfileSignal(dir)
    if (signal) {
      result = signal === 'unsupported' ? 'npm' : signal
      break
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  cache.set(start, result)
  return result
}
