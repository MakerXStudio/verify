import { color } from '../shared/color.ts'
import { loadVerifyConfig, type VerifyConfig, VerifyConfigError } from '../shared/config.ts'
import type { CheckResult } from './types.ts'

export function configFailure(name: string, error: unknown): CheckResult {
  if (!(error instanceof VerifyConfigError)) throw error
  console.error(color.red(`${name}: invalid verify config`))
  console.error(error.message)
  return { name, ok: false }
}

export function withVerifyConfig(name: string, run: (config: VerifyConfig) => CheckResult): CheckResult {
  let config: VerifyConfig
  try {
    config = loadVerifyConfig()
  } catch (error) {
    return configFailure(name, error)
  }
  return run(config)
}
