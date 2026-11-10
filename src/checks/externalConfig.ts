import { loadVerifyConfig, type VerifyConfig } from '../shared/config.ts'

const DEFAULT_DUPLICATE_PATHS = ['src']
const DEFAULT_DUPLICATE_IGNORE = ['**/*.test.*']

/** skott argv for `circular-deps`, with the `circularDeps` verify-config settings translated into skott flags. */
export function circularDepsCommand(config: VerifyConfig['circularDeps'] = loadVerifyConfig().circularDeps): string[] {
  const argv = ['skott', '--displayMode=raw', '--showCircularDependencies', '--exitCodeOnCircularDependencies=1']
  if (config?.extensions?.length) argv.push(`--fileExtensions=${config.extensions.join(',')}`)
  for (const glob of config?.ignore ?? []) argv.push(`--ignorePattern=${glob}`)
  if (config?.ignoreTypeImports) argv.push('--no-trackTypeOnlyDependencies')
  return argv
}

/** jscpd argv for `duplicate-code`. Config `paths` and `ignore` replace the defaults rather than adding to them. */
export function duplicateCodeCommand(config: VerifyConfig['duplicateCode'] = loadVerifyConfig().duplicateCode): string[] {
  const paths = config?.paths?.length ? config.paths : DEFAULT_DUPLICATE_PATHS
  const ignore = config?.ignore ?? DEFAULT_DUPLICATE_IGNORE
  return [
    'jscpd',
    '--format',
    'typescript,tsx',
    '--exit-code',
    '1',
    ...ignore.flatMap((glob) => ['--ignore', glob]),
    '-r',
    'consoleFull',
    ...paths,
  ]
}
