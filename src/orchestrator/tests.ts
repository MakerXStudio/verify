import { loadPackageScripts, scriptEntry, type VerifyEntry } from './resolveEntries.ts'

/** The `verify:*` check name the tests step owns, so it isn't also run in the normal batch. */
export const TEST_CHECK_NAME = 'test'

export type TestsOptions = { noTests?: boolean }

/**
 * Which package.json script the automatic tests step runs. Locally it prefers an explicit `verify:test`, falling back
 * to the standard `test` script. On CI it runs only `test:ci` (CI usually needs a different invocation, e.g.
 * emitting junit.xml), so a plain `test` never runs there. Returns null when no applicable script exists.
 */
export function resolveTestScript(scripts: Record<string, string>, ci: boolean): string | null {
  const order = ci ? ['test:ci'] : ['verify:test', 'test']
  return order.find((name) => name in scripts) ?? null
}

/**
 * Resolve the automatic tests step to a runnable entry, so it flows through the same buffered/timed path as
 * every other check. Returns null when `--no-tests` is set or no applicable test script exists.
 */
export function resolveTestEntry(opts: TestsOptions = {}): VerifyEntry | null {
  if (opts.noTests) return null
  const loaded = loadPackageScripts()
  if (!loaded) return null
  const script = resolveTestScript(loaded.scripts, !!process.env.CI)
  if (!script) return null
  return scriptEntry(script, loaded.dir)
}
