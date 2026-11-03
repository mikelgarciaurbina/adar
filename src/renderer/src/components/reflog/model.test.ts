import { describe, expect, it } from 'vitest'
import type { LostCommit, LostGroup } from '@shared/types'
import { groupDetail, groupOf, groupTitle, keptText, moveDetail, moveTarget, recoveredName, rewrittenText, splitGroups } from './model'

const sha = (c: string) => c.repeat(40)
const commit = (c: string, subject = `Commit ${c}`): LostCommit => ({ sha: sha(c), parents: [], subject, author: 'Ane', email: 'ane@x', date: 1 })
const group = (p: Partial<LostGroup>): LostGroup => ({
  kind: 'reset',
  branch: 'main',
  date: 1,
  move: 'reset: moving to HEAD~3',
  to: sha('7'),
  commits: [commit('a'), commit('b'), commit('c')],
  daysLeft: 30,
  canMoveBack: true,
  canRestore: false,
  ...p
})

describe('reflog words', () => {
  it('says what left each group behind', () => {
    expect(groupTitle(group({}))).toBe('main moved back 3 commits')
    expect(groupDetail(group({}))).toBe('From aaaaaaa to 7777777 (reset to HEAD~3)')
    expect(groupDetail(group({ move: `reset: moving to ${sha('7')}` }))).toBe('From aaaaaaa to 7777777')

    const deleted = group({ kind: 'deleted', branch: 'feat/old-cards', move: 'checkout: moving from feat/old-cards to main', commits: [commit('e')] })
    expect(groupTitle(deleted)).toBe('feat/old-cards was deleted with 1 commit')
    expect(groupDetail(deleted)).toBe('Its last commit, eeeeeee, was checked out before you left it for main')

    const detached = group({ kind: 'detached', branch: null, move: `checkout: moving from ${sha('3')} to main`, commits: [commit('3')] })
    expect(groupTitle(detached)).toBe('1 commit made on a detached HEAD')
    expect(groupDetail(detached)).toBe('Then you checked out main')

    expect(groupTitle(group({ kind: 'rewritten', commits: [commit('f')] }))).toBe('An old version of a commit you rewrote')
    expect(groupDetail(group({ kind: 'rewritten', move: 'commit (amend): Fix' }))).toBe('Amended: the new version is on the branch')
    expect(groupDetail(group({ kind: 'other', move: '' }))).toBe('No reflog says what left it behind')
    expect(moveTarget('checkout: moving from refs/heads/a to refs/heads/b')).toBe('b')
    expect(moveTarget('commit: x')).toBeNull()
  })

  it('says what a move did without repeating the subject', () => {
    expect(moveDetail({ kind: 'commit', detail: 'Fix', subject: 'Fix' })).toBe('new commit')
    expect(moveDetail({ kind: 'amend', detail: 'Fix', subject: 'Fix' })).toBe('amended')
    expect(moveDetail({ kind: 'reset', detail: 'moving to HEAD~3', subject: 'Release' })).toBe('moving to HEAD~3')
    expect(moveDetail({ kind: 'merge', detail: 'feat: Fast-forward', subject: 'feat: Fast-forward' })).toBe('feat: Fast-forward')
  })

  it('says how long git keeps them', () => {
    expect(keptText(24)).toBe('kept 24 more days')
    expect(keptText(1)).toBe('kept 1 more day')
    expect(keptText(0)).toBe('git may forget them at its next cleanup')
    expect(keptText(null)).toBeNull()
  })

  it('names a recovered branch after its commit, free in the repository', () => {
    expect(recoveredName({ sha: sha('a'), subject: 'Cards: remember the last one used' }, new Set())).toBe('recovered/cards-remember-the-last-one-used')
    expect(recoveredName({ sha: sha('a'), subject: 'Fix card icon size' }, new Set(['recovered/fix-card-icon-size']))).toBe('recovered/fix-card-icon-size-2')
    expect(recoveredName({ sha: sha('a'), subject: 'Añadir sesión ✨' }, new Set())).toBe('recovered/anadir-sesion')
    expect(recoveredName({ sha: sha('a'), subject: '!!!' }, new Set())).toBe('recovered/aaaaaaa')
    expect(recoveredName({ sha: sha('a'), subject: 'x'.repeat(80) }, new Set())).toBe(`recovered/${'x'.repeat(40)}`)
  })

  it('folds rewritten groups away and finds a commit’s group', () => {
    const groups = [group({}), group({ kind: 'rewritten', commits: [commit('f')] })]
    expect(splitGroups(groups)).toEqual({ shown: [groups[0]], rewritten: [groups[1]] })
    expect(rewrittenText(1)).toBe('1 old version of a commit you amended or rebased')
    expect(rewrittenText(6)).toBe('6 old versions of commits you amended or rebased')
    expect(groupOf(groups, sha('f'))).toBe(groups[1])
    expect(groupOf(groups, sha('9'))).toBeUndefined()
  })
})
