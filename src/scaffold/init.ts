import path from 'node:path'

import { getCheck } from '../checks/registry.ts'
import type { Check } from '../checks/types.ts'
import { detectPackageManager, type PackageManager } from '../shared/packageManager.ts'
import { type AgentTarget, writeAgentFiles } from './agentFiles.ts'
import { detectSystemBinaries } from './detectSystemBinaries.ts'
import { ensureKnipIgnores } from './knipConfig.ts'
import { addVerifyScripts } from './packageScripts.ts'
import type { ManagedFileResult } from './writeManaged.ts'

export type InitOptions = {
  cwd: string
  /** Selected check names. */
  checks: readonly string[]
  targets: readonly AgentTarget[]
  /** When true, do not write `verify:*` scripts — rely on `verify`'s built-in defaults. */
  defaultsOnly: boolean
  /** The manager the agent docs name. Defaults to the one detected from `cwd`. */
  packageManager?: PackageManager
}

export type InitResult = {
  addedScripts: string[]
  /** devDependencies the selected external checks need (deduped). */
  devDeps: string[]
  /** Packages whose build scripts the selected checks deny on pnpm (deduped). */
  pnpmDenyBuilds: string[]
  agentFiles: ManagedFileResult[]
}

/** Pure scaffolding step: write package.json scripts + agent files, and report the devDeps to install. */
export function applyInit(opts: InitOptions): InitResult {
  const devDeps: string[] = []
  const pnpmDenyBuilds: string[] = []
  const scripts: Record<string, string> = {}

  for (const name of opts.checks) {
    const check = getCheck(name)
    if (!check) continue
    if (check.scaffold.devDeps) devDeps.push(...check.scaffold.devDeps)
    if (check.scaffold.pnpmDenyBuilds) pnpmDenyBuilds.push(...check.scaffold.pnpmDenyBuilds)
    if (!opts.defaultsOnly) scripts[`verify:${name}`] = check.scaffold.script
  }

  // Defaults-only wires the top `verify` script to `verifyx all` so it runs every built-in with no verify:* list.
  const addedScripts = addVerifyScripts(path.join(opts.cwd, 'package.json'), scripts, opts.defaultsOnly ? 'verifyx all' : 'verifyx')

  const agentFiles = writeAgentFiles(opts.cwd, opts.targets, opts.packageManager ?? detectPackageManager(opts.cwd))

  // context: with unused-code selected, teach knip to ignore the other external tools verifyx runs at runtime.
  if (opts.checks.includes('unused-code')) {
    const toolDeps = opts.checks
      .map(getCheck)
      .filter((check): check is Check => !!check && check.kind === 'external' && check.name !== 'unused-code')
      .flatMap((check) => check.scaffold.devDeps ?? [])
      .filter((dep) => dep !== 'typescript')
    ensureKnipIgnores(opts.cwd, [...new Set(toolDeps)], agentFiles, detectSystemBinaries(opts.cwd))
  }

  return { addedScripts, devDeps: [...new Set(devDeps)], pnpmDenyBuilds: [...new Set(pnpmDenyBuilds)], agentFiles }
}
