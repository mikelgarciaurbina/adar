import { describe, expect, it } from 'vitest'
import { isMarkdownPath } from './markdown'

describe('Markdown files', () => {
  it('knows them by their extension', () => {
    for (const p of ['README.md', '/a/b/PLAN.MD', 'notes.markdown', 'page.mdx', 'C:\\docs\\plan.md']) expect(isMarkdownPath(p)).toBe(true)
    for (const p of ['README', 'a.md.bak', 'a.mdb', 'md', '', null, 42]) expect(isMarkdownPath(p)).toBe(false)
  })
})
