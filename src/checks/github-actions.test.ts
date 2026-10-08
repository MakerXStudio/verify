import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runGithubActions } from './github-actions.ts'

let dir: string
let errorOutput: string[]

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-github-actions-'))
  errorOutput = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errorOutput.push(args.join(' '))
  })
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function write(file: string, lines: string[]): void {
  const full = path.join(dir, file)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, `${lines.join('\n')}\n`)
}

const output = () => stripVTControlCharacters(errorOutput.join('\n'))

const VALID_WORKFLOW = [
  'name: CI',
  'on:',
  '  push:',
  '    branches: [main]',
  '  workflow_dispatch:',
  '    inputs:',
  '      dry-run:',
  '        type: boolean',
  '        default: false',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 10',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - run: npm test',
  '        timeout-minutes: ${{ inputs.dry-run && 1 || 5 }}',
  '  reuse:',
  '    uses: ./.github/workflows/other.yml',
  '    secrets: inherit',
]

const compositeAction = (step: string[]) => [
  'name: Setup',
  'description: Install dependencies',
  'runs:',
  '  using: composite',
  '  steps:',
  '    - run: npm ci',
  '      shell: bash',
  ...step,
]

describe('runGithubActions', () => {
  it('skips when there are no workflow or action files', () => {
    expect(runGithubActions({ cwd: dir })).toEqual({ name: 'github-actions', ok: true, skipped: true })
  })

  it('passes valid workflows and composite actions', () => {
    write('.github/workflows/ci.yml', VALID_WORKFLOW)
    write('.github/actions/setup/action.yml', compositeAction([]))
    write('action.yaml', ['name: Root', 'description: d', 'runs:', '  using: node24', '  main: index.js'])
    expect(runGithubActions({ cwd: dir })).toEqual({ name: 'github-actions', ok: true })
  })

  it("passes this repo's own workflows", () => {
    expect(runGithubActions({ cwd: path.resolve(import.meta.dirname, '../..') }).ok).toBe(true)
  })

  it('fails on timeout-minutes in a composite action step, naming the file, line and key', () => {
    write('.github/actions/setup/action.yml', compositeAction(['    - run: npm test', '      shell: bash', '      timeout-minutes: 5']))
    expect(runGithubActions({ cwd: dir }).ok).toBe(false)
    expect(output()).toContain('.github/actions/setup/action.yml:10:7 runs.steps[1]: unexpected key "timeout-minutes"')
    expect(output()).toContain('Total: 1 problem(s)')
  })

  it('reports errors from the alternative the workflow most likely meant', () => {
    write('.github/workflows/ci.yaml', [
      'on: [push, pul_request]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    bogus: true',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '        run: echo both',
    ])
    expect(runGithubActions({ cwd: dir }).ok).toBe(false)
    expect(output()).toContain('.github/workflows/ci.yaml:1:12 on[1]: must be equal to one of the allowed values')
    expect(output()).toContain('.github/workflows/ci.yaml:5:5 jobs.build: unexpected key "bogus"')
    expect(output()).toContain('.github/workflows/ci.yaml:7:9 jobs.build.steps[0]: only one of "uses", "run" is allowed')
    expect(output()).toContain('Total: 3 problem(s)')
  })

  it('picks the input type the author declared', () => {
    write('.github/workflows/dispatch.yml', [
      'on:',
      '  workflow_dispatch:',
      '    inputs:',
      '      prerelease:',
      "        default: 'false'",
      '        type: boolean',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo',
    ])
    expect(runGithubActions({ cwd: dir }).ok).toBe(false)
    expect(output()).toContain('dispatch.yml:5:18 on.workflow_dispatch.inputs.prerelease.default: must be boolean')
    expect(output()).toContain('Total: 1 problem(s)')
  })

  it('lists every alternative when none fits', () => {
    write('.github/workflows/ci.yml', [
      'on: push',
      'jobs:',
      '  a:',
      '    runs-on: x',
      '    steps:',
      '      - run: echo',
      '        timeout-minutes: soon',
    ])
    expect(runGithubActions({ cwd: dir }).ok).toBe(false)
    expect(output()).toContain('ci.yml:7:26 jobs.a.steps[0].timeout-minutes: must be number, or must match pattern')
  })

  it('reports YAML syntax errors with their position', () => {
    write('.github/workflows/broken.yml', ['on: push', 'jobs: [', 'x'])
    expect(runGithubActions({ cwd: dir }).ok).toBe(false)
    expect(output()).toMatch(/\.github\/workflows\/broken\.yml:\d+:\d+ /)
  })
})

describe('runGithubActions path filters', () => {
  const workflowWithFilters = (filters: string[]) => [
    'on:',
    ...filters,
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo',
  ]

  beforeEach(() => {
    write('src/app/index.ts', ['export {}'])
    write('src/app/index.test.ts', ['export {}'])
    write('docs/guide.md', ['# Guide'])
    spawnSync('git', ['init', '-q'], { cwd: dir })
  })

  it('passes globs that match repository files', () => {
    write(
      '.github/workflows/ci.yml',
      workflowWithFilters([
        '  push:',
        "    paths: ['src/**', '**.md', 'src/*/index.ts', 'docs/guid?e.md', 'src/[a-z]pp/*']",
        '  pull_request:',
        "    paths-ignore: ['docs/**', '!docs/guide.md']",
      ]),
    )
    expect(runGithubActions({ cwd: dir }).ok).toBe(true)
  })

  it('lets **/ match zero directories', () => {
    write('package.json', ['{}'])
    write('src/index.ts', ['export {}'])
    write(
      '.github/workflows/ci.yml',
      workflowWithFilters(['  push:', "    paths: ['**/package.json', 'src/**/index.ts', 'src/**/app/*.ts']"]),
    )
    expect(runGithubActions({ cwd: dir }).ok).toBe(true)
  })

  it('fails a glob that matches nothing, naming the workflow and glob', () => {
    write('.github/workflows/ci.yml', workflowWithFilters(['  push:', '    paths:', "      - 'src/**'", "      - 'scr/**'"]))
    expect(runGithubActions({ cwd: dir }).ok).toBe(false)
    expect(output()).toContain('.github/workflows/ci.yml:5:9 on.push.paths[1]: path filter "scr/**" matches no file in the repository')
    expect(output()).toContain('Total: 1 problem(s)')
  })

  it('treats a single * as not crossing directories', () => {
    write('.github/workflows/ci.yml', workflowWithFilters(['  pull_request_target:', "    paths-ignore: ['src/*.ts']"]))
    expect(runGithubActions({ cwd: dir }).ok).toBe(false)
    expect(output()).toContain('on.pull_request_target.paths-ignore[0]: path filter "src/*.ts"')
  })

  it('fails a negated glob that excludes nothing the earlier globs matched', () => {
    write('.github/workflows/ci.yml', workflowWithFilters(['  push:', "    paths: ['src/**', '!src/**.test.ts', '!docs/**']"]))
    expect(runGithubActions({ cwd: dir }).ok).toBe(false)
    expect(output()).toContain('on.push.paths[2]: path filter "!docs/**"')
    expect(output()).toContain('Total: 1 problem(s)')
  })

  it('ignores filters on other events', () => {
    write('.github/workflows/ci.yml', workflowWithFilters(['  push:', "    branches: ['nope/**']", '  workflow_dispatch:']))
    expect(runGithubActions({ cwd: dir }).ok).toBe(true)
  })
})
