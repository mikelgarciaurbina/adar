// Links in a terminal: the paths of pictures, web pages and PDFs in a line of output, and where a link goes.

import { describe, expect, it } from 'vitest'
import { fileName, findPaths, linkTarget } from './links'

const paths = (line: string) => findPaths(line).map((m) => m.text)

describe('paths in a line of output', () => {
  it('finds them as agents and shells print them', () => {
    // Claude Code and Codex: the path after the link's words, in brackets.
    expect(paths('Read the guide (/tmp/adar-link-test/guide.html), see the screenshot (site/src/assets/review.png).')).toEqual([
      '/tmp/adar-link-test/guide.html',
      'site/src/assets/review.png'
    ])
    expect(paths('Viewed image final-proof.jpg')).toEqual(['final-proof.jpg'])
    expect(paths('Abrir la guía: ~/Projects/alpi/guía-de-subida.HTML y ./out/informe.pdf')).toEqual(['~/Projects/alpi/guía-de-subida.HTML', './out/informe.pdf'])
    // A shell's escaped spaces, a file: URI, a name at the end of a sentence.
    expect(paths('/Users/ana/My\\ Shots/a\\ b.png and file:///tmp/x.webp.')).toEqual(['/Users/ana/My\\ Shots/a\\ b.png', 'file:///tmp/x.webp'])
    // Where each one is, for the terminal to underline it.
    expect(findPaths('see (shot.png)')).toEqual([{ start: 5, end: 13, text: 'shot.png' }])
  })

  it('finds Markdown documents, which Adar previews', () => {
    expect(paths('Plan written to ~/.claude/plans/quiet-fox.md. See also docs/GUIDE.markdown and README.md')).toEqual(['~/.claude/plans/quiet-fox.md', 'docs/GUIDE.markdown', 'README.md'])
    expect(paths('notes.mdx, notes.mdb, a.md/b')).toEqual(['notes.mdx'])
  })

  it('leaves out what is no picture, document, page or PDF, or only looks like one', () => {
    expect(paths('src/main.ts and notes.txt')).toEqual([])
    expect(paths('archive.png.bak, logo.pngx, a.html/b, .png')).toEqual([])
    // Web addresses are links of their own.
    expect(paths('https://adargit.com/og.png http://x.test/a/b.html')).toEqual([])
  })
})

describe('where a link goes', () => {
  const cwd = '/Users/ana/Projects/landing'
  const home = '/Users/ana'
  it('reads a path against the terminal’s folder and the home', () => {
    expect(linkTarget('site/review.png', cwd, home)).toEqual({ kind: 'image', path: '/Users/ana/Projects/landing/site/review.png' })
    expect(linkTarget('../alpi/./ABRIR.html', cwd, home)).toEqual({ kind: 'page', path: '/Users/ana/Projects/alpi/ABRIR.html' })
    expect(linkTarget('~/Desktop/informe.pdf', cwd, home)).toEqual({ kind: 'page', path: '/Users/ana/Desktop/informe.pdf' })
    expect(linkTarget('/Users/ana/My\\ Shots/a\\ b.JPG', cwd, home)).toEqual({ kind: 'image', path: '/Users/ana/My Shots/a b.JPG' })
    expect(linkTarget('file:///tmp/vista%20previa.jpg', cwd, home)).toEqual({ kind: 'image', path: '/tmp/vista previa.jpg' })
    expect(linkTarget('file:///Users/ana/notes.md', cwd, home)).toEqual({ kind: 'markdown', path: '/Users/ana/notes.md' })
    expect(linkTarget('docs/PLAN.MD', cwd, home)).toEqual({ kind: 'markdown', path: '/Users/ana/Projects/landing/docs/PLAN.MD' })
    expect(linkTarget('file:///Users/ana/notes.txt', cwd, home)).toEqual({ kind: 'file', path: '/Users/ana/notes.txt' })
    expect(fileName('/tmp/vista previa.jpg')).toBe('vista previa.jpg')
  })

  it('sends the web to the browser, and leaves what Adar does not open', () => {
    expect(linkTarget('https://adargit.com/roadmap', cwd, home)).toEqual({ kind: 'web', url: 'https://adargit.com/roadmap' })
    expect(linkTarget('mailto:ana@example.com', cwd, home)).toBeNull()
    expect(linkTarget('vscode://file/tmp/a.png', cwd, home)).toBeNull()
    expect(linkTarget('file://server/share/a.png', cwd, home)).toBeNull()
    // Without a folder to read it against, a relative path goes nowhere.
    expect(linkTarget('a.png', '', home)).toBeNull()
    expect(linkTarget('~/a.png', cwd, '')).toBeNull()
  })
})
