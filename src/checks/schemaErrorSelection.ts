import type { ErrorObject } from 'ajv'

import { pointerSegments } from '../shared/yamlLocation.ts'

type Schema = unknown
type SchemaObject = Record<string, Schema>

const KIND_MISMATCH_KEYWORDS = new Set(['type', 'const', 'enum', 'pattern'])
const SAME_INSTANCE_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else']

const isObject = (value: unknown): value is SchemaObject => !!value && typeof value === 'object'
const asList = (value: Schema): Schema[] => (Array.isArray(value) ? value : value === undefined ? [] : [value])
const escapeSegment = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1')

function resolveLocalRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith('#')) return undefined
  return pointerSegments(decodeURIComponent(ref.slice(1))).reduce<Schema>(
    (node, segment) => (isObject(node) ? node[segment] : undefined),
    root,
  )
}

function matchesPattern(pattern: string, key: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(key)
  } catch {
    return false
  }
}

function childInstances(schema: SchemaObject, data: unknown): Array<{ schema: Schema; data: unknown; segment: string }> {
  if (Array.isArray(data))
    return data.flatMap((item, i) => asList(schema.items).map((items) => ({ schema: items, data: item, segment: String(i) })))
  if (!isObject(data)) return []
  const properties = isObject(schema.properties) ? schema.properties : {}
  const patterns = Object.entries(isObject(schema.patternProperties) ? schema.patternProperties : {})
  return Object.entries(data).flatMap(([key, value]) => {
    const matched = [properties[key], ...patterns.filter(([pattern]) => matchesPattern(pattern, key)).map(([, s]) => s)]
    const dependency = isObject(schema.dependencies) ? schema.dependencies[key] : undefined
    return [...matched, schema.additionalProperties]
      .filter(isObject)
      .map((child) => ({ schema: child, data: value, segment: escapeSegment(key) }))
      .concat(isObject(dependency) ? [{ schema: dependency, data, segment: '' }] : [])
  })
}

function collectApplications(schema: Schema, data: unknown, instancePath: string, root: Schema, out: Map<object, Set<string>>): void {
  if (!isObject(schema)) return
  const paths = out.get(schema) ?? new Set<string>()
  if (paths.has(instancePath)) return
  out.set(schema, paths.add(instancePath))
  const sameInstance = [
    typeof schema.$ref === 'string' ? resolveLocalRef(root, schema.$ref) : undefined,
    ...SAME_INSTANCE_KEYWORDS.flatMap((k) => asList(schema[k])),
  ]
  for (const sub of sameInstance) collectApplications(sub, data, instancePath, root, out)
  for (const child of childInstances(schema, data)) {
    collectApplications(child.schema, child.data, child.segment ? `${instancePath}/${child.segment}` : instancePath, root, out)
  }
}

function branchApplications(branch: Schema, combinator: ErrorObject, root: Schema): Map<object, Set<string>> {
  const applications = new Map<object, Set<string>>()
  collectApplications(branch, combinator.data, combinator.instancePath, root, applications)
  return applications
}

function groupByBranch(combinator: ErrorObject, errors: ErrorObject[], root: Schema) {
  const branches = asList(combinator.schema).map((branch) => branchApplications(branch, combinator, root))
  const groups: ErrorObject[][] = branches.map(() => [])
  const unassigned: ErrorObject[] = []
  let branchIndex = 0
  const owns = (index: number, error: ErrorObject) => !!branches[index]?.get(error.parentSchema as object)?.has(error.instancePath)
  for (const error of errors) {
    let index = branchIndex
    while (index < branches.length && !owns(index, error)) index++
    if (index === branches.length) {
      unassigned.push(error)
      continue
    }
    branchIndex = index
    groups[index]?.push(error)
  }
  return { groups: groups.filter((group) => group.length > 0), unassigned }
}

const depth = (error: ErrorObject) => pointerSegments(error.instancePath).length

const branchScore = (group: ErrorObject[]) => [
  group.filter((error) => error.keyword === 'const').length,
  group.length,
  -Math.max(...group.map(depth)),
]

function isBetterScore(score: number[], best: number[]): boolean {
  const index = score.findIndex((value, i) => value !== best[i])
  return index >= 0 && (score[index] as number) < (best[index] as number)
}

const closestBranch = (branches: ErrorObject[][]): ErrorObject[] =>
  branches.reduce((best, group) => (isBetterScore(branchScore(group), branchScore(best)) ? group : best))

function pickBranchErrors(
  combinator: ErrorObject,
  errors: ErrorObject[],
  root: Schema,
  describe: (e: ErrorObject) => string,
): ErrorObject[] {
  const { groups, unassigned } = groupByBranch(combinator, errors, root)
  if (groups.length === 0) return [...unassigned, combinator]
  const isKindMismatch = (error: ErrorObject) => KIND_MISMATCH_KEYWORDS.has(error.keyword) && error.instancePath === combinator.instancePath
  const fitting = groups.filter((group) => !group.some(isKindMismatch))
  if (fitting.length > 0) return [...unassigned, ...closestBranch(fitting)]
  const alternatives = [...new Set(groups.flat().filter(isKindMismatch).map(describe))]
  return [...unassigned, { ...combinator, keyword: 'alternatives', message: alternatives.join(', or ') }]
}

const isAtOrBelow = (error: ErrorObject, instancePath: string) =>
  error.instancePath === instancePath || error.instancePath.startsWith(`${instancePath}/`)

export function selectRelevantErrors(errors: readonly ErrorObject[], root: Schema, describe: (e: ErrorObject) => string): ErrorObject[] {
  const selected: ErrorObject[] = []
  for (const error of errors) {
    if (error.keyword !== 'oneOf' && error.keyword !== 'anyOf') {
      selected.push(error)
      continue
    }
    let start = selected.length
    while (start > 0 && isAtOrBelow(selected[start - 1] as ErrorObject, error.instancePath)) start--
    selected.push(...pickBranchErrors(error, selected.splice(start), root, describe))
  }
  return selected
}
