import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { typeCheckCommand } from './tsconfig.ts'

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

  it('falls back to tsc --noEmit when tsconfig is missing', () => {
    expect(typeCheckCommand(dir)).toEqual(['tsc', '--noEmit'])
  })
})
