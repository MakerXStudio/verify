/** The outcome of `pnpm --version`, as `captureArgvCommand` returns it. */
type VersionOutput = { code: number; stdout: string; stderr: string }

export type PnpmVersionCheck = { ok: true } | { ok: false; message: string }

const MINIMUM = 'pnpm 11.26+ or 12.4+'
const PIN_ADVICE = 'A `packageManager` or `devEngines` pin in package.json decides which pnpm runs, so bump the pin if there is one.'

function isSupported(major: number, minor: number): boolean {
  if (major === 11) return minor >= 26
  if (major === 12) return minor >= 4
  return major >= 13
}

/** `verifyx init` needs a pnpm where `--allow-build=!<pkg>` works. A pre-release or build suffix is ignored. */
export function checkPnpmVersion({ code, stdout, stderr }: VersionOutput): PnpmVersionCheck {
  if (code !== 0) {
    return { ok: false, message: `verifyx init needs ${MINIMUM}, but \`pnpm --version\` exited ${code}:\n${stderr.trim()}` }
  }
  const raw = stdout.trim()
  const match = /^(\d+)\.(\d+)\.\d+(?:[-+][0-9A-Za-z.+-]*)?$/.exec(raw)
  if (!match) {
    return {
      ok: false,
      message: `verifyx init needs ${MINIMUM}, but could not read a version from \`pnpm --version\`: ${JSON.stringify(raw)}`,
    }
  }
  if (isSupported(Number(match[1]), Number(match[2]))) return { ok: true }
  return { ok: false, message: `verifyx init needs ${MINIMUM}; found pnpm ${raw}. ${PIN_ADVICE}` }
}
