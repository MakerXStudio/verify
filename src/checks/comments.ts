import fs from 'node:fs'

import { minimatch } from 'minimatch'

import { DEFAULT_IGNORE, DEFAULT_PATTERN, findSourceFiles, resolvePattern } from '../analyze.ts'
import { findLongCommentBlocks } from '../comments.ts'
import { printCommentBlockReport } from '../report.ts'
import { color } from '../shared/color.ts'
import { scanFileComments } from '../shared/comment-scan.ts'
import { resolveList, type VerifyConfig } from '../shared/config.ts'
import { parseDiffAddedLines } from '../shared/diff.ts'
import { gitDiffAgainstBase } from '../shared/git.ts'
import { withVerifyConfig } from './configFailure.ts'
import type { CheckResult } from './types.ts'

const DEFAULT_MAX_COMMENT_BLOCK_LINES = 2

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.yml', '.yaml']

// context: machine directives steer tooling, not humans, so a changed line carrying one is never a "comment"
// worth removing; `context:` is this project's durable-context escape hatch and is likewise exempt.
const MACHINE_DIRECTIVES = [
  'oxlint-disable',
  'oxlint-enable',
  '@ts-expect-error',
  '@ts-ignore',
  '@ts-nocheck',
  'eslint-disable',
  'eslint-enable',
  'prettier-ignore',
  'istanbul ignore',
  'v8 ignore',
  'c8 ignore',
  '@vitest-environment',
]

function isCommentExempt(text: string): boolean {
  const lower = text.toLowerCase()
  if (MACHINE_DIRECTIVES.some((d) => lower.includes(d))) return true
  const stripped = text.replace(/^\s*(?:\/\/+|\/\*+|\*|#)\s*/, '')
  return stripped.toLowerCase().startsWith('context:')
}

function shouldScan(file: string, ignoreGlobs: readonly string[]): boolean {
  if (!SCANNED_EXTENSIONS.some((ext) => file.endsWith(ext))) return false
  if (ignoreGlobs.some((glob) => minimatch(file, glob))) return false
  return fs.existsSync(file)
}

function toSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

type NewComment = { file: string; line: number; text: string }

// context: the --block-new-comments behaviour — flag any comment sitting on a changed line (vs HEAD, or the CI base).
function findCommentsOnChangedLines(ignoreGlobs: readonly string[]): NewComment[] {
  const added = parseDiffAddedLines(gitDiffAgainstBase())
  const findings: NewComment[] = []
  for (const [file, lines] of added) {
    if (!shouldScan(file, ignoreGlobs)) continue
    for (const comment of scanFileComments(file)) {
      if (!lines.has(comment.line)) continue
      if (isCommentExempt(comment.text)) continue
      findings.push({ file, line: comment.line, text: toSingleLine(comment.text) })
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return findings
}

function reportCommentsOnChangedLines(findings: readonly NewComment[]): void {
  console.error(color.red('\nComments on changed lines:\n'))
  for (const { file, line, text } of findings) console.error(`  ${file}:${line} → ${text}`)
  console.error(color.red(`\nTotal: ${findings.length} comment(s)`))
  console.error(
    '\nWith --block-new-comments, every comment on a changed line fails this gate, whether you added or edited it. Remove them and let the code document itself.',
  )
}

export type CommentsOptions = {
  pattern?: string
  ignore?: readonly string[]
  maxLines?: number
  pushback?: boolean
  warn?: boolean
  /** Also fail on any comment on a line changed against HEAD (machine directives / context: exempt). */
  blockNewComments?: boolean
}

/**
 * Native check: flag comment blocks longer than `maxLines` (JSDoc and `context:`-prefixed blocks exempt).
 * With `blockNewComments`, additionally fail on any comment on a line changed against HEAD.
 * Each option resolves as the given value, then `comments` in the verify config, then the built-in default.
 */
export function runComments(opts: CommentsOptions = {}): CheckResult {
  return withVerifyConfig('comments', ({ comments }) => checkComments(opts, comments))
}

function checkComments(opts: CommentsOptions, config: NonNullable<VerifyConfig['comments']> = {}): CheckResult {
  const maxLines = opts.maxLines ?? config.maxLines ?? DEFAULT_MAX_COMMENT_BLOCK_LINES
  const pattern = opts.pattern ?? config.pattern ?? DEFAULT_PATTERN
  const ignoreGlobs = resolveList(opts.ignore, config.ignore)
  const pushback = opts.pushback ?? config.pushback ?? false
  const warn = opts.warn ?? config.warn ?? false
  const files = findSourceFiles(resolvePattern(pattern), [...DEFAULT_IGNORE, ...ignoreGlobs])

  const blocks = findLongCommentBlocks(files, maxLines)
  let blocksOk = true
  if (blocks.length === 0) {
    console.log(color.green(`No comment block over ${maxLines} line(s)`))
  } else {
    printCommentBlockReport(blocks, maxLines, { pushback, warn })
    blocksOk = warn
  }

  let changedLinesOk = true
  if (opts.blockNewComments ?? config.blockNewComments) {
    const findings = findCommentsOnChangedLines(ignoreGlobs)
    if (findings.length === 0) {
      console.log(color.green('No comments on changed lines.'))
    } else {
      reportCommentsOnChangedLines(findings)
      changedLinesOk = false
    }
  }

  return { name: 'comments', ok: blocksOk && changedLinesOk }
}
