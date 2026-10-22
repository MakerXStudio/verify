export type CheckKind = 'native' | 'external'

/** Fixable checks auto-fix in `fix` mode and only report (failing on issues) in `check` mode. */
export type CheckMode = 'fix' | 'check'

export type CheckResult = {
  name: string
  ok: boolean
  /** True when the check could not run because its underlying tool is not installed. */
  skipped?: boolean
  durationMs?: number
}

/** Per-run options for a check. `extraArgs` are the tokens a user passes after `--` (external checks only). */
export type RunDefaultOptions = {
  /** Extra arguments appended verbatim to an external check's underlying argv (e.g. `verifyx circular-deps -- src/index.ts`). */
  extraArgs?: string[]
  maxWarnings?: number
}

/** A single verification. Native checks run in-process; external checks spawn a tool. */
export type Check = {
  name: string
  description: string
  kind: CheckKind
  /** Whether `verifyx init` preselects this check as a recommended default. */
  recommended: boolean
  supportsMaxWarnings?: boolean
  /** Run the check with its default options and print its own report. Resolves to the outcome. */
  runDefault: (options?: RunDefaultOptions) => Promise<CheckResult>
  /** How `verify init` wires this check into a consuming project. */
  scaffold: {
    /** The npm script body written as `verify:<name>`. */
    script: string
    /** Extra devDependencies the check needs, installed on opt-in. */
    devDeps?: string[]
    /**
     * Dependencies of `devDeps` that run a build script on install, but that the check works without. For example,
     * skott depends on `@parcel/watcher`, which compiles native code.
     *
     * pnpm 11+ fails an install until each such build script is allowed or denied. So on pnpm, `verifyx init` denies
     * these by adding `'@parcel/watcher': false` under `allowBuilds` in `pnpm-workspace.yaml`. If the project already
     * allows or denies the package, init leaves it alone.
     */
    pnpmDenyBuilds?: string[]
  }
  /**
   * External checks only: the raw tool commands `verifyx eject <name>` inlines into `verify:<name>` (and
   * `verify:<name>:fix`) so a consumer can own the invocation. Absent for native checks (they have no shell command).
   */
  eject?: {
    /** Body for the `verify:<name>` script — the check-mode command. */
    check: string
    /** Body for the `verify:<name>:fix` script, when the tool is fixable. */
    fix?: string
  }
}
