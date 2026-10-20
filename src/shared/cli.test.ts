import { describe, expect, it } from 'vitest'
import { parseOpenRepoArgs } from './cli'

describe('parseOpenRepoArgs', () => {
  it('honours only explicit absolute --open-repo= arguments', () => {
    expect(
      parseOpenRepoArgs([
        '/Applications/Adar.app/Contents/MacOS/Adar',
        '--open-repo=/Users/me/code/app',
        '-psn_0_12345',
        '/Users/me/other',
        '--open-repo=relative/path',
        '--open-repo=',
        '--open-repo=/Users/me/code/app'
      ])
    ).toEqual(['/Users/me/code/app'])
  })
  it('accepts paths with spaces and Windows drive paths', () => {
    expect(parseOpenRepoArgs(['--open-repo=/Users/me/My Repo', '--open-repo=C:\\code\\x'])).toEqual(['/Users/me/My Repo', 'C:\\code\\x'])
  })
})
