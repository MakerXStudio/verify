import { isMap, isScalar, isSeq, LineCounter, type Node, parseDocument } from 'yaml'

export type YamlPosition = { line: number; col: number }

export type ParsedYaml = {
  data: unknown
  errors: Array<{ message: string; position?: YamlPosition }>
  locateNearest: (instancePath: string, key?: string) => YamlPosition | undefined
}

export function pointerSegments(instancePath: string): string[] {
  if (!instancePath) return []
  return instancePath
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function child(node: unknown, segment: string): { key?: Node; value?: Node } | undefined {
  if (isMap(node)) {
    const pair = node.items.find((item) => isScalar(item.key) && String(item.key.value) === segment)
    return pair ? { key: pair.key as Node, value: (pair.value ?? undefined) as Node | undefined } : undefined
  }
  if (isSeq(node)) {
    const item = node.items[Number(segment)]
    return item ? { value: item as Node } : undefined
  }
  return undefined
}

function findNearestNode(root: unknown, segments: string[], key?: string): Node | undefined {
  let current = root as Node | undefined
  for (const segment of segments) {
    const next = child(current, segment)
    if (!next?.value) return next?.key ?? current
    current = next.value
  }
  return (key === undefined ? undefined : child(current, key)?.key) ?? current
}

export function parseYaml(text: string): ParsedYaml {
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { lineCounter })
  const toPosition = (offset: number): YamlPosition => lineCounter.linePos(offset)
  return {
    data: doc.errors.length ? undefined : doc.toJS({ maxAliasCount: -1 }),
    errors: doc.errors.map((error) => ({
      message: (error.message.split('\n')[0] ?? error.message).replace(/ at line \d+, column \d+:?$/, ''),
      position: toPosition(error.pos[0]),
    })),
    locateNearest: (instancePath, key) => {
      const range = findNearestNode(doc.contents, pointerSegments(instancePath), key)?.range
      return range ? toPosition(range[0]) : undefined
    },
  }
}
