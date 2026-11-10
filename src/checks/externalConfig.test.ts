import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => ({ runArgvCommand: vi.fn(), captureArgvCommand: vi.fn() }))

vi.mock('../shared/spawn.ts', async (importOriginal) => ({ ...(await importOriginal<object>()), ...spawned }))

import { circularDepsCommand, duplicateCodeCommand } from './externalConfig.ts'
import { getCheck } from './registry.ts'

const SKOTT = ['skott', '--displayMode=raw', '--showCircularDependencies', '--exitCodeOnCircularDependencies=1']
const JSCPD_HEAD = ['jscpd', '--format', 'typescript,tsx', '--exit-code', '1']
const JSCPD_REPORTER = ['-r', 'consoleFull']
const JSCPD_DEFAULT = [...JSCPD_HEAD, '--ignore', '**/*.test.*', ...JSCPD_REPORTER, 'src']

let dir: string
let originalCwd: string

beforeEach(() => {
  originalCwd = process.cwd()
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-external-config-')))
  process.chdir(dir)
  fs.mkdirSync(path.join('node_modules', '.bin'), { recursive: true })
  for (const bin of ['knip', 'skott', 'jscpd']) {
    for (const ext of ['', '.cmd']) fs.writeFileSync(path.join('node_modules', '.bin', bin + ext), '')
  }
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  spawned.runArgvCommand.mockResolvedValue(0)
})
afterEach(() => {
  process.chdir(originalCwd)
  fs.rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
  spawned.runArgvCommand.mockReset()
  spawned.captureArgvCommand.mockReset()
})

function writeConfig(config: unknown): void {
  fs.writeFileSync('verify.config.json', JSON.stringify(config))
}

function ranArgv(): string[] {
  expect(spawned.runArgvCommand).toHaveBeenCalledTimes(1)
  return spawned.runArgvCommand.mock.calls[0]?.[0] as string[]
}

function mockJscpdClones(count: number): void {
  spawned.captureArgvCommand.mockImplementation(async (argv: readonly string[]) => {
    const outputDir = argv[argv.indexOf('--output') + 1] as string
    const duplicates = Array.from({ length: count }, (_, i) => ({
      firstFile: { name: `a${i}.ts`, start: 1, end: 5 },
      secondFile: { name: `b${i}.ts`, start: 1, end: 5 },
    }))
    fs.writeFileSync(path.join(outputDir, 'jscpd-report.json'), JSON.stringify({ duplicates }))
    return { code: count > 0 ? 1 : 0, stdout: '', stderr: '' }
  })
}

function countedArgv(): string[] {
  expect(spawned.captureArgvCommand).toHaveBeenCalledTimes(1)
  return spawned.captureArgvCommand.mock.calls[0]?.[0] as string[]
}

describe('circularDepsCommand', () => {
  it('is the plain skott command with no config', () => {
    expect(circularDepsCommand(undefined)).toEqual(SKOTT)
    expect(circularDepsCommand({})).toEqual(SKOTT)
  })

  it('joins extensions into one --fileExtensions flag', () => {
    expect(circularDepsCommand({ extensions: ['.ts', '.tsx'] })).toEqual([...SKOTT, '--fileExtensions=.ts,.tsx'])
  })

  it('passes each ignore glob as its own --ignorePattern flag', () => {
    expect(circularDepsCommand({ ignore: ['**/*.test.*', 'features/logging/offline-provider.ts'] })).toEqual([
      ...SKOTT,
      '--ignorePattern=**/*.test.*',
      '--ignorePattern=features/logging/offline-provider.ts',
    ])
  })

  it('turns ignoreTypeImports into --no-trackTypeOnlyDependencies, and adds nothing when false', () => {
    expect(circularDepsCommand({ ignoreTypeImports: true })).toEqual([...SKOTT, '--no-trackTypeOnlyDependencies'])
    expect(circularDepsCommand({ ignoreTypeImports: false })).toEqual(SKOTT)
  })

  it('adds no flag for empty lists', () => {
    expect(circularDepsCommand({ extensions: [], ignore: [] })).toEqual(SKOTT)
  })
})

describe('duplicateCodeCommand', () => {
  it('scans src and ignores test files with no config', () => {
    expect(duplicateCodeCommand(undefined)).toEqual(JSCPD_DEFAULT)
    expect(duplicateCodeCommand({ maxWarnings: 3 })).toEqual(JSCPD_DEFAULT)
  })

  it('replaces the default src with the config paths', () => {
    expect(duplicateCodeCommand({ paths: ['app', 'features', 'scripts'] })).toEqual([
      ...JSCPD_HEAD,
      '--ignore',
      '**/*.test.*',
      ...JSCPD_REPORTER,
      'app',
      'features',
      'scripts',
    ])
  })

  it('replaces the default ignore with the config globs, one --ignore each', () => {
    expect(duplicateCodeCommand({ ignore: ['**/*.spec.*', '**/generated/**'] })).toEqual([
      ...JSCPD_HEAD,
      '--ignore',
      '**/*.spec.*',
      '--ignore',
      '**/generated/**',
      ...JSCPD_REPORTER,
      'src',
    ])
  })

  it('ignores nothing when the config ignore list is empty', () => {
    expect(duplicateCodeCommand({ ignore: [] })).toEqual([...JSCPD_HEAD, ...JSCPD_REPORTER, 'src'])
  })

  it('keeps the default src when the config paths list is empty', () => {
    expect(duplicateCodeCommand({ paths: [] })).toEqual(JSCPD_DEFAULT)
  })
})

describe('external checks read the verify config through runDefault, the path `verifyx all` uses', () => {
  it('runs the built-in commands unchanged with no config', async () => {
    await getCheck('circular-deps')?.runDefault()
    expect(ranArgv()).toEqual(SKOTT)
    spawned.runArgvCommand.mockClear()

    await getCheck('duplicate-code')?.runDefault()
    expect(ranArgv()).toEqual(JSCPD_DEFAULT)
    spawned.runArgvCommand.mockClear()

    await getCheck('unused-code')?.runDefault()
    expect(ranArgv()).toEqual(['knip', '--no-progress', '--treat-config-hints-as-errors'])
  })

  it('builds the skott command from circularDeps and still appends passthrough args', async () => {
    writeConfig({ circularDeps: { extensions: ['.ts', '.tsx'], ignore: ['**/*.test.*'], ignoreTypeImports: true } })
    await getCheck('circular-deps')?.runDefault({ extraArgs: ['src/index.ts'] })
    expect(ranArgv()).toEqual([
      ...SKOTT,
      '--fileExtensions=.ts,.tsx',
      '--ignorePattern=**/*.test.*',
      '--no-trackTypeOnlyDependencies',
      'src/index.ts',
    ])
  })

  it('builds the jscpd command from duplicateCode paths and ignore', async () => {
    writeConfig({ duplicateCode: { paths: ['app', 'features'], ignore: ['**/generated/**'] } })
    await getCheck('duplicate-code')?.runDefault()
    expect(ranArgv()).toEqual([...JSCPD_HEAD, '--ignore', '**/generated/**', ...JSCPD_REPORTER, 'app', 'features'])
  })

  it('reads the same settings from a verify key in package.json', async () => {
    fs.writeFileSync('package.json', JSON.stringify({ verify: { circularDeps: { ignoreTypeImports: true } } }))
    await getCheck('circular-deps')?.runDefault()
    expect(ranArgv()).toEqual([...SKOTT, '--no-trackTypeOnlyDependencies'])
  })

  it('passes unusedCode.maxWarnings to knip as --max-issues (flag strategy)', async () => {
    writeConfig({ unusedCode: { maxWarnings: 226 } })
    await getCheck('unused-code')?.runDefault({ extraArgs: ['--production'] })
    expect(ranArgv()).toEqual(['knip', '--no-progress', '--treat-config-hints-as-errors', '--production', '--max-issues', '226'])
  })

  it('lets a command-line max-warnings win over unusedCode.maxWarnings', async () => {
    writeConfig({ unusedCode: { maxWarnings: 226 } })
    await getCheck('unused-code')?.runDefault({ maxWarnings: 0 })
    expect(ranArgv().slice(-2)).toEqual(['--max-issues', '0'])
  })

  it('tolerates duplicateCode.maxWarnings findings by counting (count strategy)', async () => {
    writeConfig({ duplicateCode: { maxWarnings: 2, paths: ['app'] } })
    mockJscpdClones(2)
    expect((await getCheck('duplicate-code')?.runDefault())?.ok).toBe(true)
    expect(countedArgv().slice(0, 10)).toEqual([...JSCPD_HEAD, '--ignore', '**/*.test.*', ...JSCPD_REPORTER, 'app'])
    expect(spawned.runArgvCommand).not.toHaveBeenCalled()
  })

  it('fails when findings exceed duplicateCode.maxWarnings', async () => {
    writeConfig({ duplicateCode: { maxWarnings: 2 } })
    mockJscpdClones(3)
    expect((await getCheck('duplicate-code')?.runDefault())?.ok).toBe(false)
  })

  it('lets a command-line max-warnings win over duplicateCode.maxWarnings', async () => {
    writeConfig({ duplicateCode: { maxWarnings: 2 } })
    mockJscpdClones(3)
    expect((await getCheck('duplicate-code')?.runDefault({ maxWarnings: 3 }))?.ok).toBe(true)
    expect((await getCheck('duplicate-code')?.runDefault({ maxWarnings: 1 }))?.ok).toBe(false)
  })
})
