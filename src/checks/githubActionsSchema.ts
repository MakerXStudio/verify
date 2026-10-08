import fs from 'node:fs'

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv'

import { pointerSegments } from '../shared/yamlLocation.ts'
import { selectRelevantErrors } from './schemaErrorSelection.ts'

export type SchemaKind = 'workflow' | 'action'

const schemaFileFromPackageRoot: Record<SchemaKind, URL> = {
  workflow: new URL('../../schemas/github-workflow.json', import.meta.url),
  action: new URL('../../schemas/github-action.json', import.meta.url),
}

type LoadedSchema = { root: unknown; validate: ValidateFunction }

const loaded = new Map<SchemaKind, LoadedSchema>()
let ajv: Ajv | undefined

function loadSchema(kind: SchemaKind): LoadedSchema {
  let schema = loaded.get(kind)
  if (!schema) {
    ajv ??= new Ajv({ allErrors: true, strict: false, verbose: true })
    const root: unknown = JSON.parse(fs.readFileSync(schemaFileFromPackageRoot[kind], 'utf-8'))
    schema = { root, validate: ajv.compile(root as object) }
    loaded.set(kind, schema)
  }
  return schema
}

function conflictingRequiredKeys(error: ErrorObject): string[] {
  const passing = (error.params as { passingSchemas?: unknown }).passingSchemas
  if (!Array.isArray(passing) || !Array.isArray(error.schema)) return []
  return passing.flatMap((index: number) => (error.schema as Array<{ required?: string[] }>)[index]?.required ?? [])
}

export function describeError(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>
  if (error.keyword === 'additionalProperties') return `unexpected key "${String(params.additionalProperty)}"`
  const conflicting = error.keyword === 'oneOf' ? conflictingRequiredKeys(error) : []
  if (conflicting.length > 1) return `only one of ${conflicting.map((key) => `"${key}"`).join(', ')} is allowed`
  if (error.keyword === 'enum' && Array.isArray(params.allowedValues)) return `${error.message}: ${params.allowedValues.join(', ')}`
  return (error.message ?? error.keyword).replaceAll('\r', '\\r').replaceAll('\n', '\\n')
}

function dedupe(errors: readonly ErrorObject[]): ErrorObject[] {
  const seen = new Set<string>()
  return errors.filter((error) => {
    const id = `${error.instancePath}\0${describeError(error)}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function validateAgainstSchema(kind: SchemaKind, data: unknown): ErrorObject[] {
  const { root, validate } = loadSchema(kind)
  if (validate(data)) return []
  return dedupe(selectRelevantErrors(validate.errors ?? [], root, describeError))
}

export function readablePath(instancePath: string): string {
  const segments = pointerSegments(instancePath)
  if (segments.length === 0) return '(root)'
  return segments.reduce((acc, segment) => (/^\d+$/.test(segment) ? `${acc}[${segment}]` : acc ? `${acc}.${segment}` : segment), '')
}
