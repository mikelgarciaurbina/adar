import { describe, expect, it } from 'vitest'
import { isMarkdownPath, parseMarkdownArgs } from './markdown'

describe('Markdown files', () => {
  it('knows them by their extension', () => {
    for (const p of ['README.md', '/a/b/PLAN.MD', 'notes.markdown', 'page.mdx', 'C:\\docs\\plan.md']) expect(isMarkdownPath(p)).toBe(true)
    for (const p of ['README', 'a.md.bak', 'a.mdb', 'md', '', null, 42]) expect(isMarkdownPath(p)).toBe(false)
  })

  it('takes the Markdown files a command line starts Adar with, by their full path only', () => {
    expect(parseMarkdownArgs(['/opt/Adar/adar', '--no-sandbox', '/home/me/plan.md', 'relative.md', '/home/me/code', '--open-repo=/x/y.md', '/home/me/plan.md'])).toEqual(['/home/me/plan.md'])
    expect(parseMarkdownArgs(['C:\\Adar\\Adar.exe', 'C:\\docs\\plan.md', '\\\\server\\share\\a.markdown'])).toEqual(['C:\\docs\\plan.md', '\\\\server\\share\\a.markdown'])
    expect(parseMarkdownArgs(['adar', 'file:///home/me/my%20plan.md', 'file://server/share/a.md', 'file:///home/me/a.txt'])).toEqual(['/home/me/my plan.md'])
    // The program itself is never one.
    expect(parseMarkdownArgs(['/tmp/odd.md'])).toEqual([])
  })
})
