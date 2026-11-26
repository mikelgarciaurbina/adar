import { describe, expect, it } from 'vitest'
import { repoReference } from './paths'

describe('repoReference', () => {
  it('reads an address against the document that gives it', () => {
    expect(repoReference('docs/guide.md', 'img/shot.png')).toEqual({ path: 'docs/img/shot.png', anchor: '' })
    expect(repoReference('docs/guide.md', './other.md#set-up')).toEqual({ path: 'docs/other.md', anchor: 'set-up' })
    expect(repoReference('docs/guide.md', '../README.md')).toEqual({ path: 'README.md', anchor: '' })
    expect(repoReference('README.md', 'docs/a%20b.png?raw=true')).toEqual({ path: 'docs/a b.png', anchor: '' })
    expect(repoReference('docs/guide.md', '/assets/logo.svg')).toEqual({ path: 'assets/logo.svg', anchor: '' })
    expect(repoReference('docs/guide.md', '#top')).toEqual({ path: 'docs/guide.md', anchor: 'top' })
  })

  it('refuses the web, other schemes and anything outside the repository', () => {
    for (const ref of ['https://example.com/a.png', 'mailto:me@example.com', 'javascript:alert(1)', 'file:///etc/passwd', '//example.com/a.png', '../../secret.md', '~/notes.md', 'a\\b.md', '', ' ', '..']) {
      expect(repoReference('docs/guide.md', ref)).toBeNull()
    }
  })
})
