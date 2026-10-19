import { describe, expect, it } from 'vitest'
import { AdarError, describeError, errorDetail } from './errors'

describe('describeError', () => {
  it('prefers the friendly message', () => {
    const err = new AdarError({ code: 'DIRTY_WORKTREE', message: 'Your local changes to README.md would be overwritten by merge.', stderr: 'error: Your local changes to the following files would be overwritten by merge:\n\tREADME.md' })
    expect(describeError(err)).toBe('Your local changes to README.md would be overwritten by merge.')
  })
  it('falls back to the important stderr line', () => {
    expect(describeError({ code: 'GIT_FAILED', message: '', stderr: 'hint: x\nfatal: not a git repository' })).toBe('not a git repository')
  })
})

describe('errorDetail', () => {
  it('drops lines that repeat the message and hints', () => {
    const err = new AdarError({ code: 'GIT_FAILED', message: "repository 'x' does not exist", stderr: "fatal: repository 'x' does not exist\nhint: try again" })
    expect(errorDetail(err, err.message)).toBeUndefined()
  })
  it('keeps new information', () => {
    const err = new AdarError({ code: 'GIT_FAILED', message: 'Push rejected', stderr: ' ! [rejected] main -> main (fetch first)\nerror: failed to push some refs' })
    expect(errorDetail(err, err.message)).toBe('! [rejected] main -> main (fetch first)\nerror: failed to push some refs')
  })
  it('hides git text for dirty-worktree errors (the message already lists the files)', () => {
    const err = new AdarError({ code: 'DIRTY_WORKTREE', message: 'Your local changes to README.md would be overwritten by merge.', stderr: 'error: Your local changes to the following files would be overwritten by merge:\n\tREADME.md' })
    expect(errorDetail(err, err.message)).toBeUndefined()
  })
})
