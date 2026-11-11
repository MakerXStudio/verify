import fs from 'node:fs'
import path from 'node:path'

import { findConfigProblems } from './configSchema.ts'

/** A rule for the forbidden-strings check: JSON values at `paths` in `file` must not match `disallowed`. */
export type ForbiddenStringsRule = {
  file: string
  paths: string[]
  disallowed: string
}

export type VerifyConfig = {
  complexity?: { threshold?: number; pattern?: string; ignore?: string[] }
  comments?: {
    maxLines?: number
    pattern?: string
    ignore?: string[]
    pushback?: boolean
    warn?: boolean
    blockNewComments?: boolean
  }
  unusedCode?: { maxWarnings?: number }
  duplicateCode?: { maxWarnings?: number; paths?: string[]; ignore?: string[] }
  circularDeps?: { extensions?: string[]; ignore?: string[]; ignoreTypeImports?: boolean }
  hardcodedColors?: { ignore?: string[]; root?: string }
  forbiddenStrings?: ForbiddenStringsRule[]
}

const CONFIG_FILE = 'verify.config.json'

export class VerifyConfigError extends Error {
  constructor(file: string, problems: readonly string[]) {
    super(problems.map((problem) => `${file}: ${problem}`).join('\n'))
    this.name = 'VerifyConfigError'
  }
}

function readJsonIfExists(cwd: string, file: string): unknown {
  const full = path.join(cwd, file)
  if (!fs.existsSync(full)) return undefined
  try {
    return JSON.parse(fs.readFileSync(full, 'utf-8'))
  } catch (error) {
    throw new VerifyConfigError(file, [`not valid JSON (${(error as Error).message})`])
  }
}

function validated(config: unknown, file: string, prefix?: string): VerifyConfig {
  const problems = findConfigProblems(config, prefix)
  if (problems.length > 0) throw new VerifyConfigError(file, problems)
  return config as VerifyConfig
}

/**
 * Load per-repo check configuration from `verify.config.json`, falling back to a `verify` key in package.json.
 * Throws a `VerifyConfigError` naming the file and key when the config is not valid JSON, has an unknown key, or
 * has a setting of the wrong type.
 */
export function loadVerifyConfig(cwd: string = process.cwd()): VerifyConfig {
  const fromFile = readJsonIfExists(cwd, CONFIG_FILE)
  if (fromFile !== undefined) return validated(fromFile, CONFIG_FILE)

  const pkg = readJsonIfExists(cwd, 'package.json')
  if (pkg && typeof pkg === 'object' && 'verify' in pkg) return validated((pkg as { verify?: unknown }).verify, 'package.json', 'verify.')
  return {}
}

/** A repeatable CLI list flag that was not given arrives as an empty array, so empty falls through to the config list. */
export function resolveList(cli: readonly string[] | undefined, config: readonly string[] | undefined): readonly string[] {
  return cli?.length ? cli : (config ?? [])
}
