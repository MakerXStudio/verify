import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runComments } from './comments.ts'
import { runComplexity } from './complexity.ts'
import { getCheck } from './registry.ts'

let dir: string
let originalCwd: string
let spies: ReturnType<typeof vi.spyOn>[]

beforeEach(() => {
  originalCwd = process.cwd()
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-native-config-')))
  process.chdir(dir)
  spies = (['log', 'warn', 'error'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
})
afterEach(() => {
  process.chdir(originalCwd)
  fs.rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function write(name: string, content: string): void {
  fs.mkdirSync(path.dirname(name), { recursive: true })
  fs.writeFileSync(name, content)
}

function writeConfig(config: unknown): void {
  write('verify.config.json', JSON.stringify(config))
}

function printed(): string {
  return spies.flatMap((spy) => spy.mock.calls.flat()).join('\n')
}

function clearPrinted(): void {
  for (const spy of spies) spy.mockClear()
}

const FN = 'export function f(a: number): number {\n  return a + 1\n}\n'
const LONG_BLOCK = ['// one', '// two', '// three', 'export const a = 1', ''].join('\n')

// context: maintainability index is clamped to 0-100, so a threshold of 101 fails every scored file and 0 fails none.
const FAIL_ALL = 101
const PASS_ALL = 0

describe('runComplexity config', () => {
  beforeEach(() => {
    write('src/a.ts', FN)
    write('src/b.ts', FN)
  })

  it('uses the built-in defaults with no config', () => {
    expect(runComplexity()).toEqual({ name: 'complexity', ok: true })
  })

  it('reads threshold from config', () => {
    writeConfig({ complexity: { threshold: FAIL_ALL } })
    expect(runComplexity().ok).toBe(false)
  })

  it('lets a given threshold win over config', () => {
    writeConfig({ complexity: { threshold: FAIL_ALL } })
    expect(runComplexity({ threshold: PASS_ALL }).ok).toBe(true)
  })

  it('reads pattern from config', () => {
    write('app/c.ts', FN)
    write('app/d.ts', FN)
    writeConfig({ complexity: { threshold: FAIL_ALL, pattern: 'app/**/*.ts' } })
    expect(runComplexity().ok).toBe(false)
    expect(printed()).toContain('app/c.ts')
    expect(printed()).not.toContain('src/a.ts')
  })

  it('lets a given pattern win over config', () => {
    write('app/c.ts', FN)
    write('app/d.ts', FN)
    writeConfig({ complexity: { threshold: FAIL_ALL, pattern: 'app/**/*.ts' } })
    runComplexity({ pattern: 'src/**/*.ts' })
    expect(printed()).toContain('src/a.ts')
    expect(printed()).not.toContain('app/c.ts')
  })

  it('reads ignore from config', () => {
    write('src/c.ts', FN)
    writeConfig({ complexity: { threshold: FAIL_ALL, ignore: ['src/c.ts'] } })
    runComplexity()
    expect(printed()).toContain('src/a.ts')
    expect(printed()).not.toContain('src/c.ts')
  })

  it('replaces the config ignore list with a given one rather than merging', () => {
    write('src/c.ts', FN)
    writeConfig({ complexity: { threshold: FAIL_ALL, ignore: ['src/c.ts'] } })
    runComplexity({ ignore: ['src/a.ts'] })
    expect(printed()).toContain('src/c.ts')
    expect(printed()).not.toContain('src/a.ts')
  })

  it('treats an empty ignore list, as an unused --ignore flag gives, as not given', () => {
    write('src/c.ts', FN)
    writeConfig({ complexity: { threshold: FAIL_ALL, ignore: ['src/c.ts'] } })
    runComplexity({ ignore: [] })
    expect(printed()).not.toContain('src/c.ts')
  })

  it('reads the same settings from a verify key in package.json', () => {
    write('package.json', JSON.stringify({ verify: { complexity: { threshold: FAIL_ALL } } }))
    expect(runComplexity().ok).toBe(false)
  })

  it('applies config through the runDefault path used by `verifyx all`', async () => {
    writeConfig({ complexity: { threshold: FAIL_ALL } })
    expect((await getCheck('complexity')?.runDefault())?.ok).toBe(false)
  })
})

describe('runComments config', () => {
  beforeEach(() => {
    write('src/a.ts', LONG_BLOCK)
  })

  it('uses the built-in max-lines of 2 with no config', () => {
    expect(runComments()).toEqual({ name: 'comments', ok: false })
  })

  it('reads maxLines from config', () => {
    writeConfig({ comments: { maxLines: 3 } })
    expect(runComments().ok).toBe(true)
  })

  it('lets a given maxLines win over config', () => {
    writeConfig({ comments: { maxLines: 3 } })
    expect(runComments({ maxLines: 2 }).ok).toBe(false)
  })

  it('applies config ignore to the long-block check', () => {
    writeConfig({ comments: { ignore: ['src/a.ts'] } })
    expect(runComments().ok).toBe(true)
  })

  it('replaces the config ignore list with a given one rather than merging', () => {
    writeConfig({ comments: { ignore: ['src/a.ts'] } })
    expect(runComments({ ignore: ['src/other.ts'] }).ok).toBe(false)
  })

  it('reads pattern from config, and lets a given pattern win', () => {
    write('app/clean.ts', 'export const a = 1\n')
    writeConfig({ comments: { pattern: 'app/**/*.ts' } })
    expect(runComments().ok).toBe(true)
    expect(runComments({ pattern: 'src/**/*.ts' }).ok).toBe(false)
  })

  it('reads warn from config, and lets a given warn win', () => {
    writeConfig({ comments: { warn: true } })
    expect(runComments().ok).toBe(true)
    expect(runComments({ warn: false }).ok).toBe(false)
  })

  it('reads pushback from config, and lets a given pushback win', () => {
    runComments()
    const plain = printed()
    clearPrinted()

    writeConfig({ comments: { pushback: true } })
    runComments()
    expect(printed()).not.toBe(plain)
    clearPrinted()

    runComments({ pushback: false })
    expect(printed()).toBe(plain)
  })

  it('keeps pushback on by default through runDefault, and lets config turn it off', async () => {
    runComments({ pushback: true })
    const pushed = printed()
    clearPrinted()

    await getCheck('comments')?.runDefault()
    expect(printed()).toBe(pushed)
    clearPrinted()

    writeConfig({ comments: { pushback: false } })
    await getCheck('comments')?.runDefault()
    expect(printed()).not.toBe(pushed)
  })

  it('reads blockNewComments from config, and lets a given blockNewComments win', () => {
    vi.stubEnv('CI', '')
    vi.stubEnv('VERIFY_DIFF_BASE', '')
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
        stdio: 'ignore',
      })
    }
    write('src/a.ts', 'export const a = 1\n')
    git('init')
    git('add', '.')
    git('commit', '-m', 'init')
    write('src/a.ts', '// a new comment\nexport const a = 1\n')

    expect(runComments().ok).toBe(true)
    writeConfig({ comments: { blockNewComments: true } })
    expect(runComments().ok).toBe(false)
    expect(runComments({ blockNewComments: false }).ok).toBe(true)
  })

  it('applies config through the runDefault path used by `verifyx all`', async () => {
    writeConfig({ comments: { maxLines: 3 } })
    expect((await getCheck('comments')?.runDefault())?.ok).toBe(true)
  })
})
