import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => ({ runArgvCommand: vi.fn(), captureArgvCommand: vi.fn() }))

vi.mock('../shared/spawn.ts', async (importOriginal) => ({ ...(await importOriginal<object>()), ...spawned }))

import { ejectScripts } from '../scaffold/eject.ts'
import { loadVerifyConfig, VerifyConfigError } from '../shared/config.ts'
import { runComments } from './comments.ts'
import { runComplexity } from './complexity.ts'
import { runForbiddenStrings } from './forbidden-strings.ts'
import { runHardcodedColors } from './hardcoded-colors.ts'
import { CHECKS, getCheck } from './registry.ts'

const CONFIG_READERS = [
  'complexity',
  'comments',
  'hardcoded-colors',
  'forbidden-strings',
  'unused-code',
  'circular-deps',
  'duplicate-code',
] as const
const EXTERNAL_BINS = ['oxlint', 'oxfmt', 'tsc', 'knip', 'skott', 'jscpd']

let dir: string
let originalCwd: string
let spies: ReturnType<typeof vi.spyOn>[]

beforeEach(() => {
  originalCwd = process.cwd()
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-invalid-config-')))
  process.chdir(dir)
  fs.mkdirSync(path.join('node_modules', '.bin'), { recursive: true })
  for (const bin of EXTERNAL_BINS) {
    for (const ext of ['', '.cmd']) fs.writeFileSync(path.join('node_modules', '.bin', bin + ext), '')
  }
  spies = (['log', 'warn', 'error'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
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

function printed(): string {
  return spies.flatMap((spy) => spy.mock.calls.flat()).join('\n')
}

function loadError(): string {
  try {
    loadVerifyConfig()
  } catch (error) {
    expect(error).toBeInstanceOf(VerifyConfigError)
    return (error as Error).message
  }
  throw new Error('expected loadVerifyConfig to throw')
}

describe('loadVerifyConfig validation', () => {
  it('returns an empty config when there is no verify config', () => {
    expect(loadVerifyConfig()).toEqual({})
    fs.writeFileSync('package.json', JSON.stringify({ name: 'x', scripts: { verify: 'verifyx all' } }))
    expect(loadVerifyConfig()).toEqual({})
  })

  it('accepts every documented key', () => {
    const config = {
      complexity: { threshold: 10, pattern: 'src/**/*.ts', ignore: ['a/**'] },
      comments: { maxLines: 10, pattern: 'src/**/*.ts', ignore: ['a/**'], pushback: true, warn: false, blockNewComments: true },
      unusedCode: { maxWarnings: 0 },
      duplicateCode: { maxWarnings: 137, paths: ['app'], ignore: ['**/*.test.*'] },
      circularDeps: { extensions: ['.ts'], ignore: ['a/**'], ignoreTypeImports: true },
      hardcodedColors: { root: 'src', ignore: ['**/tokens.ts'] },
      forbiddenStrings: [{ file: 'app.json', paths: ['env.LOG_LEVEL'], disallowed: 'debug' }],
    }
    writeConfig(config)
    expect(loadVerifyConfig()).toEqual(config)
  })

  it('names the file when verify.config.json is not valid JSON', () => {
    fs.writeFileSync('verify.config.json', '{ "complexity": ')
    expect(loadError()).toMatch(/^verify\.config\.json: not valid JSON/)
  })

  it('rejects invalid JSON rather than falling back to package.json', () => {
    fs.writeFileSync('verify.config.json', 'nope')
    fs.writeFileSync('package.json', JSON.stringify({ verify: { complexity: { threshold: 10 } } }))
    expect(loadError()).toContain('verify.config.json: not valid JSON')
  })

  it('rejects a config that is not an object', () => {
    writeConfig(['complexity'])
    expect(loadError()).toBe('verify.config.json: the config must be a JSON object')
  })

  it('names an unknown top-level key', () => {
    writeConfig({ complexty: { threshold: 10 } })
    expect(loadError()).toContain('verify.config.json: unknown key "complexty"')
  })

  it('names an unknown key inside a check, listing the allowed ones', () => {
    writeConfig({ complexity: { treshold: 10 } })
    expect(loadError()).toBe('verify.config.json: unknown key "complexity.treshold" (allowed: threshold, pattern, ignore)')
  })

  it.each(['complexity', 'comments', 'unusedCode', 'duplicateCode', 'circularDeps', 'hardcodedColors'])(
    'rejects a raw args key under %s',
    (section) => {
      writeConfig({ [section]: { args: ['--flag'] } })
      expect(loadError()).toContain(`verify.config.json: unknown key "${section}.args"`)
    },
  )

  it('rejects a top-level args key', () => {
    writeConfig({ args: ['--flag'] })
    expect(loadError()).toContain('verify.config.json: unknown key "args"')
  })

  it.each([
    [{ complexity: { threshold: '10' } }, '"complexity.threshold" must be a number'],
    [{ complexity: { pattern: ['src'] } }, '"complexity.pattern" must be a string'],
    [{ complexity: { ignore: 'a/**' } }, '"complexity.ignore" must be an array of strings'],
    [{ comments: { ignore: ['a', 1] } }, '"comments.ignore" must be an array of strings'],
    [{ comments: { pushback: 'true' } }, '"comments.pushback" must be a boolean'],
    [{ unusedCode: { maxWarnings: -1 } }, '"unusedCode.maxWarnings" must be a non-negative integer'],
    [{ duplicateCode: { maxWarnings: 1.5 } }, '"duplicateCode.maxWarnings" must be a non-negative integer'],
    [{ duplicateCode: { paths: 'src' } }, '"duplicateCode.paths" must be an array of strings'],
    [{ circularDeps: { ignoreTypeImports: 1 } }, '"circularDeps.ignoreTypeImports" must be a boolean'],
    [{ circularDeps: null }, '"circularDeps" must be an object'],
    [{ hardcodedColors: { root: 1 } }, '"hardcodedColors.root" must be a string'],
    [{ forbiddenStrings: {} }, '"forbiddenStrings" must be an array of rules'],
    [{ forbiddenStrings: [{ file: 'a.json', paths: ['x'] }] }, '"forbiddenStrings[0].disallowed" must be a string'],
  ])('names the key of a wrong-typed setting: %j', (config, problem) => {
    writeConfig(config)
    expect(loadError()).toBe(`verify.config.json: ${problem}`)
  })

  it('reports every problem, one per line', () => {
    writeConfig({ complexity: { threshold: 'x', args: [] }, nope: 1 })
    expect(loadError().split('\n')).toEqual([
      'verify.config.json: unknown key "complexity.args" (allowed: threshold, pattern, ignore)',
      'verify.config.json: "complexity.threshold" must be a number',
      expect.stringContaining('verify.config.json: unknown key "nope"'),
    ])
  })

  it('names package.json and the verify-prefixed key for a bad package.json config', () => {
    fs.writeFileSync('package.json', JSON.stringify({ verify: { complexity: { threshold: '10', args: [] } } }))
    expect(loadError().split('\n')).toEqual([
      'package.json: unknown key "verify.complexity.args" (allowed: threshold, pattern, ignore)',
      'package.json: "verify.complexity.threshold" must be a number',
    ])
  })

  it('rejects a package.json verify key that is not an object', () => {
    fs.writeFileSync('package.json', JSON.stringify({ verify: true }))
    expect(loadError()).toBe('package.json: "verify" must be an object')
  })
})

describe('checks fail on a bad config instead of falling back to defaults', () => {
  beforeEach(() => {
    writeConfig({ complexity: { args: ['--threshold', '10'] } })
  })

  it.each([
    ['complexity', () => runComplexity()],
    ['comments', () => runComments()],
    ['hardcoded-colors', () => runHardcodedColors()],
    ['forbidden-strings', () => runForbiddenStrings()],
  ])('fails the %s subcommand, naming the file and key', (name, run) => {
    expect(run()).toEqual({ name, ok: false })
    expect(printed()).toContain(`${name}: invalid verify config`)
    expect(printed()).toContain('verify.config.json: unknown key "complexity.args"')
  })

  it.each(CONFIG_READERS)('fails %s through runDefault, the path `verifyx all` uses', async (name) => {
    expect(await getCheck(name)?.runDefault()).toEqual({ name, ok: false })
    expect(printed()).toContain('verify.config.json: unknown key "complexity.args"')
    expect(spawned.runArgvCommand).not.toHaveBeenCalled()
    expect(spawned.captureArgvCommand).not.toHaveBeenCalled()
  })

  it('prints the error once for comments under runDefault', async () => {
    await getCheck('comments')?.runDefault()
    expect(printed().match(/invalid verify config/g)).toHaveLength(1)
  })

  it('fails with a command-line max-warnings too, since the command is still built from config', async () => {
    expect(await getCheck('duplicate-code')?.runDefault({ maxWarnings: 5 })).toEqual({ name: 'duplicate-code', ok: false })
    expect(spawned.captureArgvCommand).not.toHaveBeenCalled()
  })

  it('still runs the checks that read nothing from the verify config', async () => {
    fs.writeFileSync('tsconfig.json', '{}')
    for (const name of ['lint', 'format', 'check-types', 'github-actions']) {
      expect(await getCheck(name)?.runDefault()).toMatchObject({ name, ok: true })
    }
    expect(spawned.runArgvCommand).toHaveBeenCalledTimes(3)
  })

  it('covers every built-in check in one of the two groups above', () => {
    expect(CHECKS.map((check) => check.name).sort()).toEqual([...CONFIG_READERS, 'lint', 'format', 'check-types', 'github-actions'].sort())
  })

  it('refuses to eject a command built from a bad config', () => {
    expect(() => ejectScripts('circular-deps')).toThrow('verify.config.json: unknown key "complexity.args"')
  })
})
