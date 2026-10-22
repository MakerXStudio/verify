import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { detectPackageManager, PACKAGE_MANAGER_COMMANDS } from './packageManager.ts'

// Detection is memoised per start directory, so every test gets its own fresh temp dir.
let dir: string
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verifyx-pm-')))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const write = (files: Record<string, string | object>) => {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
  }
}

describe('detectPackageManager', () => {
  it('reads a devEngines.packageManager object', () => {
    write({ 'package.json': { devEngines: { packageManager: { name: 'pnpm', version: '^11' } } } })
    expect(detectPackageManager(dir)).toBe('pnpm')
  })

  it('uses the first entry of a devEngines.packageManager array', () => {
    write({ 'package.json': { devEngines: { packageManager: [{ name: 'pnpm' }, { name: 'npm' }] } } })
    expect(detectPackageManager(dir)).toBe('pnpm')
  })

  it('reads packageManager with a version', () => {
    write({ 'package.json': { packageManager: 'pnpm@11.21.0+sha512.abc' } })
    expect(detectPackageManager(dir)).toBe('pnpm')
  })

  it('reads packageManager without a version', () => {
    write({ 'package.json': { packageManager: 'pnpm' } })
    expect(detectPackageManager(dir)).toBe('pnpm')
  })

  it('treats a scoped-looking packageManager as an unsupported name', () => {
    write({ 'package.json': { packageManager: '@scope/pnpm@1.0.0' }, 'pnpm-lock.yaml': '' })
    expect(detectPackageManager(dir)).toBe('npm')
  })

  it('lets a field beat a lockfile in the same directory', () => {
    write({ 'package.json': { packageManager: 'npm@10.0.0' }, 'pnpm-lock.yaml': '' })
    expect(detectPackageManager(dir)).toBe('npm')
  })

  it('lets devEngines beat packageManager', () => {
    write({ 'package.json': { devEngines: { packageManager: { name: 'pnpm' } }, packageManager: 'npm@10.0.0' } })
    expect(detectPackageManager(dir)).toBe('pnpm')
  })

  it('picks pnpm when both pnpm and npm lockfiles are present', () => {
    write({ 'pnpm-lock.yaml': '', 'package-lock.json': '{}' })
    expect(detectPackageManager(dir)).toBe('pnpm')
  })

  it('treats pnpm-workspace.yaml and npm-shrinkwrap.json as lockfile signals', () => {
    write({ 'a/pnpm-workspace.yaml': '', 'b/npm-shrinkwrap.json': '{}' })
    expect(detectPackageManager(path.join(dir, 'a'))).toBe('pnpm')
    expect(detectPackageManager(path.join(dir, 'b'))).toBe('npm')
  })

  it('walks up from a sub-package to the workspace root', () => {
    write({
      'package.json': { name: 'root', packageManager: 'pnpm@11.21.0' },
      'pnpm-lock.yaml': '',
      'pnpm-workspace.yaml': 'packages:\n  - api\n',
      'api/package.json': { name: 'api' },
    })
    expect(detectPackageManager(path.join(dir, 'api'))).toBe('pnpm')
  })

  it('lets the nearest directory win over a farther one', () => {
    write({ 'pnpm-lock.yaml': '', 'sub/package-lock.json': '{}' })
    expect(detectPackageManager(path.join(dir, 'sub'))).toBe('npm')
  })

  it('stops the walk at a field naming another manager and resolves to npm', () => {
    write({ 'pnpm-lock.yaml': '', 'sub/package.json': { packageManager: 'other@1.0.0' } })
    expect(detectPackageManager(path.join(dir, 'sub'))).toBe('npm')
  })

  it('lets a field naming another manager beat a pnpm lockfile in the same directory', () => {
    write({ 'package.json': { devEngines: { packageManager: { name: 'other' } } }, 'pnpm-lock.yaml': '' })
    expect(detectPackageManager(dir)).toBe('npm')
  })

  it('ignores an invalid package.json but still reads its lockfiles', () => {
    write({ 'package.json': '{ not json', 'pnpm-lock.yaml': '' })
    expect(detectPackageManager(dir)).toBe('pnpm')
  })

  it('resolves to npm when no directory has a signal', () => {
    write({ 'package.json': { name: 'plain' } })
    expect(detectPackageManager(dir)).toBe('npm')
  })
})

describe('PACKAGE_MANAGER_COMMANDS', () => {
  const { npm, pnpm } = PACKAGE_MANAGER_COMMANDS

  it('builds npm commands', () => {
    expect(npm.runScript('verify:lint')).toEqual({ command: 'npm run verify:lint' })
    expect(npm.addDevDependencies(['oxlint', 'knip'], ['@parcel/watcher'])).toEqual(['npm', 'install', '--save-dev', 'oxlint', 'knip'])
    expect(npm.runGate).toBe('npm run verify')
    expect(npm.runCli).toBe('npx verifyx')
    expect(npm.pointerMarkers).toEqual(['npm run verify'])
  })

  it('builds pnpm commands', () => {
    expect(pnpm.runScript('verify:lint')).toEqual({
      command: 'pnpm run verify:lint',
      env: { pnpm_config_verify_deps_before_run: 'false' },
    })
    expect(pnpm.addDevDependencies(['oxlint', 'skott'], ['@parcel/watcher'])).toEqual([
      'pnpm',
      'add',
      '-D',
      '--ignore-workspace-root-check',
      '--allow-build=!@parcel/watcher',
      'oxlint',
      'skott',
    ])
    expect(pnpm.addDevDependencies(['oxlint'])).toEqual(['pnpm', 'add', '-D', '--ignore-workspace-root-check', 'oxlint'])
    expect(pnpm.runGate).toBe('pnpm verify')
    expect(pnpm.runCli).toBe('pnpm exec verifyx')
    expect(pnpm.pointerMarkers).toEqual(['pnpm verify', 'pnpm run verify'])
  })
})
