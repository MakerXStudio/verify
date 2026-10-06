import path from 'node:path'

import ts from 'typescript'

// TS asserts on Windows backslash paths when reporting a config parse error.
const configPath = (cwd: string) => path.join(cwd, 'tsconfig.json').replaceAll('\\', '/')

/** returns `true` when the tsconfig declares project `references` (e.g. Vite's solution-style root) */
function hasProjectReferences(cwd: string = process.cwd()): boolean {
  try {
    const { config, error } = ts.readConfigFile(configPath(cwd), ts.sys.readFile)
    return !error && Array.isArray(config?.references) && config.references.length > 0
  } catch {
    return false
  }
}

/** Generate the appropriate type-check command for the project's tsconfig */
export function typeCheckCommand(cwd: string = process.cwd()): readonly string[] {
  return hasProjectReferences(cwd) ? ['tsc', '-b'] : ['tsc', '--noEmit']
}

// No-op readDirectory: only compiler options are needed, so skip expanding `include` globs.
const optionsOnlyHost: ts.ParseConfigFileHost = {
  ...ts.sys,
  readDirectory: () => [],
  onUnRecoverableConfigFileDiagnostic: () => {},
}

function writesBesideSource(parsed: ts.ParsedCommandLine): boolean {
  const { noEmit, outDir, outFile, emitDeclarationOnly, declarationDir } = parsed.options
  const hasInputs = parsed.fileNames.length > 0 || Object.keys(parsed.wildcardDirectories ?? {}).length > 0
  return hasInputs && !noEmit && !outDir && !outFile && !(emitDeclarationOnly && declarationDir)
}

/** Configs in the reference graph that `tsc -b` would emit next to their sources. */
function configsEmittingBesideSource(cwd: string = process.cwd()): string[] {
  const offenders: string[] = []
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const parsed = ts.getParsedCommandLineOfConfigFile(file, undefined, optionsOnlyHost)
    if (!parsed) return
    if (writesBesideSource(parsed)) offenders.push(path.relative(cwd, file) || 'tsconfig.json')
    for (const ref of parsed.projectReferences ?? []) visit(ts.resolveProjectReferencePath(ref).replaceAll('\\', '/'))
  }
  try {
    visit(configPath(cwd))
  } catch {
    // Unparseable config: let tsc report it.
  }
  return offenders
}

/** Fails `tsc -b` up front rather than letting it write .js files into the source tree. */
export function typeCheckPreflight(cwd: string = process.cwd()): string | undefined {
  if (!hasProjectReferences(cwd)) return undefined
  const offenders = configsEmittingBesideSource(cwd)
  if (offenders.length === 0) return undefined
  return [
    `check-types runs \`tsc -b\` because tsconfig.json has \`references\`, and these configs would write output next to their sources: ${offenders.join(', ')}.`,
    'Set `"noEmit": true` (or an `outDir`) in each. To keep .tsbuildinfo files out of the tree, set `"tsBuildInfoFile": "./node_modules/.tmp/<name>.tsbuildinfo"`.',
  ].join('\n')
}
