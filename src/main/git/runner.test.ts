// Error classification and plain-language messages for common git failures.
import { describe, expect, it } from 'vitest'
import { classifyGitError, commandDisplay, friendlyMessage, gitError } from './runner'

const res = (stderr: string, stdout = '', code = 1) => ({ stderr, stdout, code })

describe('gitError', () => {
  it('lists the files blocking a checkout and keeps the raw stderr', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\tconflict.txt',
      '\tsrc/values.ts',
      'Please commit your changes or stash them before you switch branches.',
      'Aborting'
    ].join('\n')
    const e = gitError('git checkout x', res(stderr))
    expect(e.code).toBe('DIRTY_WORKTREE')
    expect(e.message).toBe('Your local changes to conflict.txt and src/values.ts would be overwritten by checkout. Commit, stash or discard them first.')
    expect(e.stderr).toBe(stderr)
  })

  it('summarises long file lists and untracked files', () => {
    const many = ['error: Your local changes to the following files would be overwritten by merge:', '\ta', '\tb', '\tc', '\td', 'Aborting'].join('\n')
    expect(gitError('git merge', res(many)).message).toBe(
      'Your local changes to a, b and 2 more would be overwritten by merge. Commit, stash or discard them first.'
    )
    const untracked = [
      'error: The following untracked working tree files would be overwritten by checkout:',
      '\tnew.txt',
      'Please move or remove them before you switch branches.'
    ].join('\n')
    const e = gitError('git checkout', res(untracked))
    expect(e.code).toBe('DIRTY_WORKTREE')
    expect(e.message).toBe('Untracked file new.txt would be overwritten by checkout. Move or remove it first.')
  })

  it('explains authentication and network failures', () => {
    expect(gitError('git fetch', res("fatal: Authentication failed for 'https://github.com/me/private.git/'")).message).toBe(
      'Authentication failed for github.com. Check your username and password or access token.'
    )
    const pk = gitError('git fetch', res('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'))
    expect(pk.code).toBe('AUTH_FAILED')
    expect(pk.message).toMatch(/^SSH authentication failed/)
    const noCreds = gitError('git fetch', res("fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled"))
    expect(noCreds.message).toBe('Authentication required for gitlab.com: no credentials were provided.')
    const dns = gitError('git fetch', res("fatal: unable to access 'https://adar-qa.invalid/repo.git/': Could not resolve host: adar-qa.invalid"))
    expect(dns.code).toBe('NETWORK')
    expect(dns.message).toBe('Could not reach adar-qa.invalid. Check your network connection.')
    const refused = gitError('git fetch', res("fatal: unable to access 'http://127.0.0.1:9/x.git/': Failed to connect to 127.0.0.1 port 9: Connection refused"))
    expect(refused.message).toBe('Could not connect to http://127.0.0.1:9/x.git. Check your network connection.')
  })

  it('explains rejected pushes while keeping the "rejected" text for the UI', () => {
    const stderr = [
      'To /srv/origin.git',
      ' ! [rejected]        main -> main (fetch first)',
      "error: failed to push some refs to '/srv/origin.git'",
      'hint: Updates were rejected because the remote contains work that you do not'
    ].join('\n')
    const e = gitError('git push', res(stderr))
    expect(e.code).toBe('GIT_FAILED')
    expect(e.message).toBe('Push rejected: the remote branch has commits you do not have. Pull first, or force push.')
    expect(e.stderr).toContain('[rejected]')
    const hook = gitError('git push', res(" ! [remote rejected] main -> main (protected branch hook declined)\nerror: failed to push some refs to 'x'"))
    expect(hook.message).toBe('The remote rejected the push: protected branch hook declined.')
  })

  it('explains stale locks, missing identity, signing and vanished upstreams', () => {
    expect(
      gitError('git commit', res("fatal: Unable to create '/r/.git/index.lock': File exists.\n\nAnother git process seems to be running")).message
    ).toBe('Another Git process seems to be running in this repository (.git/index.lock exists). If none is running, delete that file and try again.')
    expect(gitError('git commit', res('Author identity unknown\n\n*** Please tell me who you are.\nfatal: unable to auto-detect email address')).message).toMatch(
      /^Git needs your name and email/
    )
    expect(gitError('git commit', res('error: gpg failed to sign the data\nfatal: failed to write commit object')).message).toMatch(/^Signing the commit failed/)
    expect(gitError('git pull', res("Your configuration specifies to merge with the ref 'refs/heads/x'\nfrom the remote, but no such ref was fetched.")).message).toMatch(
      /^The upstream branch no longer exists/
    )
  })

  it('falls back to git\'s first error line', () => {
    const e = gitError('git branch', res("fatal: a branch named 'x' already exists"))
    expect(e.message).toBe("a branch named 'x' already exists")
    expect(friendlyMessage('GIT_FAILED', 'fatal: something else')).toBeNull()
  })

  it('classifies dirty worktrees before conflicts', () => {
    expect(classifyGitError('error: Your local changes to the following files would be overwritten by checkout:\n\tconflict.txt')).toBe('DIRTY_WORKTREE')
    expect(classifyGitError('CONFLICT (content): Merge conflict in a.txt')).toBe('CONFLICT')
  })
})

describe('commandDisplay', () => {
  it('hides credentials embedded in URLs', () => {
    expect(commandDisplay(['clone', '--', 'https://me:ghp_secret@github.com/me/x.git', '/tmp/x'])).toBe('git clone -- https://***@github.com/me/x.git /tmp/x')
    expect(commandDisplay(['fetch', 'origin'])).toBe('git fetch origin')
  })
})
