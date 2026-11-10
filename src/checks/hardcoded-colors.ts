import fs from 'node:fs'
import path from 'node:path'

import { minimatch } from 'minimatch'

import { color } from '../shared/color.ts'
import type { VerifyConfig } from '../shared/config.ts'
import { withVerifyConfig } from './configFailure.ts'
import type { CheckResult } from './types.ts'

const COLOR_PATTERN = /0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{3,8}/
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.sass', '.less', '.styl', '.vue', '.svelte', '.html']

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') walk(full, out)
    } else if (entry.isFile() && SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full)
    }
  }
}

export type HardcodedColorsOptions = { root?: string; ignore?: readonly string[] }

/** Fail on literal hex / 0x colours in source. Cross-platform (no `grep`); suggests the design-token path. */
export function runHardcodedColors(opts: HardcodedColorsOptions = {}): CheckResult {
  return withVerifyConfig('hardcoded-colors', ({ hardcodedColors }) => checkHardcodedColors(opts, hardcodedColors))
}

function checkHardcodedColors(opts: HardcodedColorsOptions, config: NonNullable<VerifyConfig['hardcodedColors']> = {}): CheckResult {
  const root = opts.root ?? config.root ?? 'src'
  const ignoreGlobs = opts.ignore?.length ? opts.ignore : (config.ignore ?? [])

  const files: string[] = []
  walk(root, files)

  const findings: Array<{ file: string; line: number; value: string }> = []
  for (const file of files) {
    if (ignoreGlobs.some((glob) => minimatch(file, glob))) continue
    const lines = fs.readFileSync(file, 'utf-8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const match = (lines[i] as string).match(COLOR_PATTERN)
      if (match) findings.push({ file, line: i + 1, value: match[0] })
    }
  }

  if (findings.length === 0) {
    console.log(color.green('No hardcoded colors found.'))
    return { name: 'hardcoded-colors', ok: true }
  }

  console.error(color.red('Hardcoded colors found:\n'))
  for (const { file, line, value } of findings) console.error(`  ${file}:${line} → ${value}`)
  console.error(color.red(`\nTotal: ${findings.length} hardcoded color(s)`))
  console.error('\nUse named tokens from your design system / color library instead of literal hex values.')
  return { name: 'hardcoded-colors', ok: false }
}
