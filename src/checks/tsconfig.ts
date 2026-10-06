import path from 'node:path'

import ts from 'typescript'

/** returns `true` when the tsconfig declares project `references` (e.g. Vite's solution-style root) */
function hasProjectReferences(cwd: string = process.cwd()): boolean {
  const { config } = ts.readConfigFile(path.join(cwd, 'tsconfig.json'), ts.sys.readFile)
  return Array.isArray(config?.references) && config.references.length > 0
}

/** Generate the appropriate type-check command for the project's tsconfig */
export function typeCheckCommand(cwd: string = process.cwd()): readonly string[] {
  return hasProjectReferences(cwd) ? ['tsc', '-b'] : ['tsc', '--noEmit']
}
