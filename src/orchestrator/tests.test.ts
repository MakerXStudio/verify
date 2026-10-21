import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveTestEntry, resolveTestScript } from './tests.ts'

describe('resolveTestScript', () => {
  it('prefers an explicit verify:test locally, then the standard test script', () => {
    expect(resolveTestScript({ 'verify:test': 'vitest run --silent', test: 'vitest' }, false)).toBe('verify:test')
    expect(resolveTestScript({ test: 'vitest' }, false)).toBe('test')
  })

  it('runs only test:ci on CI, never a plain test/verify:test', () => {
    expect(resolveTestScript({ 'verify:test': 'x', test: 'y', 'test:ci': 'vitest run --reporter=junit' }, true)).toBe('test:ci')
    expect(resolveTestScript({ 'verify:test': 'x', test: 'y' }, true)).toBeNull()
  })

  it('returns null when no applicable script exists', () => {
    expect(resolveTestScript({ build: 'tsc' }, false)).toBeNull()
    expect(resolveTestScript({}, true)).toBeNull()
  })
})

describe('resolveTestEntry', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-tests-'))
    vi.spyOn(process, 'cwd').mockReturnValue(dir)
    vi.stubEnv('CI', '')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('runs the test script with npm and no env in an npm project', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}')
    expect(resolveTestEntry()).toStrictEqual({ name: 'test', command: 'npm run test', cwd: dir })
  })

  it('runs the test script with pnpm and its env in a pnpm project', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '')
    expect(resolveTestEntry()).toEqual({
      name: 'test',
      command: 'pnpm run test',
      cwd: dir,
      env: { pnpm_config_verify_deps_before_run: 'false' },
    })
  })
})
