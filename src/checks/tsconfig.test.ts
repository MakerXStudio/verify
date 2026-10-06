import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { typeCheckCommand, typeCheckPreflight } from './tsconfig.ts'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifyx-tsconfig-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const writeTsconfig = (text: string) => fs.writeFileSync(path.join(dir, 'tsconfig.json'), text)

describe('typeCheckCommand', () => {
  it('uses tsc --noEmit for a plain tsconfig', () => {
    writeTsconfig('{ "compilerOptions": { "strict": true } }')
    expect(typeCheckCommand(dir)).toEqual(['tsc', '--noEmit'])
  })

  it('uses build mode for a solution-style tsconfig with references, tolerating JSONC', () => {
    writeTsconfig(`{
      // Vite template
      "files": [],
      "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" },],
    }`)
    expect(typeCheckCommand(dir)).toEqual(['tsc', '-b'])
  })

  it('uses tsc --noEmit when references is empty', () => {
    writeTsconfig('{ "references": [] }')
    expect(typeCheckCommand(dir)).toEqual(['tsc', '--noEmit'])
  })

  it('returns tsc --noEmit for a malformed tsconfig, leaving tsc to report the syntax error', () => {
    writeTsconfig('{ "compilerOptions": { "strict": true }, "include": ["src"],')
    expect(typeCheckCommand(dir)).toEqual(['tsc', '--noEmit'])
  })

  it('returns tsc --noEmit rather than throwing when tsconfig is missing (eject ignores canRun)', () => {
    expect(typeCheckCommand(dir)).toEqual(['tsc', '--noEmit'])
  })
})

describe('typeCheckPreflight', () => {
  const write = (file: string, config: object) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), JSON.stringify(config))
  }

  it('passes the Vite template shape: empty root, referenced configs set noEmit', () => {
    write('tsconfig.json', { files: [], references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }] })
    write('tsconfig.app.json', { compilerOptions: { noEmit: true }, include: ['src'] })
    write('tsconfig.node.json', { compilerOptions: { noEmit: true }, include: ['vite.config.ts'] })
    expect(typeCheckPreflight(dir)).toBeUndefined()
  })

  it('passes composite references that build into an outDir', () => {
    write('tsconfig.json', { files: [], references: [{ path: './a' }, { path: './b' }] })
    write('a/tsconfig.json', { compilerOptions: { composite: true, outDir: 'dist' }, include: ['*.ts'] })
    write('b/tsconfig.json', { compilerOptions: { composite: true, outDir: 'dist' }, include: ['*.ts'], references: [{ path: '../a' }] })
    expect(typeCheckPreflight(dir)).toBeUndefined()
  })

  it('blocks configs that would emit beside source, including the root and ones inheriting via extends', () => {
    write('tsconfig.base.json', { compilerOptions: { strict: true } })
    write('tsconfig.json', { include: ['src'], references: [{ path: './lib' }] })
    write('lib/tsconfig.json', { extends: '../tsconfig.base.json', include: ['*.ts'] })
    const message = typeCheckPreflight(dir)
    expect(message).toContain('tsconfig.json')
    expect(message).toContain(path.join('lib', 'tsconfig.json'))
    expect(message).toContain('noEmit')
  })

  it('honours noEmit inherited via extends', () => {
    write('tsconfig.base.json', { compilerOptions: { noEmit: true } })
    write('tsconfig.json', { files: [], references: [{ path: './lib' }] })
    write('lib/tsconfig.json', { extends: '../tsconfig.base.json', include: ['*.ts'] })
    expect(typeCheckPreflight(dir)).toBeUndefined()
  })

  it('does not run for a plain tsconfig', () => {
    write('tsconfig.json', { include: ['src'] })
    expect(typeCheckPreflight(dir)).toBeUndefined()
  })
})
