import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensurePointer, type ManagedFileResult, summarise, writeManaged } from './writeManaged.ts'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-managed-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('writeManaged', () => {
  it('creates a file (and parent dirs), then reports unchanged, then updated', () => {
    const file = path.join(dir, 'nested', 'file.md')

    const created: ManagedFileResult[] = []
    writeManaged(file, 'a', created)
    expect(created[0]?.action).toBe('created')
    expect(fs.readFileSync(file, 'utf-8')).toBe('a')

    const unchanged: ManagedFileResult[] = []
    writeManaged(file, 'a', unchanged)
    expect(unchanged[0]?.action).toBe('unchanged')

    const updated: ManagedFileResult[] = []
    writeManaged(file, 'b', updated)
    expect(updated[0]?.action).toBe('updated')
    expect(fs.readFileSync(file, 'utf-8')).toBe('b')
  })

  it('refuses to write through a symlink', () => {
    const target = path.join(dir, 'target.md')
    fs.writeFileSync(target, 'x')
    const link = path.join(dir, 'link.md')
    try {
      fs.symlinkSync(target, link)
    } catch {
      return // symlink creation is privileged on some platforms — skip
    }
    expect(() => writeManaged(link, 'y', [])).toThrow(/symlink/)
  })

  it('summarise counts each action', () => {
    expect(
      summarise([
        { path: 'a', action: 'created' },
        { path: 'b', action: 'unchanged' },
        { path: 'c', action: 'created' },
        { path: 'd', action: 'appended' },
      ]),
    ).toEqual({ created: 2, updated: 0, unchanged: 1, appended: 1 })
  })
})

describe('ensurePointer', () => {
  const block = '## Verification\n\nRun `/verify` and fix what it reports.\n'

  it('creates the file with the block when missing', () => {
    const file = path.join(dir, 'CLAUDE.md')
    const results: ManagedFileResult[] = []
    ensurePointer(file, block, ['/verify'], results)
    expect(results[0]?.action).toBe('created')
    expect(fs.readFileSync(file, 'utf-8')).toBe(block)
  })

  it('leaves the file untouched when the marker is already present', () => {
    const file = path.join(dir, 'CLAUDE.md')
    const original = '# My project\n\nSome guidance mentioning /verify already.\n'
    fs.writeFileSync(file, original)
    const results: ManagedFileResult[] = []
    ensurePointer(file, block, ['/verify'], results)
    expect(results[0]?.action).toBe('unchanged')
    expect(fs.readFileSync(file, 'utf-8')).toBe(original)
  })

  it('leaves the file untouched when any one of several markers is present', () => {
    const file = path.join(dir, 'CLAUDE.md')
    const original = '# My project\n\nRun `pnpm run verify` before finishing.\n'
    fs.writeFileSync(file, original)
    const results: ManagedFileResult[] = []
    ensurePointer(file, block, ['pnpm verify', 'pnpm run verify'], results)
    expect(results[0]?.action).toBe('unchanged')
    expect(fs.readFileSync(file, 'utf-8')).toBe(original)
  })

  it('appends the block (keeping existing content) when the marker is absent', () => {
    const file = path.join(dir, 'CLAUDE.md')
    const original = '# My project\n\nExisting instructions.\n'
    fs.writeFileSync(file, original)
    const results: ManagedFileResult[] = []
    ensurePointer(file, block, ['/verify'], results)
    expect(results[0]?.action).toBe('appended')
    const after = fs.readFileSync(file, 'utf-8')
    expect(after.startsWith(original)).toBe(true)
    expect(after).toContain(block)
  })

  it('is idempotent — a second call after appending is a no-op', () => {
    const file = path.join(dir, 'CLAUDE.md')
    fs.writeFileSync(file, '# My project\n')
    ensurePointer(file, block, ['/verify'], [])
    const afterFirst = fs.readFileSync(file, 'utf-8')
    const results: ManagedFileResult[] = []
    ensurePointer(file, block, ['/verify'], results)
    expect(results[0]?.action).toBe('unchanged')
    expect(fs.readFileSync(file, 'utf-8')).toBe(afterFirst)
  })
})
