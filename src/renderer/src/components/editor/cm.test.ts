// CodeMirror as Adar uses it, where no page is needed: a state made from a file's text, the text replaced by what is
// on disk, going to a line, counting what a search finds, and which language colours a file.

import { describe, expect, it } from 'vitest'
import { countMatches, createState, languageOf, replaceText, selectedWord, withCursor } from './cm'
import type { FindOptions } from './model'

const state = (text: string) => createState(text, { indent: { tabs: false, size: 2 }, readOnly: false, wrap: false })
const find = (over: Partial<FindOptions>): FindOptions => ({ text: '', replace: '', matchCase: false, regexp: false, wholeWord: false, ...over })

describe('a file’s text in the editor', () => {
  it('holds every line ending as one line break, and gives the text back', () => {
    const s = state('one\r\ntwo\r\nthree\n')
    expect(s.doc.lines).toBe(4)
    expect(s.doc.toString()).toBe('one\ntwo\nthree\n')
  })

  it('can be read but not changed when the file is not to be written', () => {
    expect(createState('x', { indent: { tabs: true, size: 4 }, readOnly: true, wrap: true }).readOnly).toBe(true)
    expect(state('x').readOnly).toBe(false)
  })

  it('goes to a line and column, inside the text whatever is asked', () => {
    const s = state('first\nsecond line\nthird\n')
    const at = (line: number, column?: number) => withCursor(s, line, column).selection.main.head
    expect(at(2)).toBe(6)
    expect(at(2, 4)).toBe(9)
    // Past the end of the line, past the end of the file, before its start.
    expect(at(2, 99)).toBe(17)
    expect(at(99)).toBe(s.doc.length)
    expect(at(0)).toBe(0)
    expect(at(-3, -3)).toBe(0)
  })
})

describe('replacing the text with what is on disk', () => {
  it('changes only what differs, so the cursor stays where it was', () => {
    const s = withCursor(state('alpha\nbeta\ngamma\ndelta\n'), 4, 3)
    const tr = replaceText(s, 'alpha\nBETA and more\ngamma\ndelta\n')
    expect(tr.state.doc.toString()).toBe('alpha\nBETA and more\ngamma\ndelta\n')
    // One change, in the second line only.
    const changed: Array<[number, number, string]> = []
    tr.changes.iterChanges((from, to, _a, _b, inserted) => changed.push([from, to, inserted.toString()]))
    expect(changed).toEqual([[6, 10, 'BETA and more']])
    // The cursor is still on "delta", third column.
    const line = tr.state.doc.lineAt(tr.state.selection.main.head)
    expect([line.number, tr.state.selection.main.head - line.from + 1]).toEqual([4, 3])
  })

  it('takes Windows line endings as the editor holds them, and does nothing for the same text', () => {
    const s = state('one\ntwo\n')
    expect(replaceText(s, 'one\r\ntwo\r\n').changes.empty).toBe(true)
    expect(replaceText(s, 'one\r\n2\r\n').state.doc.toString()).toBe('one\n2\n')
  })

  it('handles text that grew, shrank or was emptied', () => {
    expect(replaceText(state('abc'), 'abcabc').state.doc.toString()).toBe('abcabc')
    expect(replaceText(state('abcabc'), 'abc').state.doc.toString()).toBe('abc')
    expect(replaceText(state('abc'), '').state.doc.toString()).toBe('')
    expect(replaceText(state(''), 'abc').state.doc.toString()).toBe('abc')
    expect(replaceText(state('aXa'), 'aa').state.doc.toString()).toBe('aa')
  })
})

describe('what a search finds', () => {
  const s = state('const user = getUser()\nUser.name // the user\nusername\n')

  it('is counted, whatever the case unless asked', () => {
    expect(countMatches(s, find({ text: 'user' }))).toEqual({ total: 5, current: 0, more: false })
    expect(countMatches(s, find({ text: 'user', matchCase: true }))).toEqual({ total: 3, current: 0, more: false })
    expect(countMatches(s, find({ text: 'user', wholeWord: true }))).toEqual({ total: 3, current: 0, more: false })
    expect(countMatches(s, find({ text: 'user', wholeWord: true, matchCase: true }))).toEqual({ total: 2, current: 0, more: false })
    expect(countMatches(s, find({ text: '' })).total).toBe(0)
    expect(countMatches(s, find({ text: 'nothing like it' })).total).toBe(0)
  })

  it('reads a regular expression, and counts none for one that is not', () => {
    // user, (get)User, User, user: not the start of "username".
    expect(countMatches(s, find({ text: 'u\\w+r\\b', regexp: true })).total).toBe(4)
    expect(countMatches(s, find({ text: 'u\\w+r\\b', regexp: true, matchCase: true })).total).toBe(2)
    expect(countMatches(s, find({ text: '(', regexp: true }))).toEqual({ total: 0, current: 0, more: false })
    // Text is text: a bracket is looked for as it is.
    expect(countMatches(s, find({ text: '()' })).total).toBe(1)
  })

  it('says which one the selection is on, and stops counting at the limit', () => {
    const on = s.update({ selection: { anchor: 6, head: 10 } }).state
    expect(countMatches(on, find({ text: 'user' }))).toEqual({ total: 5, current: 1, more: false })
    expect(countMatches(s, find({ text: 'user' }), 2)).toEqual({ total: 2, current: 0, more: true })
  })

  it('starts from the word selected, when it is one', () => {
    expect(selectedWord(s.update({ selection: { anchor: 6, head: 10 } }).state)).toBe('user')
    expect(selectedWord(s)).toBe('')
    expect(selectedWord(s.update({ selection: { anchor: 0, head: 30 } }).state)).toBe('')
  })
})

describe('the language that colours a file', () => {
  it('is known by the file’s name', async () => {
    for (const name of ['main.ts', 'App.tsx', 'index.mjs', 'types.d.cts', 'package.json', 'tsconfig.jsonc', 'style.scss', 'page.astro', 'notes.mdx', 'script.py', 'main.rs', 'main.go', 'config.yml', 'Cargo.toml', 'Dockerfile', 'query.sql', 'run.sh']) {
      expect(await languageOf(name), name).not.toBeNull()
    }
  })

  it('is Adar’s own for settings written as KEY=value, and a shell’s for lists of patterns', async () => {
    for (const name of ['.env', '.env.local', 'prod.env', '.npmrc', 'setup.cfg', 'php.ini', '.gitignore', '.dockerignore', '.zshrc']) {
      expect(await languageOf(name), name).not.toBeNull()
    }
  })

  it('is none for a file Adar knows nothing of: it is plain text', async () => {
    expect(await languageOf('notes.txt')).toBeNull()
    expect(await languageOf('LICENSE')).toBeNull()
    expect(await languageOf('data.unknownext')).toBeNull()
  })
})
