import { describe, expect, it } from 'vitest'

import { checkPnpmVersion } from './pnpmVersion.ts'

const version = (stdout: string) => checkPnpmVersion({ code: 0, stdout, stderr: '' })

describe('checkPnpmVersion', () => {
  it.each(['10.34.7', '11.21.0', '11.25.9', '12.3.4'])('refuses %s with the found version, the minimum and the pin advice', (v) => {
    const check = version(`${v}\n`)
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.message).toContain(`found pnpm ${v}`)
    expect(check.message).toContain('pnpm 11.26+ or 12.4+')
    expect(check.message).toContain('`packageManager` or `devEngines` pin')
  })

  it.each(['11.26.0', '11.28.6', '12.4.0', '12.11.2', '13.0.0'])('accepts %s', (v) => {
    expect(version(`${v}\n`)).toEqual({ ok: true })
  })

  it('parses a version with a pre-release or build suffix', () => {
    expect(version('12.4.0-rc.1\n')).toEqual({ ok: true })
    expect(version('11.26.0+build.5')).toEqual({ ok: true })
    expect(version('12.3.0-rc.1').ok).toBe(false)
  })

  it('refuses unparseable output and shows it', () => {
    const check = version('Downloading pnpm\n')
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.message).toContain('Downloading pnpm')
  })

  it('reports a failed `pnpm --version` with its exit code and stderr', () => {
    const check = checkPnpmVersion({ code: 1, stdout: '', stderr: 'ERR_PNPM_BAD_PM_VERSION  This project is configured to use pnpm@^9\n' })
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.message).toContain('exited 1')
    expect(check.message).toContain('ERR_PNPM_BAD_PM_VERSION')
  })
})
