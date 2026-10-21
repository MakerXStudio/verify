import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installDevDeps, type Runner } from './installDeps.ts'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-install-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'scratch' }))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function fakeRunner(failFor: string[] = []): Runner & { commands: string[][] } {
  const commands: string[][] = []
  const run: Runner = (argv) => {
    commands.push([...argv])
    return Promise.resolve(failFor.some((pkg) => argv.includes(pkg)) ? 1 : 0)
  }
  return Object.assign(run, { commands })
}

describe('installDevDeps (npm)', () => {
  const npm = (run: Runner) => ({ packageManager: 'npm' as const, run })

  it('installs missing deps in a single batch on the happy path', async () => {
    const run = fakeRunner()
    const report = await installDevDeps(['oxlint', 'knip'], dir, npm(run))

    expect(report).toEqual({ skipped: [], installed: ['oxlint', 'knip'], failed: [] })
    expect(run.commands).toEqual([['npm', 'install', '--save-dev', 'oxlint', 'knip']])
  })

  it('skips deps already declared in package.json (any dependency field)', async () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { typescript: '^5.0.0' }, peerDependencies: { oxlint: '*' } }),
    )
    const run = fakeRunner()
    const report = await installDevDeps(['typescript', 'oxlint', 'knip'], dir, npm(run))

    expect(report.skipped).toEqual(['typescript', 'oxlint'])
    expect(report.installed).toEqual(['knip'])
    expect(run.commands).toEqual([['npm', 'install', '--save-dev', 'knip']])
  })

  it('skips deps present in node_modules even when not declared', async () => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'oxlint'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', 'oxlint', 'package.json'), '{}')
    const run = fakeRunner()
    const report = await installDevDeps(['oxlint', 'knip'], dir, npm(run))

    expect(report.skipped).toEqual(['oxlint'])
    expect(report.installed).toEqual(['knip'])
  })

  it('runs no install command when everything is already present', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { oxlint: '*', knip: '*' } }))
    const run = fakeRunner()
    const report = await installDevDeps(['oxlint', 'knip'], dir, npm(run))

    expect(report).toEqual({ skipped: ['oxlint', 'knip'], installed: [], failed: [] })
    expect(run.commands).toEqual([])
  })

  it('falls back to per-package installs and isolates the failure when the batch fails', async () => {
    const run = fakeRunner(['oxlint'])
    const report = await installDevDeps(['oxlint', 'knip', 'skott'], dir, npm(run))

    expect(report).toEqual({ skipped: [], installed: ['knip', 'skott'], failed: ['oxlint'] })
    // batch first, then one command per package to isolate the culprit
    expect(run.commands).toEqual([
      ['npm', 'install', '--save-dev', 'oxlint', 'knip', 'skott'],
      ['npm', 'install', '--save-dev', 'oxlint'],
      ['npm', 'install', '--save-dev', 'knip'],
      ['npm', 'install', '--save-dev', 'skott'],
    ])
  })

  it('passes no decline flags to npm', async () => {
    const run = fakeRunner()
    await installDevDeps(['skott'], dir, { ...npm(run), declineBuilds: ['@parcel/watcher'] })

    expect(run.commands).toEqual([['npm', 'install', '--save-dev', 'skott']])
  })
})

describe('installDevDeps (pnpm)', () => {
  const ADD = ['pnpm', 'add', '-D', '--ignore-workspace-root-check']
  const DECLINE = '--allow-build=!@parcel/watcher'

  const pnpm = (run: Runner, cwd = dir) =>
    installDevDeps(['skott', 'knip'], cwd, { packageManager: 'pnpm', declineBuilds: ['@parcel/watcher'], run })

  const writeWorkspace = (yaml: string, at = dir) => fs.writeFileSync(path.join(at, 'pnpm-workspace.yaml'), yaml)

  const argvFor = async (cwd = dir) => {
    const run = fakeRunner()
    await pnpm(run, cwd)
    expect(run.commands).toHaveLength(1)
    return run.commands[0]
  }

  it('runs one add with the workspace-root flag and the decline flag', async () => {
    const run = fakeRunner()
    const report = await pnpm(run)

    expect(report).toEqual({ skipped: [], installed: ['skott', 'knip'], failed: [] })
    expect(run.commands).toEqual([[...ADD, DECLINE, 'skott', 'knip']])
  })

  it('does not retry per package after a failed batch', async () => {
    const run = fakeRunner(['skott'])
    const report = await pnpm(run)

    expect(run.commands).toHaveLength(1)
    expect(report).toEqual({ skipped: [], installed: [], failed: ['skott', 'knip'] })
  })

  it('declines the build when there is no pnpm-workspace.yaml', async () => {
    expect(await argvFor()).toContain(DECLINE)
  })

  it.each([
    ['@parcel/watcher', true],
    ['@parcel/watcher', false],
    ['@parcel/watcher@2.6.0', true],
  ])('leaves the decision alone when allowBuilds[%j] is %j', async (key, value) => {
    writeWorkspace(`allowBuilds:\n  '${key}': ${value}\n`)
    expect(await argvFor()).toEqual([...ADD, 'skott', 'knip'])
  })

  it('leaves the decision alone when one version is approved and another declined', async () => {
    writeWorkspace("allowBuilds:\n  '@parcel/watcher@2.4.1': false\n  '@parcel/watcher@2.6.0': true\n")
    expect(await argvFor()).toEqual([...ADD, 'skott', 'knip'])
  })

  it.each([
    ['only in onlyBuiltDependencies', "onlyBuiltDependencies:\n  - '@parcel/watcher'\n"],
    ['only in ignoredBuiltDependencies', "ignoredBuiltDependencies:\n  - '@parcel/watcher'\n"],
    ['a placeholder in allowBuilds', "allowBuilds:\n  '@parcel/watcher': set this to true or false\n"],
    ['a version-keyed entry with no version', "allowBuilds:\n  '@parcel/watcher@': true\n"],
    ['declined only for another version', "allowBuilds:\n  '@parcel/watcher@2.4.1': false\n"],
    ['an entry for a different package', "allowBuilds:\n  '@parcel/watcher-wasm': true\n"],
    ['an unparseable file', 'allowBuilds: [\n'],
  ])('declines the build when the package is %s', async (_, yaml) => {
    writeWorkspace(yaml)
    expect(await argvFor()).toContain(DECLINE)
  })

  it('finds the workspace file from a sub-directory', async () => {
    writeWorkspace("packages:\n  - 'api'\nallowBuilds:\n  '@parcel/watcher': false\n")
    const api = path.join(dir, 'api')
    fs.mkdirSync(api)
    fs.writeFileSync(path.join(api, 'package.json'), JSON.stringify({ name: 'api' }))

    expect(await argvFor(api)).toEqual([...ADD, 'skott', 'knip'])
  })
})
