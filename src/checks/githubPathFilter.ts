const FILTERED_EVENTS = ['push', 'pull_request', 'pull_request_target'] as const
const FILTER_KEYS = ['paths', 'paths-ignore'] as const

export type DeadPathFilter = { instancePath: string; glob: string }

function escapeRegex(char: string): string {
  return /[\\^$.|?*+()[\]{}/]/.test(char) ? `\\${char}` : char
}

function githubFilterToRegex(pattern: string): RegExp {
  const tokens: string[] = []
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] as string
    const previous = tokens.at(-1)
    if (char === '\\' && i + 1 < pattern.length) {
      tokens.push(escapeRegex(pattern[++i] as string))
    } else if (char === '*') {
      const double = pattern[i + 1] === '*'
      if (!double) {
        tokens.push('[^/]*')
      } else if (pattern[i + 2] === '/') {
        tokens.push('(?:.*/)?')
        i += 2
      } else {
        tokens.push('.*')
        i++
      }
    } else if ((char === '?' || char === '+') && previous !== undefined && !previous.endsWith('*')) {
      tokens[tokens.length - 1] = `(?:${previous})${char}`
    } else if (char === '[' && pattern.indexOf(']', i + 1) > i + 1) {
      const end = pattern.indexOf(']', i + 1)
      const members = Array.from(pattern.slice(i + 1, end), (member) => (member === '-' ? member : escapeRegex(member))).join('')
      tokens.push(`[${members}]`)
      i = end
    } else {
      tokens.push(escapeRegex(char))
    }
  }
  return new RegExp(`^${tokens.join('')}$`)
}

function globsMatchingNothing(patterns: unknown[], files: readonly string[]): Array<{ index: number; glob: string }> {
  const dead: Array<{ index: number; glob: string }> = []
  const positives: RegExp[] = []
  patterns.forEach((glob, index) => {
    if (typeof glob !== 'string' || glob.includes('${{')) return
    const negated = glob.startsWith('!')
    const regex = githubFilterToRegex(negated ? glob.slice(1) : glob)
    const candidates = negated ? files.filter((file) => positives.some((positive) => positive.test(file))) : files
    if (!candidates.some((file) => regex.test(file))) dead.push({ index, glob })
    if (!negated) positives.push(regex)
  })
  return dead
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export function findDeadPathFilters(workflow: unknown, files: readonly string[]): DeadPathFilter[] {
  const on = asRecord(asRecord(workflow)?.on)
  if (!on) return []
  return FILTERED_EVENTS.flatMap((event) =>
    FILTER_KEYS.flatMap((key) => {
      const raw = asRecord(on[event])?.[key]
      const patterns = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
      const pointer = `/on/${event}/${key}`
      return globsMatchingNothing(patterns, files).map(({ index, glob }) => ({
        instancePath: Array.isArray(raw) ? `${pointer}/${index}` : pointer,
        glob,
      }))
    }),
  )
}
