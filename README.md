# @makerx/verify

**One command your AI agent runs after every change, and your CI runs on every push.** `verifyx` bundles a project's checks (lint, format, type-check, complexity, dead code, and more) behind a single command designed to give AI coding agents real back-pressure against shipping hard-to-maintain code, while keeping quality high for everyone.

`verify` ships both:

- a **CLI** (`verifyx`) that orchestrates those checks by convention, for AI agents and CI servers alike, and
- a **verify skill** (`.claude/skills/`, `.agent-skills/`) + a one-line `CLAUDE.md`/`AGENTS.md` pointer that steer AI assistants to run the checks and fix what they report.

What makes it worth wiring in:

- **Auto-fixes locally, fails in CI (same command).** Run it on your machine and it _fixes_ what it can (lint, formatting) instead of just complaining. Run it under CI and the identical command is check-only, so a PR can't merge with problems that should have been fixed.
- **Silent when green, so it's cheap to loop.** A passing run prints nothing and exits `0`, with no output to burn an agent's tokens or bury the one failure that matters. Agents can run it as often as they like.
- **Failure output written for an agent to act on.** When a check fails it names the tool it ran, the exact argv, and a docs link, so the agent (or you) knows what to fix and how instead of guessing.
- **Convention over configuration.** Checks are just `verify:*` npm scripts run in parallel. Add, drop, or override any of them; there's no bespoke config format to learn.

## Install

Install it as a **dev dependency** so the version is pinned in `package.json`, so the exact same tool runs on your machine and in CI/CD:

```sh
npm install --save-dev @makerx/verify
```

Requires Node.js >= 24. Invoke it via an npm script or `npx verifyx`.

The quickest way to wire it into a project:

```sh
npx verifyx init
```

> [!NOTE]
> **Why is the command `verifyx`, not `verify`?**
>
> The package is `@makerx/verify`, but the CLI binary is **`verifyx`**. `verify` is a built-in `cmd.exe`
> command on Windows, and both `npm run` script bodies and `npx` resolve commands through `cmd` there, so a
> bare `verify` runs the Windows builtin ("VERIFY is off."), not this tool. Renaming the binary to `verifyx`
> (a nod to the fact it **fixes** as well as verifies) makes every invocation (`npx verifyx`, npm scripts,
> and a typed `verifyx`) work identically on macOS, Linux, and Windows. Your npm **script** can still be named
> `verify` (that's a script lookup, not command resolution), so `npm run verify` works everywhere.

## How `verifyx` decides what to run

A **`verify:*` script** is any npm script in your `package.json` whose name starts with `verify:` (for example `verify:lint`, `verify:complexity`, `verify:custom`). Each one is a single **check**. `verifyx` runs them all **in parallel**, and together they form your project's verification gate. You decide which checks make up that gate by adding these scripts (`verifyx init` scaffolds a starting set).

A check is either **built-in** or **custom**:

- **Built-in checks** ship with `verifyx` (see [Built-in checks](#built-in-checks) below) and are invoked as subcommands (`verifyx lint`, `verifyx complexity`, and so on). A `verify:*` script wires one in by calling it: `"verify:lint": "verifyx lint"`.
- **Custom checks** are any command of your own, wired as a `verify:*` script that runs whatever you like: `"verify:custom": "node ./scripts/my-check.mjs"`. They aren't `verifyx` subcommands; you run them through the gate, or directly via `npm run verify:custom`.

There are three ways to invoke the CLI, from "all my checks" down to "one specific check":

| Command           | What it runs                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `verifyx`         | Every `verify:*` script: the checks you've curated (built-in and custom). With none defined, nothing runs.               |
| `verifyx all`     | Every built-in check with default options, plus any custom `verify:*` scripts. A `verify:<name>` overrides its built-in. |
| `verifyx <check>` | A single built-in by name, e.g. `verifyx complexity`. `verifyx list` shows them all.                                     |

Both orchestration modes below (`verifyx` and `verifyx all`) run their checks **in parallel** and are **completely silent on success**: no preamble, no per-check output, just exit `0`. Each check's output is buffered and printed **only if it fails**, so a run is cheap to loop or hand to an agent. `--verbose` prints every check's output (not just failures); `--measure` prints only a status/duration table; neither implies the other. (Running a single built-in, `verifyx <check>`, always prints its report, since you asked for that check specifically.)

### `verifyx`: run your curated checks

With no subcommand, `verifyx` runs every `verify:*` script in parallel. Nothing is implicit: the scripts you define **are** the gate. This is the mode a top-level `"verify": "verifyx"` script points at, so `npm run verify` runs your whole gate.

You curate your checks by adding `verify:*` scripts. Prefer calling the built-ins (`verifyx <check>`) so their fix-vs-check behaviour stays centralised; drop to a raw command only for something bespoke:

```jsonc
{
  "scripts": {
    "verify": "verifyx",
    "verify:complexity": "verifyx complexity --threshold 50 \"src/**/*.ts\"",
    "verify:lint": "verifyx lint",
    "verify:custom": "node ./scripts/my-check.mjs",
  },
}
```

### `verifyx all`: run everything

`verifyx all` runs **every** built-in check with its default options, plus any custom `verify:*` scripts you've defined, all in parallel. It's the quick "run everything" without hand-curating a list. Where you've defined a `verify:<name>` script matching a built-in, it **overrides** that built-in, so you can swap a single check's implementation without redefining the rest, e.g. `"verify:lint": "eslint ."` makes `verifyx all` use ESLint for the lint step.

### Fix locally, check in CI

Fixable checks (`lint`, `format`) **auto-fix by default** so the person (or AI agent) running `verifyx` locally doesn't burn effort hand-fixing lint and formatting. When `CI` is set (as CI systems do), the same command is **check-only** and **fails** instead of rewriting, so a PR can't pass with unformatted or unlinted code. Force a mode with `verifyx --fix` or `verifyx --check`.

The same split works for any `verify:<name>` script, whether it overrides a built-in or runs a custom command: pair it with a `verify:<name>:fix` variant, and `verifyx` runs the `:fix` variant locally and the base script in CI (never both). So even a script wrapping a tool that doesn't know about fix-vs-check still fixes locally and only checks in CI:

```jsonc
{
  "scripts": {
    "verify:lint": "eslint .",
    "verify:lint:fix": "eslint . --fix",
  },
}
```

### Tests

`verifyx` runs your test suite as part of a verify run, by convention, so you don't have to wire it in as a check:

- **Locally** it runs your `verify:test` script if you have one, otherwise your standard `test` script. The run is buffered like any other check (silent on success, shown on failure), so it stays cheap in a loop; stream it with `--verbose`.
- **On CI** (`CI` set) it runs only a `test:ci` script, if present. A plain `test` (or `verify:test`) never runs on CI, because CI usually needs a different invocation (emitting `junit.xml`, coverage, and so on). With no `test:ci`, verify runs no tests on CI; run them in a separate step.
- **`--no-tests`** skips the step entirely, handy when CI already runs tests in a dedicated step, or under `verifyx all`.

The test run is just another entry in the gate: it appears in `--measure` and fails the overall run if it fails.

Flags on the bare `verifyx` command:

- `--check` / `--fix`: force check-only or auto-fix (defaults: fix locally, check under CI).
- `--measure`: print a status/duration summary table.
- `--verbose`: stream all output instead of suppressing passing runs.
- `--no-tests`: skip the automatic tests step.

## Built-in checks

| Check               | Kind     | What it catches                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `complexity`        | native   | Maintainability-index gate (cyclomatic complexity + Halstead volume + SLOC). Fails files below a threshold.                                                                                                                                                                                                                                                                                            |
| `comments`          | native   | Flags comment blocks taller than `--max-lines` (default 2), to push for self-documenting code. JSDoc and `context:`-prefixed blocks are always allowed. Add `--block-new-comments` to also fail any comment on a changed line (vs `HEAD` locally, the PR base in CI).                                                                                                                                  |
| `hardcoded-colors`  | native   | Literal hex / `0x` colour values in source (cross-platform; suggests using design tokens).                                                                                                                                                                                                                                                                                                             |
| `forbidden-strings` | native   | Disallowed JSON config values, from rules in your verify config.                                                                                                                                                                                                                                                                                                                                       |
| `github-actions`    | native   | Schema-validates GitHub Actions workflows (`.github/workflows/*.yml`) and action metadata (`.github/actions/**/action.yml`, root `action.yml`) against vendored SchemaStore schemas, e.g. `timeout-minutes` on a composite action step, and fails trigger `paths`/`paths-ignore` globs that match no file. Skips when there are none.                                                                  |
| `lint`              | external | Linting; auto-fixes locally, checks in CI ([oxlint](https://oxc.rs)).                                                                                                                                                                                                                                                                                                                                  |
| `format`            | external | Formatting; writes locally, checks in CI ([oxfmt](https://oxc.rs)).                                                                                                                                                                                                                                                                                                                                    |
| `check-types`       | external | TypeScript type check (`tsc --noEmit`, or `tsc -b` when `tsconfig.json` has `references`); skips when there is no `tsconfig.json`. In build mode it fails up front if any config in the reference graph would write output next to its sources (set `noEmit` or an `outDir`). `tsc -b` still writes `.tsbuildinfo` files; point `tsBuildInfoFile` at `node_modules/.tmp` to keep them out of the tree. |
| `unused-code`       | external | Unused files, exports and dependencies ([knip](https://knip.dev)).                                                                                                                                                                                                                                                                                                                                     |
| `circular-deps`     | external | Circular dependencies ([skott](https://github.com/antoine-coulon/skott)).                                                                                                                                                                                                                                                                                                                              |
| `duplicate-code`    | external | Copy-paste detection ([jscpd](https://github.com/kucherenko/jscpd)).                                                                                                                                                                                                                                                                                                                                   |

External checks spawn their tool and **skip gracefully when it is not installed**; `verifyx init` installs the ones you opt into. They run the tool from your local `node_modules/.bin` regardless of how `verifyx` was invoked. `oxlint`/`oxfmt`/`tsc` are resolved if present; the rest are declared as optional `peerDependencies`.

Because checks are named for their function, **on failure** an external check prints the tool it used, the exact argv it ran, and a docs link, so you (or an agent) can add the tool's config (e.g. `knip.json`) without guessing. On success it prints nothing (output is buffered and flushed only on failure, to keep runs quiet and cheap). If you override a check with your own `verify:<name>` script, a failure shows that `npm run verify:<name>` was what ran.

**Passing extra arguments through.** When you run an external check directly, anything after `--` is forwarded as literal argv entries to the underlying tool, so you can tweak an invocation without ejecting it: `verifyx circular-deps -- src/index.ts` asks skott to start at that file, while `verifyx lint -- --quiet` passes `--quiet` to oxlint. With no entrypoint, skott scans the current project, so `verifyx init` scaffolds the cross-platform default `verifyx circular-deps` without a shell glob.

Each external check is configured through its **tool's own config file**, exactly as you would use that tool standalone:

- `lint`: [`.oxlintrc.json`](https://oxc.rs/docs/guide/usage/linter.html)
- `format`: [oxfmt configuration](https://oxc.rs)
- `check-types`: your [`tsconfig.json`](https://www.typescriptlang.org/tsconfig)
- `unused-code`: [`knip.json`](https://knip.dev/reference/configuration)
- `circular-deps`: [skott options](https://github.com/antoine-coulon/skott)
- `duplicate-code`: [`.jscpd.json` or `package.json#jscpd`](https://github.com/kucherenko/jscpd/tree/master/apps/jscpd#config)

### `--max-warnings`

`unused-code` and `duplicate-code` accept `--max-warnings <n>` and fail when findings exceed `n`.

- `unused-code` passes the value to knip's [`--max-issues`](https://knip.dev/reference/cli#--max-issues). Knip configuration errors still fail.
- `duplicate-code` counts **distinct duplicated regions**, not raw jscpd clones: jscpd reports the same duplication several times (overlapping ranges, and one pattern across N files as N−1 pairs), so clones whose ranges overlap are merged before the count is compared to the budget. The failure output shows both numbers. Do not pass jscpd's `--reporters`, `--output`, or `--silent` options with `--max-warnings`; `verifyx` sets them to produce the count.

```sh
verifyx unused-code --max-warnings 5
verifyx duplicate-code --max-warnings 10
```

### `complexity`

```sh
verifyx complexity --threshold 50 "src/**/*.ts"
```

- `[pattern]`: glob, directory, or file. Defaults to `{src,server,shared}/**/*.ts`.
- `--threshold <n>`: fail when any file's minimum maintainability index is below `n`.
- `--ignore <glob>`: exclude files (repeatable; appended to the default `**/*test.ts*`).

It parses your `.ts`/`.tsx` sources with the TypeScript compiler API and, for every function, computes three metrics: **cyclomatic complexity** (independent paths through the code), **Halstead volume** (a size measure derived from the operators and operands used), and **SLOC** (source lines of code, excluding blanks and comments). It then combines them into a single **maintainability index (MI)**, a 0–100 score where lower means harder to maintain:

```
MI = 171 - 5.2 * ln(HalsteadVolume) - 0.23 * CyclomaticComplexity - 16.2 * ln(SLOC)
```

The result is clamped to 0–100; a function with zero Halstead volume or zero SLOC scores 100. As a rough guide: **> 65** is good, **50–65** is moderate (watch for growth), and **< 50** is hard to maintain. Thresholds are a matter of taste; pick one that fits your codebase and enforce it in CI.

A file's score is the **minimum MI across its functions**. When exactly one file matches, a detailed per-function breakdown (SLOC, cyclomatic complexity, Halstead metrics, and MI) is printed instead of the gate, handy for diagnosing one file at a time. **Fix a failure by splitting the file**, not by gaming the metric (deleting comments, joining lines, shortening names).

### `comments`

```sh
verifyx comments --max-lines 2 --pushback "src/**/*.ts"
```

Capable coding models (Opus 4.8 very much included) love to narrate their work: multi-line comment blocks explaining _what_ the code does rather than _why_. They add little value, drift out of sync as the code changes (and a later reader, human or LLM, may trust the stale comment over the code), and quietly grow the surface area you have to maintain. By default this check pushes back on exactly that, flagging any comment block taller than `--max-lines` (default 2) so the pressure is on the code to document itself.

- `[pattern]`: glob, directory, or file to scan.
- `--max-lines <n>`: fail on comment blocks longer than `n` lines (default 2).
- `--pushback`: reframe the failure message as back-pressure aimed at an AI agent (see below).
- `--warn`: report the long-block violations without failing the run.
- `--block-new-comments`: also fail on any comment on a changed line (vs `HEAD` locally, the PR base in CI; see below).
- `--ignore <glob>`: exclude files (repeatable; the `--block-new-comments` gate also reads `comments.ignore` from your [verify config](#configuration)).

**`--pushback` is the clever bit.** An AI agent that hits a failing check will often take the path of least resistance and just delete or weaken the check to make the run pass. So rather than a dry error, the pushback message tells the agent that the _only_ sanctioned way to keep the comment is to prefix it with `context:`, and that doing so **pages a human to approve it**. Confronted with a real person's time on the line, the agent tends to reconsider and remove the low-value comment instead of gaming the gate. It is a small piece of prompt-engineering baked into a lint failure, and in practice it stops agents silencing the check far more reliably than a plain error does.

If you want to go further and block **new** comments outright, override the `verify:comments` script and add `--block-new-comments`. That turns on a stricter, diff-based gate on top of the long-block check: any comment sitting on a changed line fails, whether you added or merely edited it. Machine directives (`eslint-disable`, `@ts-expect-error`, and friends) stay exempt, as does anything marked `context:`.

The "changed lines" are resolved per environment so the gate works the same locally and in CI. Locally it diffs the working tree against `HEAD` (your uncommitted changes). In CI (`CI` set) a clean checkout has nothing uncommitted, so it diffs against the **merge base with the PR base branch** instead, read from `GITHUB_BASE_REF` (GitHub Actions). Set `VERIFY_DIFF_BASE` to a ref to override the base explicitly; if no base can be resolved it falls back to `HEAD`. For CI, make sure the base branch is fetched (`actions/checkout` with `fetch-depth: 0`), or the merge base won't be found and the gate silently passes.

Two escape hatches keep genuinely useful comments alive. **JSDoc** (`/** … */`) is always allowed, and prefixing a comment's first line with `context:` marks it as durable context the code itself can't express:

```ts
// context: the upstream API returns seconds, not milliseconds, so do not "fix" this
const timeoutMs = timeout * 1000
```

### `hardcoded-colors`

```sh
verifyx hardcoded-colors --root src
```

Fails on literal hex or `0x` colour values in source (`.ts`, `.tsx`, `.css`, `.scss`, `.vue`, `.svelte`, and similar), nudging you toward named design tokens. It is pure JavaScript (no `grep`), so it behaves the same on every OS.

- `--root <dir>`: directory to scan (default `src`).
- `--ignore <glob>`: exclude files (repeatable).

Both default from your [verify config](#configuration) (`hardcodedColors.root` and `hardcodedColors.ignore`), so you can set them once instead of in the script.

### `forbidden-strings`

```sh
verifyx forbidden-strings
```

Fails when a configured JSON value matches a disallowed glob, handy for catching things like a `debug` log level or a staging URL left in a committed config file. It is entirely config-driven (no flags): define rules under `forbiddenStrings` in your [verify config](#configuration). Each rule reads its `file`, looks up every dotted `paths` entry, and fails if the value matches the `disallowed` glob:

```jsonc
{
  "verify": {
    "forbiddenStrings": [{ "file": "app.json", "paths": ["env.LOG_LEVEL"], "disallowed": "debug" }],
  },
}
```

### `github-actions`

```sh
verifyx github-actions
```

Catches workflow and action syntax errors before GitHub does. A key that isn't valid where it's used (such as `timeout-minutes` on a composite action step) stops the runner loading the action, and nothing else flags it until a run fails. It is recommended, so `verifyx init` preselects it and `verifyx all` runs it.

- **Files**: `.github/workflows/*.{yml,yaml}` are validated as workflows; `.github/actions/**/action.{yml,yaml}` and a root `action.{yml,yaml}` as action metadata. With none of these, the check reports skipped.
- **Schemas**: the SchemaStore [`github-workflow`](https://json.schemastore.org/github-workflow.json) and [`github-action`](https://json.schemastore.org/github-action.json) schemas (Apache-2.0), vendored into the package under `schemas/`. Validation is pure JavaScript ([ajv](https://ajv.js.org) and [yaml](https://eemeli.org/yaml/)), cross-platform and makes no network requests.
- **Path filters**: each `paths` / `paths-ignore` glob under `on.push`, `on.pull_request` and `on.pull_request_target` must match at least one file in the repository (`git ls-files`, plus untracked files that aren't ignored), so a typo'd filter fails instead of silently never firing. Globs use GitHub's [filter pattern](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#filter-pattern-cheat-sheet) semantics: `*` doesn't cross `/`, `**` does, `?` and `+` quantify the preceding character, and a bare directory such as `docs` matches no files (use `docs/**`). A `!` negated glob must exclude at least one file the earlier globs matched. Globs containing `${{` are skipped, as is this part of the check outside a git repository.
- **Output**: each problem prints `file:line:col`, the path in the document, the message and the schema rule that failed. Where the schema allows alternatives (a job is either a normal or a reusable-workflow job), the errors come from the alternative the file most likely meant, not from every alternative.

```
.github/actions/setup/action.yml:10:7 runs.steps[1]: unexpected key "timeout-minutes" (#/properties/steps/items/additionalProperties)
```

The schemas follow GitHub's documented syntax, which is sometimes stricter than the runner. For example, a `workflow_dispatch` input must declare its `type`.

## Scaffolding a project

### `verifyx init`

Interactively wire verifications and the agent integration into the current project:

```sh
verifyx init
```

It first asks how `verify` should run: **run all built-in checks** (`verifyx all`, no `verify:*` scripts) or **pick specific checks** to wire up. Then you multi-select **agent targets** (Claude and/or other agents), and, if you chose to pick, the **checks**. After that it:

- writes the selected `verify:*` scripts to `package.json` (never clobbering existing ones),
- installs the external checks' tools as `--save-dev`, **skipping any already declared in `package.json` or present in `node_modules`** (so an existing `typescript`/`oxlint` is never re-installed or version-bumped). If the install hits a conflict (e.g. a peer-dependency clash), it isolates the failing package(s), installs the rest, and reports what to install manually at the end instead of aborting,
- writes the **`verify` skill**: the same `SKILL.md` to `.claude/skills/verify/` (Claude) and `.agent-skills/verify/` (cross-vendor), so the integration is identical everywhere,
- appends a one-line pointer to `CLAUDE.md` / `AGENTS.md` (only if not already present; existing content is never rewritten),
- if `unused-code` is selected, adds the other external tools (`oxlint`/`oxfmt`/`skott`/`jscpd`) to knip's `ignoreDependencies` (verifyx runs them at runtime, so knip can't see them and would otherwise report them as unused), and adds system binaries your scripts invoke (`uv`, `az`, `python`, `terraform`, …) that knip's own global list doesn't cover to `ignoreBinaries`. Merged into `knip.json` or `package.json#knip` (created if neither exists), adding only what's missing; a code-based `knip.ts`/`knip.js` is left for you to edit.

The skill auto-triggers on "verify"/"run checks", so agents run the checks proactively; the pointer reinforces it for tools that read `CLAUDE.md`/`AGENTS.md` as standing instructions.

Options:

- `--defaults-only`: the non-interactive form of the "run all built-in checks" choice. Does **not** write `verify:*` scripts; wires the top-level `verify` script to `verifyx all` so it runs every built-in (still installs opted-in tools and writes the skill + pointer).
- `--yes`: non-interactive; use `--select <name>` (repeatable), `--no-claude`, `--agents`.

### `verifyx upgrade-docs`

Idempotently create/refresh the skill and the `CLAUDE.md`/`AGENTS.md` pointer (created / appended / updated / unchanged; refuses to write through symlinks, never rewrites your instruction files):

```sh
verifyx upgrade-docs              # Claude + other agents
verifyx upgrade-docs --no-agents  # only .claude/ + CLAUDE.md
```

### `verifyx eject`

External checks wrap their tool behind the CLI (`verify:lint` runs `verifyx lint`, which runs `oxlint`) so fix-vs-check behaviour stays centralised. When you outgrow that and want to own the raw invocation, **eject** it: `verifyx eject <check>` replaces the wrapper script in `package.json` with the underlying command.

```sh
verifyx eject circular-deps   # verify:circular-deps → skott --displayMode=raw --showCircularDependencies --exitCodeOnCircularDependencies=1
verifyx eject lint            # verify:lint → oxlint . AND verify:lint:fix → oxlint --fix .
```

For a fixable check (`lint`, `format`) it writes both the base `verify:<name>` (check-mode) and the `verify:<name>:fix` variant, which is exactly the [fix-locally / check-in-CI](#fix-locally-check-in-ci) pairing `verifyx` already understands — so an ejected check keeps auto-fixing locally and only checking in CI. Ejecting **overwrites** the existing `verify:<name>` script (that's the point — it hands you the raw command to edit), and leaves every other script untouched. Only external checks can be ejected; native checks (`complexity`, `comments`, …) run in-process and have no shell command to hand over.

## Configuration

The **native** checks that take persistent settings read them from a `verify.config.json` file, or a `verify` key in `package.json` (the standalone file wins if both are present). Each option is documented alongside its check above; collected here for reference:

```jsonc
{
  "verify": {
    "comments": { "ignore": ["**/*.generated.ts"] },
    "hardcodedColors": { "root": "src", "ignore": ["**/tokens.ts"] },
    "forbiddenStrings": [{ "file": "app.json", "paths": ["env.LOG_LEVEL"], "disallowed": "debug" }],
  },
}
```

**External** checks don't use this file; each is configured through its own tool's config (`.oxlintrc.json`, `tsconfig.json`, `knip.json`, and so on), listed under [Built-in checks](#built-in-checks).

## CI/CD

`verifyx` is built to run the **same command** locally and in CI. The only thing that changes is the `CI` environment variable: when it's set (GitHub Actions, GitLab CI, and most providers export it automatically), `verifyx` switches from **fix** mode to **check** mode. Nothing is rewritten; any lint, formatting, type, complexity, or other issue **fails the job** instead, so a PR can't merge with a problem that should have been fixed locally first.

Because the tool is a pinned dev dependency, CI runs the exact version in your lockfile. A minimal GitHub Actions job:

```yaml
name: verify
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run verify
```

`npm run verify` exits non-zero on the first failing check (failing the job), and its buffered output is flushed so the log shows exactly what failed and how to fix it. To force a mode regardless of environment, use `verifyx --check` or `verifyx --fix`.

## Programmatic API

Every export is available from the package root:

```ts
import { analyzeComplexity, getCheck, runAll } from '@makerx/verify'

// Run the maintainability analysis directly.
const { failing } = analyzeComplexity({ pattern: 'src/**/*.ts', threshold: 50 })

// Run any single check by name, including the ones that spawn an external tool.
const lint = await getCheck('lint')?.runDefault()

const unused = await getCheck('unused-code')?.runDefault({ maxWarnings: 5 })
```

Native checks also expose a direct runner (`runComplexity`, `runComments`, `runHardcodedColors`, `runForbiddenStrings`, `runGithubActions`); external checks (`lint`, `format`, `check-types`, `unused-code`, `circular-deps`, `duplicate-code`) have no standalone function and are run via the registry (`getCheck(name)?.runDefault()`) or the orchestrators.

Entry points:

- **Checks**: `CHECKS`, `getCheck`, `recommendedChecks`, and the native `run*` functions above.
- **Orchestration**: `orchestrate` (the bare `verifyx` runner) and `runAll` (`verifyx all`).
- **Complexity internals**: `analyzeComplexity`, `scoreFiles`, `findSourceFiles`, `resolvePattern`, `forEachFunction`, `findLongCommentBlocks`, and the metric helpers `calculateCyclomaticComplexity`, `calculateHalstead`, `calculateMaintainabilityIndex`, `countSloc`.
- **Scaffolding & config**: `applyInit`, `applyEject` (+ `ejectScripts`), and `loadVerifyConfig`.

## Attribution

The `verify` runner, `comments`, `hardcoded-colors`, and `forbidden-strings` checks are ported from [staff0rd/assist](https://github.com/staff0rd/assist); the maintainability metrics originate there too. See [Steering the Vibe: Verify](https://staffordwilliams.com/blog/2025/12/14/steering-the-vibe-verify/) and [Complexity](https://staffordwilliams.com/blog/2026/02/22/steering-the-vibe-complexity/).

The `github-actions` check validates against JSON schemas from [SchemaStore](https://github.com/SchemaStore/schemastore), vendored in `schemas/` under the Apache License 2.0 (see `schemas/README.md`).

## License

MIT
