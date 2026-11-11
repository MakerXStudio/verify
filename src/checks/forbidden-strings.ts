import fs from 'node:fs'

import { minimatch } from 'minimatch'

import { color } from '../shared/color.ts'
import type { ForbiddenStringsRule } from '../shared/config.ts'
import { withVerifyConfig } from './configFailure.ts'
import type { CheckResult } from './types.ts'

type ForbiddenStringViolation = { file: string; path: string; value: string }

// Ported from https://github.com/staff0rd/assist verify/forbiddenStrings/findForbiddenStrings.ts
function resolveStringsAtPath(data: unknown, path: string): string[] {
  let current: unknown = data
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return []
    current = (current as Record<string, unknown>)[segment]
  }
  if (typeof current === 'string') return [current]
  if (Array.isArray(current)) return current.filter((value): value is string => typeof value === 'string')
  return []
}

function findRuleViolations(data: unknown, rule: ForbiddenStringsRule): ForbiddenStringViolation[] {
  const violations: ForbiddenStringViolation[] = []
  for (const path of rule.paths) {
    for (const value of resolveStringsAtPath(data, path)) {
      if (minimatch(value, rule.disallowed)) violations.push({ file: rule.file, path, value })
    }
  }
  return violations
}

function findForbiddenStrings(rules: readonly ForbiddenStringsRule[], readJson: (file: string) => unknown): ForbiddenStringViolation[] {
  return rules.flatMap((rule) => findRuleViolations(readJson(rule.file), rule))
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return undefined
  }
}

export type ForbiddenStringsOptions = { rules?: readonly ForbiddenStringsRule[] }

/** Fail when configured JSON values match a `disallowed` glob. Rules come from verify config. */
export function runForbiddenStrings(opts: ForbiddenStringsOptions = {}): CheckResult {
  return withVerifyConfig('forbidden-strings', ({ forbiddenStrings }) => checkForbiddenStrings(opts.rules ?? forbiddenStrings ?? []))
}

function checkForbiddenStrings(rules: readonly ForbiddenStringsRule[]): CheckResult {
  if (rules.length === 0) {
    console.log(color.dim('forbidden-strings: no rules configured — skipping'))
    return { name: 'forbidden-strings', ok: true }
  }

  const violations = findForbiddenStrings(rules, readJsonFile)
  if (violations.length === 0) {
    console.log(color.green('No forbidden strings found.'))
    return { name: 'forbidden-strings', ok: true }
  }

  console.error(color.red('Forbidden strings found:\n'))
  for (const { file, path, value } of violations) console.error(`  ${file} → ${path}: ${value}`)
  console.error(color.red(`\nTotal: ${violations.length} forbidden string(s)`))
  return { name: 'forbidden-strings', ok: false }
}
