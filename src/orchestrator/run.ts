import { configureMode, resolveMode } from '../shared/mode.ts'
import { setVerbose } from '../shared/spawn.ts'
import { type MeasureRecord, printMeasureTable } from './measure.ts'
import { chatty, reportOutcomes } from './report.ts'
import { entryCheckName, resolveEntries, runEntryCommand, selectEntries, type VerifyEntry } from './resolveEntries.ts'
import { resolveTestEntry, TEST_CHECK_NAME } from './tests.ts'

export type OrchestrateOptions = {
  measure?: boolean
  verbose?: boolean
  check?: boolean
  fix?: boolean
  /** When false, skip the automatic tests step (`--no-tests`). */
  tests?: boolean
}

async function runEntry(entry: VerifyEntry): Promise<MeasureRecord> {
  const startTime = Date.now()
  const code = await runEntryCommand(entry)
  return { script: entry.name, code, durationMs: Date.now() - startTime }
}

/**
 * The default `verifyx` action. Convention: run the project's own `verify:*` scripts in parallel (output
 * buffered, flushed only on failure). A clean run is silent — use `--verbose` or `--measure` for detail.
 * With no `verify:*` scripts, nothing runs — use `verifyx all` to run every built-in check.
 */
export async function orchestrate(opts: OrchestrateOptions = {}): Promise<number> {
  setVerbose(!!opts.verbose)
  // Propagate an explicit --check/--fix via VERIFY_MODE so it reaches spawned verify:* scripts too.
  configureMode(opts)

  // Collapse verify:<name>/:fix pairs per mode; the tests step owns the `test` check, so it's dropped and re-added below.
  const gate = selectEntries(resolveEntries(), resolveMode()).filter((entry) => entryCheckName(entry.name) !== TEST_CHECK_NAME)
  const testEntry = resolveTestEntry({ noTests: opts.tests === false })
  const entries = testEntry ? [...gate, testEntry] : gate

  if (entries.length === 0) {
    console.log('No verify:* scripts defined — nothing to run. Add verify:* scripts, or run `verifyx all` to run every built-in check.')
    return 0
  }

  const loud = chatty()
  if (loud) {
    console.log(`Running ${entries.length} verify script(s) in parallel:`)
    for (const entry of entries) console.log(`  - ${entry.name}`)
  }

  const startTime = Date.now()
  const records = await Promise.all(entries.map(runEntry))
  if (opts.measure) printMeasureTable(records, Date.now() - startTime)
  return reportOutcomes(
    records.map((r) => ({ name: r.script, ok: r.code === 0 })),
    'verify script',
    loud,
  )
}
