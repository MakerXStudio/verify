import path from 'node:path'

import ts from 'typescript'

/** True when the tsconfig declares project `references` (e.g. Vite's solution-style root), which plain `tsc` ignores. */
function hasProjectReferences(cwd: string = process.cwd()): boolean {
  const { config } = ts.readConfigFile(path.join(cwd, 'tsconfig.json'), ts.sys.readFile)
  return Array.isArray(config?.references) && config.references.length > 0
}

/** `tsc --noEmit` checks nothing on a solution-style tsconfig; build mode follows the references. */
export function typeCheckCommand(cwd: string = process.cwd()): readonly string[] {
  return hasProjectReferences(cwd) ? ['tsc', '-b'] : ['tsc', '--noEmit']
}
