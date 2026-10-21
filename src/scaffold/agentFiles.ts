import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PACKAGE_MANAGER_COMMANDS, type PackageManager } from '../shared/packageManager.ts'
import { ensurePointer, type ManagedFileResult, writeManaged } from './writeManaged.ts'

export type AgentTarget = 'claude' | 'agents'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
// src/scaffold/*.ts and dist/scaffold/*.mjs both sit two levels below the package root, where templates/ lives.
const TEMPLATES_DIR = path.join(moduleDir, '..', '..', 'templates')

const PLACEHOLDER = /\{\{(\w+)\}\}/g

function renderTemplate(relativePath: string, values: Readonly<Record<string, string>>): string {
  const template = fs.readFileSync(path.join(TEMPLATES_DIR, ...relativePath.split('/')), 'utf-8')
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = values[name]
    if (value === undefined) throw new Error(`Unknown placeholder ${placeholder} in template ${relativePath}`)
    return value
  })
}

/**
 * Emit the `verify` integration for the chosen targets under `cwd`:
 * - the same `SKILL.md` goes to Claude (`.claude/skills/verify/`) and the cross-vendor tree
 *   (`.agent-skills/verify/`), so the integration is identical across agents;
 * - a one-line pointer is appended to the matching instruction file (`CLAUDE.md` / `AGENTS.md`).
 *
 * Skills are CLI-owned (created/updated as a whole). The instruction files are user-owned, so the pointer is
 * only appended when no pointer marker is present and existing content is never rewritten.
 */
export function writeAgentFiles(cwd: string, targets: readonly AgentTarget[], packageManager: PackageManager): ManagedFileResult[] {
  const results: ManagedFileResult[] = []
  const { runGate, runCli, pointerMarkers } = PACKAGE_MANAGER_COMMANDS[packageManager]
  const skill = renderTemplate('skills/verify/SKILL.md', { runGate, runCli })
  const guidance = renderTemplate('verify-guidance.md', { runGate, runCli })

  if (targets.includes('claude')) {
    writeManaged(path.join(cwd, '.claude', 'skills', 'verify', 'SKILL.md'), skill, results)
    ensurePointer(path.join(cwd, 'CLAUDE.md'), guidance, pointerMarkers, results)
  }
  if (targets.includes('agents')) {
    writeManaged(path.join(cwd, '.agent-skills', 'verify', 'SKILL.md'), skill, results)
    ensurePointer(path.join(cwd, 'AGENTS.md'), guidance, pointerMarkers, results)
  }

  results.sort((a, b) => a.path.localeCompare(b.path))
  return results
}
