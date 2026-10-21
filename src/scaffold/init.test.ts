import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CHECKS } from '../checks/registry.ts'
import { applyInit } from './init.ts'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-init-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'scratch' }))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function readScripts(): Record<string, string> {
  return (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as { scripts: Record<string, string> }).scripts
}

describe('applyInit', () => {
  it('writes verify:* scripts, the verify skill, a CLAUDE.md pointer, and collects external devDeps', () => {
    const result = applyInit({
      cwd: dir,
      checks: ['complexity', 'unused-code'],
      targets: ['claude'],
      defaultsOnly: false,
      packageManager: 'npm',
    })

    const scripts = readScripts()
    expect(scripts['verify:complexity']).toBe('verifyx complexity')
    expect(scripts['verify:unused-code']).toBe('verifyx unused-code')
    expect(scripts.verify).toBe('verifyx')
    expect(result.devDeps).toContain('knip')
    // The skill (not a slash command) is the Claude integration.
    expect(fs.existsSync(path.join(dir, '.claude', 'skills', 'verify', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(dir, '.claude', 'commands'))).toBe(false)
    // CLAUDE.md is created with the verify pointer.
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8')).toContain('npm run verify')
  })

  it('defaults-only writes no verify:* scripts, points verify at `verifyx all`, and writes the agents skill + AGENTS.md', () => {
    const result = applyInit({ cwd: dir, checks: ['unused-code'], targets: ['agents'], defaultsOnly: true, packageManager: 'npm' })

    expect(Object.keys(readScripts())).toEqual(['verify'])
    expect(readScripts().verify).toBe('verifyx all')
    expect(result.devDeps).toContain('knip')
    expect(fs.existsSync(path.join(dir, '.agent-skills', 'verify', 'SKILL.md'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toContain('npm run verify')
  })

  it('defaults-only with every check installs all external devDeps but writes only the verify script', () => {
    const result = applyInit({ cwd: dir, checks: CHECKS.map((c) => c.name), targets: [], defaultsOnly: true })

    expect(Object.keys(readScripts())).toEqual(['verify'])
    expect(readScripts().verify).toBe('verifyx all')
    // Every external check's tool is installed, so `verifyx all` can actually run them.
    expect(result.devDeps).toEqual(expect.arrayContaining(['knip', 'jscpd', 'skott']))
  })

  it("collects the selected checks' declined builds, and none when no selected check declines any", () => {
    expect(applyInit({ cwd: dir, checks: ['circular-deps', 'unused-code'], targets: [], defaultsOnly: false }).declineBuilds).toEqual([
      '@parcel/watcher',
    ])
    expect(applyInit({ cwd: dir, checks: ['unused-code', 'complexity'], targets: [], defaultsOnly: false }).declineBuilds).toEqual([])
  })

  it('does not clobber an existing verify:* script', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'verify:complexity': 'custom' } }))
    applyInit({ cwd: dir, checks: ['complexity'], targets: [], defaultsOnly: false })
    expect(readScripts()['verify:complexity']).toBe('custom')
  })

  it('teaches knip to ignore the external tools verifyx runs when unused-code is selected', () => {
    applyInit({ cwd: dir, checks: ['unused-code', 'lint', 'format'], targets: [], defaultsOnly: false })
    const knip = JSON.parse(fs.readFileSync(path.join(dir, 'knip.json'), 'utf-8')) as { ignoreDependencies?: string[] }
    expect(knip.ignoreDependencies).toEqual(expect.arrayContaining(['oxlint', 'oxfmt']))
    expect(knip.ignoreDependencies).not.toContain('knip') // the runner isn't flagged
  })

  it('does not create a knip config when unused-code is not selected', () => {
    applyInit({ cwd: dir, checks: ['lint', 'format'], targets: [], defaultsOnly: false })
    expect(fs.existsSync(path.join(dir, 'knip.json'))).toBe(false)
  })

  it('renders the agent docs for npm exactly as before the templates took placeholders', () => {
    applyInit({ cwd: dir, checks: [], targets: ['claude'], defaultsOnly: false, packageManager: 'npm' })
    expect(fs.readFileSync(path.join(dir, '.claude', 'skills', 'verify', 'SKILL.md'), 'utf-8')).toBe(NPM_SKILL)
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8')).toBe(NPM_GUIDANCE)
  })
})

const NPM_SKILL = `---
name: verify
description: Run this project's code verifications and fix what they report. Use after making code changes, or when asked to "verify", "run checks", or "run verify".
---

Run \`npm run verify\` (or \`npx verifyx\` \u2014 the CLI binary is \`verifyx\`, since \`verify\` is a Windows builtin). If it fails, fix every error and run again until it passes. Don't silence checks or game the metrics.
`

const NPM_GUIDANCE = `## Verification

After making code changes, run \`npm run verify\` and fix everything it reports before finishing. Don't silence checks or game the metrics.
`

describe('applyInit with pnpm', () => {
  const agentDocs = ['CLAUDE.md', 'AGENTS.md', '.claude/skills/verify/SKILL.md', '.agent-skills/verify/SKILL.md']
  const read = (file: string) => fs.readFileSync(path.join(dir, ...file.split('/')), 'utf-8')

  function expectPnpmDocs(): void {
    for (const file of agentDocs) {
      expect(read(file)).toContain('pnpm verify')
      expect(read(file)).not.toContain('npm run verify')
      expect(read(file)).not.toContain('npx verifyx')
    }
    expect(read('.claude/skills/verify/SKILL.md')).toContain('pnpm exec verifyx')
    expect(read('.agent-skills/verify/SKILL.md')).toContain('pnpm exec verifyx')
  }

  it('names pnpm commands in every agent doc when the manager is passed', () => {
    applyInit({ cwd: dir, checks: [], targets: ['claude', 'agents'], defaultsOnly: false, packageManager: 'pnpm' })
    expectPnpmDocs()
  })

  it('names pnpm commands in every agent doc when pnpm is detected from a lockfile', () => {
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    applyInit({ cwd: dir, checks: [], targets: ['claude', 'agents'], defaultsOnly: false })
    expectPnpmDocs()
  })

  it('leaves a CLAUDE.md that already says `pnpm run verify` unchanged', () => {
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    const original = '# Project\n\nRun `pnpm run verify` before finishing.\n'
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), original)
    const result = applyInit({ cwd: dir, checks: [], targets: ['claude'], defaultsOnly: false })
    expect(result.agentFiles.find((file) => file.path === path.join(dir, 'CLAUDE.md'))?.action).toBe('unchanged')
    expect(read('CLAUDE.md')).toBe(original)
  })
})
