import { type Command, InvalidArgumentError } from 'commander'

import { runComments } from '../checks/comments.ts'
import { runComplexity } from '../checks/complexity.ts'
import { runForbiddenStrings } from '../checks/forbidden-strings.ts'
import { runGithubActions } from '../checks/github-actions.ts'
import { runHardcodedColors } from '../checks/hardcoded-colors.ts'
import { CHECKS } from '../checks/registry.ts'

function finish(ok: boolean): void {
  process.exitCode = ok ? 0 : 1
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

export function parseMaxWarnings(raw: string): number {
  const value = Number(raw.trim())
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value)) {
    throw new InvalidArgumentError('--max-warnings must be a non-negative integer.')
  }
  return value
}

/** Register a directly-invocable subcommand for every built-in check (`verifyx complexity`, `verifyx knip`, …). */
export function registerChecks(program: Command): void {
  program
    .command('complexity')
    .description('Maintainability-index gate')
    .argument('[pattern]', 'glob, directory, or file to analyse')
    .option('--threshold <n>', 'fail files whose minimum MI is below this', Number)
    .option('--ignore <glob>', 'ignore glob (repeatable)', collect, [])
    .action((pattern: string | undefined, opts: { threshold?: number; ignore: string[] }) => {
      finish(runComplexity({ pattern, threshold: opts.threshold, ignore: opts.ignore }).ok)
    })

  program
    .command('comments')
    .description('Flag long comment blocks (JSDoc / context: exempt); --block-new-comments also fails comments on changed lines')
    .argument('[pattern]', 'glob, directory, or file to scan')
    .option('--max-lines <n>', 'maximum comment-block length', Number)
    .option('--pushback', 'add AI back-pressure framing to the failure message')
    .option('--warn', 'report without failing the run')
    .option('--block-new-comments', 'also fail on any comment on a line changed against HEAD')
    .option('--ignore <glob>', 'ignore glob (repeatable)', collect, [])
    .action(
      (
        pattern: string | undefined,
        opts: { maxLines?: number; pushback?: boolean; warn?: boolean; blockNewComments?: boolean; ignore: string[] },
      ) => {
        finish(
          runComments({
            pattern,
            maxLines: opts.maxLines,
            pushback: opts.pushback,
            warn: opts.warn,
            blockNewComments: opts.blockNewComments,
            ignore: opts.ignore,
          }).ok,
        )
      },
    )

  program
    .command('hardcoded-colors')
    .description('Fail on literal hex / 0x colour values in source')
    .option('--root <dir>', 'directory to scan')
    .option('--ignore <glob>', 'ignore glob (repeatable)', collect, [])
    .action((opts: { root?: string; ignore: string[] }) => {
      finish(runHardcodedColors({ root: opts.root, ignore: opts.ignore }).ok)
    })

  program
    .command('forbidden-strings')
    .description('Fail on disallowed JSON config values (rules from verify config)')
    .action(() => {
      finish(runForbiddenStrings().ok)
    })

  program
    .command('github-actions')
    .description('Schema-validate GitHub Actions workflows and composite/action metadata')
    .action(() => {
      finish(runGithubActions().ok)
    })

  // Mode flows via the VERIFY_MODE env / CI, not per-subcommand flags (which collide with the root's --check).
  for (const check of CHECKS.filter((c) => c.kind === 'external')) {
    const command = program
      .command(check.name)
      .description(check.description)
      // Everything after `--` is forwarded verbatim to the underlying tool (e.g. `verifyx unused-code -- --production`).
      .argument('[toolArgs...]', 'extra arguments passed through to the underlying tool (after `--`)')
    if (check.supportsMaxWarnings) {
      command.option('--max-warnings <n>', 'tolerate up to n findings before failing (counts findings)', parseMaxWarnings)
    }
    command.action(async (toolArgs: string[], opts: { maxWarnings?: number }) => {
      const result = await check.runDefault({ extraArgs: toolArgs, maxWarnings: opts.maxWarnings })
      finish(result.ok)
    })
  }
}
