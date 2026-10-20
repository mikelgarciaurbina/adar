import { describe, expect, it } from 'vitest'
import { cleanMessage, composeEditedMessage, isSummaryTooLong, joinMessage, splitMessage, stashTitle, summaryLength, SUMMARY_SOFT_LIMIT } from './message'

describe('splitMessage', () => {
  it('splits subject and body separated by a blank line', () => {
    expect(splitMessage('Fix bug\n\nLonger explanation\nsecond line\n')).toEqual({
      summary: 'Fix bug',
      description: 'Longer explanation\nsecond line'
    })
  })

  it('handles single-line and empty messages', () => {
    expect(splitMessage('Only subject\n')).toEqual({ summary: 'Only subject', description: '' })
    expect(splitMessage('')).toEqual({ summary: '', description: '' })
  })

  it('handles a body without a blank separator and CRLF line endings', () => {
    expect(splitMessage('Subject\r\nbody line\r\n')).toEqual({ summary: 'Subject', description: 'body line' })
  })

  it('skips leading blank lines and keeps body indentation', () => {
    expect(splitMessage('\n\n  Subject  \n\n\n  - item\n')).toEqual({ summary: 'Subject', description: '  - item' })
  })
})

describe('joinMessage', () => {
  it('joins with a blank line', () => {
    expect(joinMessage('Subject', 'Body')).toBe('Subject\n\nBody')
  })

  it('omits empty parts', () => {
    expect(joinMessage('Subject', '   \n')).toBe('Subject')
    expect(joinMessage('  ', 'Body only')).toBe('Body only')
    expect(joinMessage('', '')).toBe('')
  })

  it('trims the summary, flattens newlines in it and strips trailing whitespace of the body', () => {
    expect(joinMessage('  Sub\nject ', '\n\nline 1\n  line 2  \n\n')).toBe('Sub ject\n\nline 1\n  line 2')
  })

  it('round-trips with splitMessage', () => {
    const msg = 'Add feature\n\nDetails here\n\nMore details'
    const { summary, description } = splitMessage(msg)
    expect(joinMessage(summary, description)).toBe(msg)
  })
})

describe('summary length', () => {
  it('counts code points and flags summaries over the soft limit', () => {
    expect(summaryLength('héllo 👋')).toBe(7)
    expect(isSummaryTooLong('x'.repeat(SUMMARY_SOFT_LIMIT))).toBe(false)
    expect(isSummaryTooLong('x'.repeat(SUMMARY_SOFT_LIMIT + 1))).toBe(true)
  })
})

describe('stashTitle', () => {
  it('strips the "On <branch>:" prefix of named stashes', () => {
    expect(stashTitle('On main: refactor login')).toBe('refactor login')
    expect(stashTitle('On feature/x: a: b')).toBe('a: b')
  })

  it('shortens automatic WIP stashes', () => {
    expect(stashTitle('WIP on main: 1a2b3c4 Fix the thing')).toBe('WIP: Fix the thing')
    expect(stashTitle('WIP on main: 1a2b3c4')).toBe('WIP: 1a2b3c4')
  })

  it('falls back to the raw message', () => {
    expect(stashTitle('custom message')).toBe('custom message')
    expect(stashTitle('  ')).toBe('Stash')
  })
})

describe('cleanMessage', () => {
  it('normalises whitespace like git stripspace', () => {
    expect(cleanMessage('\n\nSubject  \n\n\n\nBody line \t\r\nnext\n\n')).toBe('Subject\n\nBody line\nnext')
    expect(cleanMessage('a\n\nb')).toBe(cleanMessage('a  \n\n\nb\n'))
    expect(cleanMessage('a\nb')).not.toBe(cleanMessage('a\n\nb'))
  })
})

describe('composeEditedMessage', () => {
  const wrapped = 'Fix the frobnicator crash when\nthe widget is null\n\nDetails with a tpyo.'
  it('keeps a subject that spans lines when only the body changes', () => {
    const { summary, description } = splitMessage(wrapped)
    expect(composeEditedMessage(wrapped, summary, description.replace('tpyo', 'typo'))).toBe(
      'Fix the frobnicator crash when\nthe widget is null\n\nDetails with a typo.'
    )
  })
  it('uses the normal summary/description layout otherwise', () => {
    const { description } = splitMessage(wrapped)
    expect(composeEditedMessage(wrapped, 'New subject', description)).toBe('New subject\n\nthe widget is null\n\nDetails with a tpyo.')
    expect(composeEditedMessage('Subject\n\nBody', 'Subject', 'Body edited')).toBe('Subject\n\nBody edited')
    expect(composeEditedMessage('Subject', 'Subject', 'New body')).toBe('Subject\n\nNew body')
  })
})
