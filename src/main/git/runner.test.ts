// Error classification and plain-language messages for common git failures.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyGitError, commandDisplay, dedupeSentences, friendlyMessage, gitError, runGit, stripGitPrefix, summarizeGitOutput } from './runner'

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
    expect(e.message).toBe('Your local changes to conflict.txt, src/values.ts would be overwritten by checkout. Commit, stash or discard them first.')
    expect(e.stderr).toBe(stderr)
  })

  it('summarises long file lists and untracked files', () => {
    const many = ['error: Your local changes to the following files would be overwritten by merge:', '\ta', '\tb', '\tc', '\td', '\te', 'Aborting'].join('\n')
    expect(gitError('git merge', res(many)).message).toBe(
      'Your local changes to a, b, c and 2 more would be overwritten by merge. Commit, stash or discard them first.'
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

  it('lists the files of merge-ort\'s one-line index check (stash apply --index)', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by merge:',
      '  README.md new.txt old.txt',
      'Index was not unstashed.'
    ].join('\n')
    const e = gitError('git stash apply --index stash@{0}', res(stderr, 'On branch main\nChanges not staged for commit:\n\tmodified:   README.md\n'))
    expect(e.code).toBe('DIRTY_WORKTREE')
    expect(e.message).toBe('Your local changes to README.md, new.txt, old.txt would be overwritten by merge. Commit, stash or discard them first.')
    expect(e.message).not.toMatch(/:$|^error/i)
    expect(e.stderr).toBe(stderr)
  })

  it('handles dirty refusals without a file list, and removals of untracked files', () => {
    const pick = gitError(
      'git cherry-pick x',
      res('error: your local changes would be overwritten by cherry-pick.\nhint: commit your changes or stash them to proceed.\nfatal: cherry-pick failed')
    )
    expect(pick.code).toBe('DIRTY_WORKTREE')
    expect(pick.message).toBe('Your local changes would be overwritten by cherry-pick. Commit, stash or discard them first.')
    const removed = gitError(
      'git checkout x',
      res('error: The following untracked working tree files would be removed by checkout:\n\ta.txt\n\tb.txt\nPlease move or remove them before you switch branches.\nAborting')
    )
    expect(removed.message).toBe('Untracked files a.txt, b.txt would be removed by checkout. Move or remove them first.')
  })

  it('does not take file names containing "ssl" for a network error', () => {
    const stderr = 'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/ssl.ts\n\topenssl.cnf\nAborting'
    expect(classifyGitError(stderr)).toBe('DIRTY_WORKTREE')
    expect(classifyGitError("fatal: unable to access 'https://x/': SSL certificate problem: self-signed certificate")).toBe('NETWORK')
    expect(classifyGitError('fatal: gnutls_handshake() failed: Error in the pull function.')).toBe('NETWORK')
  })

  it('makes clean fallback messages: no prefix, no trailing colon, listed entries appended, no repeats', () => {
    const e = gitError(
      'git add x',
      res('The following paths are ignored by one of your .gitignore files:\ndist\nhint: Use -f if you really want to add them.')
    )
    expect(e.message).toBe('The following paths are ignored by one of your .gitignore files')
    expect(summarizeGitOutput('error: The following paths have problems:\n\ta b.txt\n\tc.txt\nfatal: done')).toBe(
      'The following paths have problems: a b.txt, c.txt'
    )
    expect(summarizeGitOutput('hint: only a hint\n\n')).toBeNull()
    // Nothing on stderr: git's stdout explains (e.g. "nothing to commit").
    expect(gitError('git commit', res('', 'On branch main\nnothing to commit, working tree clean\n')).message).toBe('nothing to commit, working tree clean')
    expect(gitError('git x', res('', '', 3)).message).toBe('git exited with code 3')
    expect(stripGitPrefix('error: fatal: boom')).toBe('boom')
    expect(dedupeSentences('Could not apply abc. Could not apply abc. error: could not apply abc.')).toBe('Could not apply abc.')
    expect(dedupeSentences('One.\nTwo. One')).toBe('One.\nTwo.')
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

describe('runGit', () => {
  it('reports a missing working directory as NOT_FOUND (not GIT_NOT_INSTALLED)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'adar-runner-'))
    try {
      writeFileSync(path.join(dir, 'file'), 'x')
      for (const cwd of [path.join(dir, 'gone'), path.join(dir, 'file', 'sub')]) {
        await expect(runGit(['status'], { cwd })).rejects.toMatchObject({ code: 'NOT_FOUND', message: `Repository folder not found: ${cwd}` })
        await expect(runGit(['status'], { cwd, allowFailure: true })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
