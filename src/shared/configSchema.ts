type SettingKind = 'number' | 'count' | 'string' | 'boolean' | 'string[]'

const SETTING_CHECKS: Record<SettingKind, { label: string; test: (value: unknown) => boolean }> = {
  number: { label: 'a number', test: (value) => typeof value === 'number' && Number.isFinite(value) },
  count: { label: 'a non-negative integer', test: (value) => Number.isSafeInteger(value) && (value as number) >= 0 },
  string: { label: 'a string', test: (value) => typeof value === 'string' },
  boolean: { label: 'a boolean', test: (value) => typeof value === 'boolean' },
  'string[]': {
    label: 'an array of strings',
    test: (value) => Array.isArray(value) && value.every((item) => typeof item === 'string'),
  },
}

const SECTIONS: Record<string, Record<string, SettingKind>> = {
  complexity: { threshold: 'number', pattern: 'string', ignore: 'string[]' },
  comments: {
    maxLines: 'number',
    pattern: 'string',
    ignore: 'string[]',
    pushback: 'boolean',
    warn: 'boolean',
    blockNewComments: 'boolean',
  },
  unusedCode: { maxWarnings: 'count' },
  duplicateCode: { maxWarnings: 'count', paths: 'string[]', ignore: 'string[]' },
  circularDeps: { extensions: 'string[]', ignore: 'string[]', ignoreTypeImports: 'boolean' },
  hardcodedColors: { ignore: 'string[]', root: 'string' },
}

const FORBIDDEN_STRINGS_RULE: Record<string, SettingKind> = { file: 'string', paths: 'string[]', disallowed: 'string' }

const TOP_LEVEL_KEYS = [...Object.keys(SECTIONS), 'forbiddenStrings']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownKey(key: string, allowed: readonly string[]): string {
  return `unknown key "${key}" (allowed: ${allowed.join(', ')})`
}

function validateSettings(value: unknown, key: string, schema: Record<string, SettingKind>, required: boolean): string[] {
  if (!isPlainObject(value)) return [`"${key}" must be an object`]
  const problems: string[] = []
  for (const name of Object.keys(value)) {
    if (!(name in schema)) problems.push(unknownKey(`${key}.${name}`, Object.keys(schema)))
  }
  for (const [name, kind] of Object.entries(schema)) {
    if (value[name] === undefined && !required) continue
    const check = SETTING_CHECKS[kind]
    if (!check.test(value[name])) problems.push(`"${key}.${name}" must be ${check.label}`)
  }
  return problems
}

function validateForbiddenStrings(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [`"${key}" must be an array of rules`]
  return value.flatMap((rule, index) => validateSettings(rule, `${key}[${index}]`, FORBIDDEN_STRINGS_RULE, true))
}

export function findConfigProblems(config: unknown, keyPrefix = ''): string[] {
  if (!isPlainObject(config)) return [keyPrefix ? `"${keyPrefix.slice(0, -1)}" must be an object` : 'the config must be a JSON object']
  return Object.entries(config).flatMap(([name, value]) => {
    const key = `${keyPrefix}${name}`
    if (name === 'forbiddenStrings') return validateForbiddenStrings(value, key)
    const schema = SECTIONS[name]
    return schema ? validateSettings(value, key, schema, false) : [unknownKey(key, TOP_LEVEL_KEYS)]
  })
}
