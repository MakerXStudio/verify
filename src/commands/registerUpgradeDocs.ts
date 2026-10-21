import type { Command } from 'commander'

import { type AgentTarget, writeAgentFiles } from '../scaffold/agentFiles.ts'
import { ACTION_MARK, summarise } from '../scaffold/writeManaged.ts'
import { detectPackageManager } from '../shared/packageManager.ts'

/** `verifyx upgrade-docs` — refresh the verify skill and append the pointer to CLAUDE.md / AGENTS.md. */
export function registerUpgradeDocs(program: Command): void {
  program
    .command('upgrade-docs')
    .description('Create/refresh the verify skill and the pointer in CLAUDE.md / AGENTS.md')
    .option('--no-claude', 'skip .claude/skills and CLAUDE.md')
    .option('--no-agents', 'skip .agent-skills and AGENTS.md')
    .action((opts: { claude?: boolean; agents?: boolean }) => {
      const targets: AgentTarget[] = []
      if (opts.claude !== false) targets.push('claude')
      if (opts.agents !== false) targets.push('agents')

      const cwd = process.cwd()
      const results = writeAgentFiles(cwd, targets, detectPackageManager(cwd))
      for (const result of results) {
        if (result.action === 'unchanged') continue
        console.log(`  ${ACTION_MARK[result.action]} ${result.path} (${result.action})`)
      }
      const summary = summarise(results)
      console.log(`\n${summary.created} created, ${summary.appended} appended, ${summary.updated} updated, ${summary.unchanged} unchanged.`)
    })
}
