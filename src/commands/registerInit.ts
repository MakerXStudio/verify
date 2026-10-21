import type { Command } from 'commander'
import enquirer from 'enquirer'

import { CHECKS, recommendedChecks } from '../checks/registry.ts'
import type { AgentTarget } from '../scaffold/agentFiles.ts'
import { applyInit, type InitResult } from '../scaffold/init.ts'
import { type InstallReport, installDevDeps } from '../scaffold/installDeps.ts'
import { checkPnpmVersion } from '../scaffold/pnpmVersion.ts'
import { ACTION_MARK } from '../scaffold/writeManaged.ts'
import { color } from '../shared/color.ts'
import { detectPackageManager, PACKAGE_MANAGER_COMMANDS, type PackageManager } from '../shared/packageManager.ts'
import { captureArgvCommand } from '../shared/spawn.ts'

export type Choice = { name: string; message: string; enabled?: boolean }

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/**
 * enquirer's multiselect ignores each choice's `enabled` for the submitted result — it only renders a marker, so a
 * user who just hits enter gets []. The enabled names must be passed as `initial` to actually pre-select them.
 */
export function preSelected(choices: readonly Choice[]): string[] {
  return choices.filter((c) => c.enabled).map((c) => c.name)
}

async function ask<T>(type: 'select' | 'multiselect', message: string, choices: Choice[]): Promise<T> {
  const initial = type === 'multiselect' ? preSelected(choices) : undefined
  const response = (await enquirer.prompt({ type, name: 'selected', message, choices, initial })) as { selected: T }
  return response.selected
}

type InitCliOptions = {
  defaultsOnly?: boolean
  yes?: boolean
  select: string[]
  claude?: boolean
  agents?: boolean
}

type Selections = { checks: string[]; targets: AgentTarget[]; defaultsOnly: boolean }

async function resolveSelections(opts: InitCliOptions): Promise<Selections> {
  const nonInteractive = !!opts.yes || !process.stdin.isTTY
  if (nonInteractive) {
    const targets: AgentTarget[] = []
    if (opts.claude !== false) targets.push('claude')
    if (opts.agents) targets.push('agents')
    return {
      checks: opts.select.length > 0 ? opts.select : recommendedChecks().map((c) => c.name),
      targets,
      defaultsOnly: !!opts.defaultsOnly,
    }
  }

  // context: an up-front choice — run everything with defaults (verifyx all, no verify:* scripts), or hand-pick checks.
  const mode = await ask<string>('select', 'How should verify run?', [
    { name: 'defaults', message: 'Run all built-in checks (verifyx all) with default options', enabled: true },
    { name: 'pick', message: 'Pick specific checks to wire up as verify:* scripts' },
  ])
  const defaultsOnly = mode === 'defaults'

  // Defaults-only still passes every check so applyInit installs all their devDeps; hand-picking narrows the list.
  const checks = defaultsOnly
    ? CHECKS.map((c) => c.name)
    : await ask<string[]>(
        'multiselect',
        'Select checks to wire up',
        CHECKS.map((c) => ({ name: c.name, message: `${c.name} — ${c.description}`, enabled: c.recommended })),
      )
  const targets = await ask<AgentTarget[]>('multiselect', 'Select agent targets', [
    { name: 'claude', message: 'Claude (.claude/skills + CLAUDE.md)', enabled: true },
    { name: 'agents', message: 'Other agents (.agent-skills + AGENTS.md)', enabled: false },
  ])
  return { checks, targets, defaultsOnly }
}

function report(result: InitResult, defaultsOnly: boolean): void {
  if (defaultsOnly) {
    console.log(color.dim('\nDefaults-only: no verify:* scripts written — the `verify` script runs `verifyx all` (every built-in).'))
  }
  console.log(color.green(`\nScripts added: ${result.addedScripts.join(', ') || '(none new)'}`))
  for (const file of result.agentFiles) {
    if (file.action === 'unchanged') continue
    console.log(`  ${ACTION_MARK[file.action]} ${file.path} (${file.action})`)
  }
}

/** How to finish a failed install by hand. pnpm already prints the cause, so for pnpm this only points to that output. */
function manualInstallAdvice(manager: PackageManager, failed: readonly string[]): string {
  if (manager === 'pnpm') return " (see pnpm's output above)"
  return (
    `\n  init finished; the rest is wired up. Resolve these yourself — e.g. a peer-dependency conflict may need` +
    `\n  a compatible version or --legacy-peer-deps. Install manually with:` +
    `\n    ${PACKAGE_MANAGER_COMMANDS.npm.addDevDependencies(failed).join(' ')}`
  )
}

/** Summarise the dependency install: what was skipped, installed, and — last, so it's the takeaway — what failed. */
function reportInstall(install: InstallReport, manager: PackageManager): void {
  if (install.skipped.length > 0) {
    console.log(color.dim(`\nSkipped ${install.skipped.length} already-installed devDependenc(ies): ${install.skipped.join(', ')}`))
  }
  if (install.installed.length > 0) {
    console.log(color.green(`Installed ${install.installed.length} devDependenc(ies): ${install.installed.join(', ')}`))
  }
  if (install.failed.length > 0) {
    console.error(
      color.yellow(
        `\n⚠ Failed to install ${install.failed.length} devDependenc(ies): ${install.failed.join(', ')}${manualInstallAdvice(manager, install.failed)}`,
      ),
    )
  }
}

async function pnpmBlocker(cwd: string): Promise<string | undefined> {
  const check = checkPnpmVersion(await captureArgvCommand(['pnpm', '--version'], { cwd }))
  return check.ok ? undefined : check.message
}

/** `verifyx init` — interactively scaffold checks + agent files into the current project. */
export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Scaffold verifications and agent commands into this project')
    .option('--defaults-only', 'do not write verify:* scripts; rely on `verifyx` built-in defaults')
    .option('--yes', 'non-interactive: use flag selections (or defaults) without prompting')
    .option('--select <name>', 'preselect a check by name (repeatable, non-interactive)', collect, [])
    .option('--no-claude', 'do not write .claude/ files (non-interactive)')
    .option('--agents', 'also write .agent-skills/ files (non-interactive)')
    .action(async (opts: InitCliOptions) => {
      const cwd = process.cwd()
      const manager = detectPackageManager(cwd)
      const blocker = manager === 'pnpm' ? await pnpmBlocker(cwd) : undefined
      if (blocker) {
        console.error(color.yellow(blocker))
        process.exitCode = 1
        return
      }
      const { checks, targets, defaultsOnly } = await resolveSelections(opts)

      const result = applyInit({ cwd, checks, targets, defaultsOnly, packageManager: manager })
      report(result, defaultsOnly)

      let install: InstallReport | undefined
      if (result.devDeps.length > 0) {
        console.log(color.dim(`\nResolving ${result.devDeps.length} devDependenc(ies): ${result.devDeps.join(', ')}`))
        install = await installDevDeps(result.devDeps, cwd, { packageManager: manager, declineBuilds: result.declineBuilds })
        reportInstall(install, manager)
      }

      const { runGate, runCli } = PACKAGE_MANAGER_COMMANDS[manager]
      console.log(color.dim(`\nRun \`${runGate}\` (or \`${runCli}\`) to run your verifications.`))
      // pnpm only: a failed add usually leaves every later `pnpm install` failing too.
      if (manager === 'pnpm' && (install?.failed.length ?? 0) > 0) process.exitCode = 1
    })
}
