import { analyzeComplexity } from '../analyze.ts'
import { printFailure, printFileDetail, printMaintainabilityReport } from '../report.ts'
import { color } from '../shared/color.ts'
import { resolveList, type VerifyConfig } from '../shared/config.ts'
import { withVerifyConfig } from './configFailure.ts'
import type { CheckResult } from './types.ts'

const DEFAULT_THRESHOLD = 50

export type ComplexityOptions = {
  pattern?: string
  ignore?: readonly string[]
  threshold?: number
}

/**
 * Native maintainability-index check. A single matched file prints a per-metric breakdown instead of the gate.
 * Each option resolves as the given value, then `complexity` in the verify config, then the built-in default.
 */
export function runComplexity(opts: ComplexityOptions = {}): CheckResult {
  return withVerifyConfig('complexity', ({ complexity }) => checkComplexity(opts, complexity))
}

function checkComplexity(opts: ComplexityOptions, config: NonNullable<VerifyConfig['complexity']> = {}): CheckResult {
  const threshold = opts.threshold ?? config.threshold ?? DEFAULT_THRESHOLD
  const analysis = analyzeComplexity({
    pattern: opts.pattern ?? config.pattern,
    ignore: resolveList(opts.ignore, config.ignore),
    threshold,
  })

  if (analysis.files.length === 0) {
    console.log(color.yellow('complexity: no files matched — skipping'))
    return { name: 'complexity', ok: true }
  }
  if (analysis.files.length === 1) {
    printFileDetail(analysis.files[0] as string)
    return { name: 'complexity', ok: true }
  }

  printMaintainabilityReport(analysis.results, analysis.failing, threshold)
  const ok = analysis.failing.length === 0
  if (!ok) printFailure(analysis.failing, threshold)
  return { name: 'complexity', ok }
}
