import { CHECKS } from '../checks/registry.ts'
import { color, paintRed } from '../shared/color.ts'
import { resolveMode } from '../shared/mode.ts'
import { installConsoleCapture, runCaptured } from '../shared/output.ts'
import { type MeasureRecord, printMeasureTable } from './measure.ts'
import { reportOutcomes } from './report.ts'
import { entryCheckName, resolveEntries, resolveOverride, runEntryCommand, selectEntries, type VerifyEntry } from './resolveEntries.ts'
import { resolveTestEntry, TEST_CHECK_NAME } from './tests.ts'

export type RunAllOptions = { measure?: boolean; verbose?: boolean; tests?: boolean }

type Task = { name: string; note?: string; run: () => Promise<boolean> }

/** Build the ordered task list: every built-in (running its override script if defined), then customs, then tests. */
function buildTasks(opts: RunAllOptions): Task[] {
  const entries = resolveEntries()
  const mode = resolveMode()
  const spawn = (entry: VerifyEntry, note: string): Task => ({
    name: entry.name,
    note,
    run: async () => (await runEntryCommand(entry)) === 0,
  })

  const tasks: Task[] = CHECKS.map((check) => {
    const override = resolveOverride(entries, check.name, mode)
    if (!override) return { name: check.name, run: async () => (await check.runDefault()).ok }
    return {
      name: check.name,
      note: 'overridden',
      run: async () => {
        const ok = (await runEntryCommand(override)) === 0
        if (!ok) console.error(color.dim(`↳ ${check.name}: ran \`${override.command}\` (override)`))
        return ok
      },
    }
  })

  const builtinNames = new Set(CHECKS.map((c) => c.name))
  for (const entry of selectEntries(entries, mode)) {
    const check = entryCheckName(entry.name)
    if (builtinNames.has(check) || check === TEST_CHECK_NAME) continue
    tasks.push(spawn(entry, 'custom'))
  }

  const testEntry = resolveTestEntry({ noTests: opts.tests === false })
  if (testEntry) tasks.push(spawn(testEntry, 'tests'))
  return tasks
}

/**
 * Run every built-in check (the explicit `verifyx all` opt-in) plus any custom `verify:*` scripts and the
 * tests step, all in parallel. Each check's output is captured independently so a clean run is silent and
 * failures print without interleaving. `--verbose` prints every check's output; `--measure` prints its table.
 */
export async function runAll(opts: RunAllOptions = {}): Promise<number> {
  const loud = !!opts.verbose
  const tasks = buildTasks(opts)

  if (loud) {
    console.log(`Running ${tasks.length} verification(s) in parallel:`)
    for (const task of tasks) console.log(`  - ${task.name}${task.note ? color.dim(` (${task.note})`) : ''}`)
    console.log()
  }

  const startTime = Date.now()
  const restore = installConsoleCapture()
  let runs: Array<{ name: string; ok: boolean; output: string; durationMs: number }>
  try {
    runs = await Promise.all(
      tasks.map(async (task) => {
        const taskStart = Date.now()
        const { result, output } = await runCaptured(async () => {
          try {
            return await task.run()
          } catch (error) {
            console.error(String(error))
            return false
          }
        })
        return { name: task.name, ok: result, output, durationMs: Date.now() - taskStart }
      }),
    )
  } finally {
    restore()
  }

  // Print each check's captured output: everything under --verbose, only failures otherwise.
  for (const run of runs) {
    if (!loud && run.ok) continue
    if (loud) console.log(color.heading(`▶ ${run.name}`))
    if (run.output) process.stdout.write(run.output)
  }

  // Under --verbose every check is printed, so a single failure gets buried mid-list; re-print the
  // failing checks' output at the end in red so the step that actually failed stands out.
  if (loud) {
    for (const run of runs.filter((r) => !r.ok)) {
      console.log(color.red(color.heading(`\n▶ ${run.name} (failed)`)))
      if (run.output) process.stdout.write(paintRed(run.output))
    }
  }

  if (opts.measure) {
    const records: MeasureRecord[] = runs.map((r) => ({ script: r.name, code: r.ok ? 0 : 1, durationMs: r.durationMs }))
    printMeasureTable(records, Date.now() - startTime)
  }
  return reportOutcomes(
    runs.map((r) => ({ name: r.name, ok: r.ok })),
    'verification',
    loud,
  )
}
