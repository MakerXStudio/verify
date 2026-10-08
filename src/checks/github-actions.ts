import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { color } from '../shared/color.ts'
import { parseYaml, type YamlPosition } from '../shared/yamlLocation.ts'
import { describeError, readablePath, type SchemaKind, validateAgainstSchema } from './githubActionsSchema.ts'
import { findDeadPathFilters } from './githubPathFilter.ts'
import type { CheckResult } from './types.ts'

const NAME = 'github-actions'

const YAML_EXT = '.{yml,yaml}'
const WORKFLOW_GLOB = path.posix.join('.github', 'workflows', `*${YAML_EXT}`)
const ACTION_GLOBS = [path.posix.join('.github', 'actions', '**', `action${YAML_EXT}`), `action${YAML_EXT}`]

type Finding = { file: string; position?: YamlPosition; where?: string; message: string; schemaPath?: string }

function discover(cwd: string): Array<{ file: string; kind: SchemaKind }> {
  const glob = (pattern: string | string[]) => fs.globSync(pattern, { cwd }).map((file) => file.replaceAll('\\', '/'))
  return [
    ...glob(WORKFLOW_GLOB).map((file) => ({ file, kind: 'workflow' as const })),
    ...glob(ACTION_GLOBS).map((file) => ({ file, kind: 'action' as const })),
  ].sort((a, b) => a.file.localeCompare(b.file))
}

function listRepoFiles(cwd: string): string[] | undefined {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) return undefined
  return result.stdout.split('\0').filter(Boolean)
}

function validateFile(cwd: string, file: string, kind: SchemaKind, repoFiles: () => string[] | undefined): Finding[] {
  const parsed = parseYaml(fs.readFileSync(path.join(cwd, file), 'utf-8'))
  if (parsed.errors.length > 0) return parsed.errors.map(({ message, position }) => ({ file, position, message }))

  const schemaFindings = validateAgainstSchema(kind, parsed.data ?? null).map((error) => {
    const unexpectedKey = error.keyword === 'additionalProperties' ? String(error.params.additionalProperty) : undefined
    return {
      file,
      position: parsed.locateNearest(error.instancePath, unexpectedKey),
      where: readablePath(error.instancePath),
      message: describeError(error),
      schemaPath: error.schemaPath,
    }
  })
  const files = kind === 'workflow' ? repoFiles() : undefined
  if (!files) return schemaFindings
  const filterFindings = findDeadPathFilters(parsed.data, files).map(({ instancePath, glob }) => ({
    file,
    position: parsed.locateNearest(instancePath),
    where: readablePath(instancePath),
    message: `path filter "${glob}" matches no file in the repository`,
  }))
  return [...schemaFindings, ...filterFindings]
}

function formatFinding({ file, position, where, message, schemaPath }: Finding): string {
  const location = position ? `${file}:${position.line}:${position.col}` : file
  const detail = where ? `${where}: ${message}` : message
  return `  ${location} ${detail}${schemaPath ? color.dim(` (${schemaPath})`) : ''}`
}

export type GithubActionsOptions = { cwd?: string }

export function runGithubActions(opts: GithubActionsOptions = {}): CheckResult {
  const cwd = opts.cwd ?? process.cwd()
  const files = discover(cwd)
  if (files.length === 0) {
    console.log(color.dim(`${NAME}: no workflow or action files — skipping`))
    return { name: NAME, ok: true, skipped: true }
  }

  let repoFiles: string[] | undefined | null = null
  const getRepoFiles = () => (repoFiles === null ? (repoFiles = listRepoFiles(cwd)) : repoFiles)
  const findings = files.flatMap(({ file, kind }) => validateFile(cwd, file, kind, getRepoFiles))
  if (findings.length === 0) {
    console.log(color.green(`${files.length} GitHub Actions file(s) valid.`))
    return { name: NAME, ok: true }
  }

  console.error(color.red('Invalid GitHub Actions files:\n'))
  for (const finding of findings) console.error(formatFinding(finding))
  console.error(color.red(`\nTotal: ${findings.length} problem(s)`))
  return { name: NAME, ok: false }
}
