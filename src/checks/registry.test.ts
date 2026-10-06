import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { CHECKS, getCheck, recommendedChecks } from './registry.ts'

describe('check registry', () => {
  it('includes the native and external checks', () => {
    const names = CHECKS.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'complexity',
        'comments',
        'hardcoded-colors',
        'forbidden-strings',
        'lint',
        'format',
        'check-types',
        'unused-code',
        'circular-deps',
        'duplicate-code',
      ]),
    )
  })

  it('names checks for their function, not the underlying tool', () => {
    expect(getCheck('knip')).toBeUndefined()
    expect(getCheck('skott')).toBeUndefined()
    expect(getCheck('jscpd')).toBeUndefined()
  })

  it('marks external tool checks with scaffold devDeps and a verifyx-CLI script', () => {
    const unused = getCheck('unused-code')
    expect(unused?.kind).toBe('external')
    // The check is named for its function; the tool (knip) is only an install detail.
    expect(unused?.scaffold.devDeps).toContain('knip')
    expect(unused?.scaffold.script).toBe('verifyx unused-code')
  })

  it('scaffolds native checks back into the verifyx CLI', () => {
    expect(getCheck('complexity')?.scaffold.script).toBe('verifyx complexity')
  })

  it('scaffolds circular-deps without a shell-dependent glob', () => {
    expect(getCheck('circular-deps')?.scaffold.script).toBe('verifyx circular-deps')
  })

  it('exposes raw tool commands for eject on external checks, but not native ones', () => {
    expect(getCheck('lint')?.eject).toEqual({ check: 'oxlint .', fix: 'oxlint --fix .' })
    expect(getCheck('circular-deps')?.eject?.check).toBe(
      'skott --displayMode=raw --showCircularDependencies --exitCodeOnCircularDependencies=1',
    )
    expect(getCheck('circular-deps')?.eject?.fix).toBeUndefined()
    expect(getCheck('complexity')?.eject).toBeUndefined()
  })

  it('resolves the check-types command in the current project at eject time', () => {
    const originalCwd = process.cwd()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifyx-registry-'))
    try {
      process.chdir(dir)
      fs.writeFileSync('tsconfig.json', '{}')
      expect(getCheck('check-types')?.eject?.check).toBe('tsc --noEmit')
      fs.writeFileSync('tsconfig.json', '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }')
      expect(getCheck('check-types')?.eject?.check).toBe('tsc -b')
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns undefined for unknown checks', () => {
    expect(getCheck('nope')).toBeUndefined()
  })

  it('recommends a subset for init preselection, all within the registry', () => {
    const recommended = recommendedChecks()
    expect(recommended.length).toBeGreaterThan(0)
    expect(recommended.length).toBeLessThan(CHECKS.length)
    for (const check of recommended) expect(CHECKS).toContain(check)
  })
})
