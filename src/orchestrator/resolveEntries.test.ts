import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runShellCommand = vi.hoisted(() => vi.fn())

vi.mock('../shared/spawn.ts', () => ({ runShellCommand }))

import { entryCheckName, resolveEntries, resolveOverride, runEntryCommand, selectEntries, type VerifyEntry } from './resolveEntries.ts'

function entry(name: string): VerifyEntry {
  return { name, command: `npm run ${name}`, cwd: '.' }
}

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-entries-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('resolveEntries', () => {
  it('collects only verify:* scripts as npm run entries', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'verify:a': 'x', build: 'y', 'verify:b': 'z' } }))
    const entries = resolveEntries(dir)
    expect(entries.map((e) => e.name).sort()).toEqual(['verify:a', 'verify:b'])
    expect(entries.find((e) => e.name === 'verify:a')?.command).toBe('npm run verify:a')
  })

  it('builds npm entries with no env key', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'verify:a': 'x' } }))
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}')
    expect(resolveEntries(dir)).toStrictEqual([{ name: 'verify:a', command: 'npm run verify:a', cwd: dir }])
  })

  it('builds pnpm entries that skip the per-run dependency check', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'verify:a': 'x' } }))
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '')
    expect(resolveEntries(dir)).toEqual([
      { name: 'verify:a', command: 'pnpm run verify:a', cwd: dir, env: { pnpm_config_verify_deps_before_run: 'false' } },
    ])
  })

  it('detects the manager from the package.json directory, not the start directory', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'verify:a': 'x' } }))
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '')
    // An npm signal between the start dir and the package.json dir, which a walk from the start dir would hit first.
    fs.mkdirSync(path.join(dir, 'src'))
    fs.writeFileSync(path.join(dir, 'src', 'package-lock.json'), '{}')
    const nested = path.join(dir, 'src', 'deep')
    fs.mkdirSync(nested)
    expect(resolveEntries(nested)[0]).toMatchObject({ command: 'pnpm run verify:a', cwd: dir })
  })

  it('returns [] when there are no verify:* scripts', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'x' } }))
    expect(resolveEntries(dir)).toEqual([])
  })
})

describe('runEntryCommand', () => {
  afterEach(() => runShellCommand.mockReset())

  it('forwards the entry cwd and env to the shell runner, quietly', async () => {
    runShellCommand.mockResolvedValueOnce(3)
    const env = { pnpm_config_verify_deps_before_run: 'false' }
    const code = await runEntryCommand({ name: 'verify:a', command: 'pnpm run verify:a', cwd: dir, env })
    expect(code).toBe(3)
    expect(runShellCommand).toHaveBeenCalledWith('pnpm run verify:a', { cwd: dir, env, quiet: true })
  })
})

describe('entryCheckName', () => {
  it('strips the verify: prefix', () => {
    expect(entryCheckName('verify:lint')).toBe('lint')
  })
  it('strips a trailing :fix so a variant maps to its base check', () => {
    expect(entryCheckName('verify:lint:fix')).toBe('lint')
    expect(entryCheckName('verify:comments:fix')).toBe('comments')
  })
})

describe('selectEntries (bare verifyx: verify:<name> / verify:<name>:fix pairs)', () => {
  it('runs the base script in both modes when there is no :fix variant', () => {
    const entries = [entry('verify:lint')]
    expect(selectEntries(entries, 'check').map((e) => e.name)).toEqual(['verify:lint'])
    expect(selectEntries(entries, 'fix').map((e) => e.name)).toEqual(['verify:lint'])
  })

  it('prefers the :fix variant in fix mode and the base in check mode', () => {
    const entries = [entry('verify:lint'), entry('verify:lint:fix')]
    expect(selectEntries(entries, 'fix').map((e) => e.name)).toEqual(['verify:lint:fix'])
    expect(selectEntries(entries, 'check').map((e) => e.name)).toEqual(['verify:lint'])
  })

  it('never runs both the base and the :fix variant of the same check', () => {
    const entries = [entry('verify:lint'), entry('verify:lint:fix')]
    expect(selectEntries(entries, 'fix')).toHaveLength(1)
    expect(selectEntries(entries, 'check')).toHaveLength(1)
  })

  it('uses a lone :fix variant in fix mode but skips it in check mode', () => {
    const entries = [entry('verify:lint:fix')]
    expect(selectEntries(entries, 'fix').map((e) => e.name)).toEqual(['verify:lint:fix'])
    expect(selectEntries(entries, 'check')).toEqual([])
  })

  it('keeps distinct checks independent', () => {
    const entries = [entry('verify:lint'), entry('verify:lint:fix'), entry('verify:complexity')]
    expect(
      selectEntries(entries, 'fix')
        .map((e) => e.name)
        .sort(),
    ).toEqual(['verify:complexity', 'verify:lint:fix'])
  })
})

describe('resolveOverride (verifyx all per-check override)', () => {
  const entries = [entry('verify:lint'), entry('verify:lint:fix'), entry('verify:complexity')]

  it('returns the :fix variant in fix mode, the base in check mode', () => {
    expect(resolveOverride(entries, 'lint', 'fix')?.name).toBe('verify:lint:fix')
    expect(resolveOverride(entries, 'lint', 'check')?.name).toBe('verify:lint')
  })

  it('falls back to the base when there is no :fix variant', () => {
    expect(resolveOverride(entries, 'complexity', 'fix')?.name).toBe('verify:complexity')
  })

  it('returns undefined when no override is defined (built-in is used)', () => {
    expect(resolveOverride(entries, 'knip', 'fix')).toBeUndefined()
    expect(resolveOverride([entry('verify:lint:fix')], 'lint', 'check')).toBeUndefined()
  })
})
