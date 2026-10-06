import fs from 'node:fs'
import path from 'node:path'

import { color } from '../shared/color.ts'
import { resolveMode } from '../shared/mode.ts'
import { emit } from '../shared/output.ts'
import { appendArgv, formatArgv, formatShellCommand, runArgvCommand } from '../shared/spawn.ts'
import { type MaxWarningsSupport, withinBudget } from './maxWarnings.ts'
import type { Check, CheckMode, CheckResult, RunDefaultOptions } from './types.ts'

// Mirror the launcher's resolution (cross-spawn → which + PATHEXT) so "installed" and "runnable" agree.
const BIN_EXTENSIONS = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : ['']

/** True when a project-local binary is installed under node_modules/.bin (cross-platform). */
function hasLocalBin(bin: string, cwd: string = process.cwd()): boolean {
  const dir = path.join(cwd, 'node_modules', '.bin')
  return BIN_EXTENSIONS.some((ext) => fs.existsSync(path.join(dir, bin + ext)))
}

/**
 * Put the project's node_modules/.bin on PATH so tools resolve however `verify` was invoked
 * (npm script, npx, or directly) — npm only augments PATH when it runs a script itself.
 */
function envWithLocalBin(cwd: string = process.cwd()): Record<string, string> {
  const binDir = path.join(cwd, 'node_modules', '.bin')
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  return { [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}` }
}

export type ExternalCheckSpec = {
  name: string
  description: string
  /** The node_modules/.bin executable that must be present for the check to run. */
  bin: string
  /** Command run in check mode (report + fail, never rewrite). */
  checkCommand: readonly string[]
  /** Command run in fix mode. When omitted, the check is not fixable and always runs `checkCommand`. */
  fixCommand?: readonly string[]
  devDeps: string[]
  recommended?: boolean
  /** Docs / config reference for the underlying tool, surfaced when the check fails. */
  docs?: string
  /** Extra guidance printed on failure, e.g. how to recognise and suppress the tool's known false positives. */
  failureAdvice?: string
  /** Extra guard beyond bin presence (e.g. require a tsconfig). */
  canRun?: () => boolean
  /** Returns a failure message to fail the check without running the tool (e.g. it would write into the source tree). */
  preflight?: () => string | undefined
  /** Rewrite the tool's captured output before it is printed, e.g. to strip a tool's own hardcoded colouring. */
  transformOutput?: (output: string) => string
  maxWarnings?: MaxWarningsSupport
}

/** Pick the command for the run mode: the fix command only in fix mode and only when the check is fixable. */
export function selectCommand(spec: Pick<ExternalCheckSpec, 'checkCommand' | 'fixCommand'>, mode: CheckMode): readonly string[] {
  return mode === 'fix' && spec.fixCommand ? spec.fixCommand : spec.checkCommand
}

/**
 * The line printed when an external check fails: names the tool (checks are named for their function, so the
 * tool is otherwise hidden), the exact argv that ran, and where to configure it — so an agent can set up
 * the tool's config file (e.g. knip.json) without guessing.
 */
export function externalFailureHint(
  spec: Pick<ExternalCheckSpec, 'name' | 'bin' | 'docs' | 'failureAdvice'>,
  argv: readonly string[],
): string {
  const hint = `↳ ${spec.name} uses ${spec.bin}: ran argv \`${formatArgv(argv)}\`. Configure ${spec.bin}${spec.docs ? ` — ${spec.docs}` : ''}.`
  return spec.failureAdvice ? `${hint}\n↳ ${spec.failureAdvice}` : hint
}

type CountBudget = Extract<MaxWarningsSupport, { strategy: 'count' }>
type CountableSpec = Pick<ExternalCheckSpec, 'name' | 'bin' | 'checkCommand' | 'docs' | 'failureAdvice' | 'transformOutput'>

export async function runCountedBudget(
  spec: CountableSpec,
  budget: CountBudget,
  maxWarnings: number,
  extraArgs: string[],
  env: Record<string, string>,
): Promise<CheckResult> {
  const argv = appendArgv(spec.checkCommand, extraArgs)
  let counted: { count: number; report: string }
  try {
    counted = await budget.count({ argv, env })
  } catch (error) {
    const docs = spec.docs ? ` — ${spec.docs}` : ''
    console.error(
      color.dim(
        `↳ ${spec.name}: could not count ${spec.bin} findings for --max-warnings (${String(error)}). Configure ${spec.bin}${docs}.`,
      ),
    )
    return { name: spec.name, ok: false }
  }
  const { count, report } = counted
  if (withinBudget(count, maxWarnings)) return { name: spec.name, ok: true }

  const unit = count === 1 ? budget.unit : `${budget.unit}s`
  console.error(color.dim(`↳ ${spec.name}: ${count} ${unit} found, exceeds --max-warnings ${maxWarnings}.`))
  if (report) emit(spec.transformOutput ? spec.transformOutput(report) : report)
  console.error(color.dim(externalFailureHint(spec, argv)))
  return { name: spec.name, ok: false }
}

/** Build a Check that spawns an external tool, skipping gracefully when the tool cannot run. */
export function defineExternalCheck(spec: ExternalCheckSpec): Check {
  return {
    name: spec.name,
    description: spec.description,
    kind: 'external',
    recommended: spec.recommended ?? false,
    supportsMaxWarnings: !!spec.maxWarnings,
    // Scaffold as a call into this CLI so fix-vs-check lives in one place, not the consumer's script.
    scaffold: {
      script: `verifyx ${spec.name}`,
      devDeps: spec.devDeps,
    },
    // `verifyx eject <name>` inlines these raw commands into the consumer's verify:* scripts. Lazy so
    // formatShellCommand's unserializable-arg throw fires on eject only, not when CHECKS is built at import.
    get eject() {
      return {
        check: formatShellCommand(spec.checkCommand),
        fix: spec.fixCommand ? formatShellCommand(spec.fixCommand) : undefined,
      }
    },
    async runDefault({ extraArgs = [], maxWarnings }: RunDefaultOptions = {}): Promise<CheckResult> {
      if (!hasLocalBin(spec.bin)) {
        console.log(color.dim(`${spec.name}: ${spec.bin} not installed — skipping (add it with \`npx verifyx init\`)`))
        return { name: spec.name, ok: true, skipped: true }
      }
      if (spec.canRun && !spec.canRun()) {
        console.log(color.dim(`${spec.name}: not applicable here — skipping`))
        return { name: spec.name, ok: true, skipped: true }
      }
      const blocked = spec.preflight?.()
      if (blocked) {
        console.error(blocked)
        return { name: spec.name, ok: false }
      }
      // quiet: buffer the tool's output and flush only on failure (streamed live under --verbose).
      const runReport = async (argv: string[]): Promise<CheckResult> => {
        const code = await runArgvCommand(argv, { env: envWithLocalBin(), quiet: true, transform: spec.transformOutput })
        if (code !== 0) console.error(color.dim(externalFailureHint(spec, argv)))
        return { name: spec.name, ok: code === 0 }
      }
      if (maxWarnings !== undefined && spec.maxWarnings) {
        const budget = spec.maxWarnings
        if (budget.strategy === 'count') return runCountedBudget(spec, budget, maxWarnings, extraArgs, envWithLocalBin())
        return runReport(appendArgv(selectCommand(spec, resolveMode()), [...extraArgs, ...budget.toArgs(maxWarnings)]))
      }
      return runReport(appendArgv(selectCommand(spec, resolveMode()), extraArgs))
    },
  }
}
