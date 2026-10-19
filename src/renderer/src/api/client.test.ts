// Dev bridge token handoff: the browser page reads the token from the URL fragment printed by `npm run web`.
import { describe, expect, it } from 'vitest'
import { tokenFromHash } from './client'

describe('tokenFromHash', () => {
  it('reads #t=<token> (alone or among other fragment parameters)', () => {
    expect(tokenFromHash('#t=abc123')).toBe('abc123')
    expect(tokenFromHash('#x=1&t=abc%20d')).toBe('abc d')
    expect(tokenFromHash('')).toBeNull()
    expect(tokenFromHash('#t=')).toBeNull()
    expect(tokenFromHash('#at=abc')).toBeNull()
    expect(tokenFromHash('#t=%E0%A4%A')).toBeNull()
  })
})
