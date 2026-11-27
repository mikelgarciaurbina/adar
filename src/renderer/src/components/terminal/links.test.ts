// Links in a terminal: the paths of pictures, documents, web pages, PDFs and files of text or code in a line of
// output, and where a link goes.

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

  it('finds files of text and code, with the line a program writes after them', () => {
    expect(paths('Edited src/main/index.ts:120 and src/renderer/App.tsx:41:7, see package.json.')).toEqual(['src/main/index.ts:120', 'src/renderer/App.tsx:41:7', 'package.json'])
    expect(paths('error in ./lib/util.py:8: unexpected indent')).toEqual(['./lib/util.py:8'])
    expect(paths('Update .env and config/.env.local, then the Dockerfile (docker/Dockerfile) and the Makefile')).toEqual(['.env', 'config/.env.local', 'Dockerfile', 'docker/Dockerfile', 'Makefile'])
    expect(paths('a.c b.h c.cpp d.rs e.go f.yml g.yaml h.toml i.sql notes.txt')).toEqual(['a.c', 'b.h', 'c.cpp', 'd.rs', 'e.go', 'f.yml', 'g.yaml', 'h.toml', 'i.sql', 'notes.txt'])
    // Where each one is, with its line, for the terminal to underline it.
    expect(findPaths('at (src/a.ts:12)')).toEqual([{ start: 4, end: 15, text: 'src/a.ts:12' }])
  })

  it('leaves out what Adar opens nothing for, or what only looks like a file', () => {
    expect(paths('archive.zip, movie.mp4 and a font.woff2')).toEqual([])
    expect(paths('archive.png.bak, logo.pngx, a.html/b, .png, main.tsz, a.ts/b')).toEqual([])
    expect(paths('myDockerfile, the.environment, x.envy, Makefiles')).toEqual([])
    // Versions, sentences and addresses are no files.
    expect(paths('v1.2.3 e.g. this. node:18 example.com 10.0.0.1:8080')).toEqual([])
    // Web addresses are links of their own.
    expect(paths('https://adargit.com/og.png http://x.test/a/b.html https://x.test/src/app.js:12')).toEqual([])
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
    expect(linkTarget('file:///Users/ana/movie.mp4', cwd, home)).toEqual({ kind: 'file', path: '/Users/ana/movie.mp4' })
    expect(fileName('/tmp/vista previa.jpg')).toBe('vista previa.jpg')
  })

  it('opens a file of text or code to edit, at the line written after it', () => {
    expect(linkTarget('src/main.ts', cwd, home)).toEqual({ kind: 'code', path: '/Users/ana/Projects/landing/src/main.ts' })
    expect(linkTarget('src/main.ts:120', cwd, home)).toEqual({ kind: 'code', path: '/Users/ana/Projects/landing/src/main.ts', line: 120 })
    expect(linkTarget('./src/App.tsx:41:7', cwd, home)).toEqual({ kind: 'code', path: '/Users/ana/Projects/landing/src/App.tsx', line: 41, column: 7 })
    expect(linkTarget('~/.zshrc.sh', cwd, home)).toEqual({ kind: 'code', path: '/Users/ana/.zshrc.sh' })
    expect(linkTarget('.env', cwd, home)).toEqual({ kind: 'code', path: '/Users/ana/Projects/landing/.env' })
    expect(linkTarget('config/.env.local', cwd, home)).toEqual({ kind: 'code', path: '/Users/ana/Projects/landing/config/.env.local' })
    expect(linkTarget('docker/Dockerfile', cwd, home)).toEqual({ kind: 'code', path: '/Users/ana/Projects/landing/docker/Dockerfile' })
    expect(linkTarget('file:///Users/ana/notes.txt', cwd, home)).toEqual({ kind: 'code', path: '/Users/ana/notes.txt' })
    // A line after a document or a picture is not part of its name either.
    expect(linkTarget('docs/PLAN.md:12', cwd, home)).toEqual({ kind: 'markdown', path: '/Users/ana/Projects/landing/docs/PLAN.md' })
    // What only ends in digits is a file of that name.
    expect(linkTarget('/tmp/out:12', cwd, home)).toEqual({ kind: 'file', path: '/tmp/out:12' })
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
