import { describe, expect, it } from 'vitest'
import type { Commit } from '@shared/types'
import {
  actionForKey,
  buildTodo,
  computeGroups,
  customGroupMessage,
  defaultGroupMessage,
  dropTargetTodoIndex,
  fullMessage,
  groupMessage,
  initialEntries,
  isModified,
  moveEntry,
  resultCount,
  setAction,
  setGroupMessage,
  setMessage,
  summarize,
  toDisplayIndex,
  validateRebase,
  type RebaseEntry
} from './rebaseModel'

function commit(n: number, body = ''): Commit {
  const sha = String(n).repeat(40).slice(0, 40)
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents: [],
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    authorDate: 1_700_000_000 + n,
    committerName: 'Ada',
    committerEmail: 'ada@example.com',
    committerDate: 1_700_000_000 + n,
    subject: `subject ${n}`,
    body
  }
}

/** Oldest first, like getRebaseCommits. */
const COMMITS = [commit(1), commit(2, 'body two'), commit(3), commit(4), commit(5)]

function withActions(actions: Array<RebaseEntry['action']>): RebaseEntry[] {
  let e = initialEntries(COMMITS.slice(0, actions.length))
  actions.forEach((a, i) => (e = setAction(e, i, a)))
  return e
}

describe('basics', () => {
  it('starts with every commit picked, in todo order', () => {
    const e = initialEntries(COMMITS)
    expect(e.map((x) => x.action)).toEqual(['pick', 'pick', 'pick', 'pick', 'pick'])
    expect(e.map((x) => x.commit.sha)).toEqual(COMMITS.map((c) => c.sha))
    expect(isModified(e, COMMITS)).toBe(false)
  })

  it('maps shortcut keys', () => {
    expect(actionForKey('p')).toBe('pick')
    expect(actionForKey('R')).toBe('reword')
    expect(actionForKey('e')).toBe('edit')
    expect(actionForKey('s')).toBe('squash')
    expect(actionForKey('f')).toBe('fixup')
    expect(actionForKey('d')).toBe('drop')
    expect(actionForKey('x')).toBeNull()
  })

  it('builds full messages', () => {
    expect(fullMessage({ subject: 's', body: '' })).toBe('s')
    expect(fullMessage({ subject: 's', body: 'b\n\n' })).toBe('s\n\nb')
    expect(fullMessage({ subject: 's', body: '\nb' })).toBe('s\n\nb')
  })

  it('detects modifications', () => {
    const e = initialEntries(COMMITS)
    expect(isModified(setAction(e, 0, 'drop'), COMMITS)).toBe(true)
    expect(isModified(moveEntry(e, 0, 1), COMMITS)).toBe(true)
  })
})

describe('setAction', () => {
  it('pre-fills the original message for reword and clears it otherwise', () => {
    let e = initialEntries(COMMITS)
    e = setAction(e, 1, 'reword')
    expect(e[1].message).toBe('subject 2\n\nbody two')
    e = setAction(e, 1, 'pick')
    expect(e[1].message).toBeUndefined()
  })

  it('returns the same array when nothing changes', () => {
    const e = initialEntries(COMMITS)
    expect(setAction(e, 0, 'pick')).toBe(e)
    expect(setAction(e, 99, 'drop')).toBe(e)
  })

  it('hands a custom group message to another squash member when its carrier leaves', () => {
    let e = withActions(['pick', 'squash', 'squash'])
    const g = computeGroups(e).groups[0]
    e = setGroupMessage(e, g, 'combined')
    expect(e[1].message).toBe('combined')
    e = setAction(e, 1, 'fixup')
    expect(e[1].message).toBeUndefined()
    expect(e[2].message).toBe('combined')
    expect(customGroupMessage(e, computeGroups(e).groups[0])).toBe('combined')
  })
})

describe('moveEntry / display mapping', () => {
  it('moves entries', () => {
    expect(moveEntry(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveEntry(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveEntry(['a', 'b'], 0, 10)).toEqual(['b', 'a'])
    const same = ['a', 'b']
    expect(moveEntry(same, 1, 1)).toBe(same)
    expect(moveEntry(same, 5, 0)).toBe(same)
  })

  it('maps display ↔ todo indices', () => {
    expect(toDisplayIndex(5, 0)).toBe(4)
    expect(toDisplayIndex(5, 4)).toBe(0)
    expect(toDisplayIndex(5, toDisplayIndex(5, 2))).toBe(2)
  })

  it('computes drop targets in display space', () => {
    // display (newest first): [4,3,2,1,0] (todo indices)
    // drag todo 0 (display row 4, bottom) to the top (before display row 0) → becomes newest → todo index 4
    expect(dropTargetTodoIndex(5, 0, 0)).toBe(4)
    // drag todo 4 (display row 0, top) to the very end (insertBefore = 5) → oldest → todo 0
    expect(dropTargetTodoIndex(5, 4, 5)).toBe(0)
    // dropping right where it is → unchanged
    expect(dropTargetTodoIndex(5, 2, 2)).toBe(2)
    expect(dropTargetTodoIndex(5, 2, 3)).toBe(2)
    // drag todo 2 (display row 2) before display row 1 → display 1 → todo 3
    expect(dropTargetTodoIndex(5, 2, 1)).toBe(3)
  })
})

describe('computeGroups', () => {
  it('melds squash/fixup into the nearest older kept commit', () => {
    const e = withActions(['pick', 'squash', 'fixup', 'reword', 'squash'])
    const { groups, targetOf, groupOf } = computeGroups(e)
    expect(groups).toEqual([
      { head: 0, members: [1, 2], squashMembers: [1] },
      { head: 3, members: [4], squashMembers: [4] }
    ])
    expect(targetOf).toEqual([null, 0, 0, null, 3])
    expect(groupOf).toEqual([0, 0, 0, 1, 1])
  })

  it('skips dropped commits', () => {
    const e = withActions(['pick', 'drop', 'squash'])
    expect(computeGroups(e).targetOf).toEqual([null, null, 0])
  })

  it('has no target for leading melds', () => {
    const e = withActions(['fixup', 'squash', 'pick'])
    expect(computeGroups(e).targetOf).toEqual([null, null, null])
    expect(computeGroups(e).groups).toEqual([])
  })
})

describe('group messages', () => {
  it('combines head + squash messages, excluding fixups', () => {
    const e = withActions(['pick', 'squash', 'fixup', 'squash'])
    const g = computeGroups(e).groups[0]
    expect(defaultGroupMessage(e, g)).toBe('subject 1\n\nsubject 2\n\nbody two\n\nsubject 4')
  })

  it('uses a reworded head message', () => {
    let e = withActions(['reword', 'squash'])
    e = setMessage(e, 0, 'new head  ')
    const g = computeGroups(e).groups[0]
    expect(defaultGroupMessage(e, g)).toBe('new head\n\nsubject 2\n\nbody two')
  })

  it('stores custom messages on the first squash member; last provided wins', () => {
    let e = withActions(['pick', 'squash', 'squash'])
    const g = computeGroups(e).groups[0]
    e = setGroupMessage(e, g, 'mine')
    expect(e[1].message).toBe('mine')
    expect(e[2].message).toBeUndefined()
    expect(groupMessage(e, g)).toBe('mine')
    // two carriers (e.g. after a reorder) → last one wins
    e = setMessage(e, 2, 'later')
    expect(groupMessage(e, g)).toBe('later')
    e = setGroupMessage(e, g, null)
    expect(customGroupMessage(e, g)).toBeUndefined()
  })
})

describe('validateRebase', () => {
  it('accepts a plain todo', () => {
    expect(validateRebase(initialEntries(COMMITS))).toEqual([])
  })

  it('rejects squash/fixup on the oldest kept commit', () => {
    expect(validateRebase(withActions(['squash', 'pick']))).toEqual([
      { index: 0, message: 'Cannot squash the oldest commit: there is no earlier commit to combine it with.' }
    ])
    const issues = validateRebase(withActions(['drop', 'fixup', 'pick']))
    expect(issues.map((i) => i.index)).toEqual([1])
    expect(issues[0].message).toMatch(/Cannot fixup/)
  })

  it('requires at least one kept commit', () => {
    expect(validateRebase(withActions(['drop', 'drop']))).toEqual([{ index: null, message: 'At least one commit must be kept.' }])
  })

  it('requires non-empty messages', () => {
    let e = withActions(['pick', 'reword'])
    e = setMessage(e, 1, '   ')
    expect(validateRebase(e)).toEqual([{ index: 1, message: 'The commit message cannot be empty.' }])
    let s = withActions(['pick', 'squash'])
    s = setGroupMessage(s, computeGroups(s).groups[0], '\n')
    expect(validateRebase(s)).toEqual([{ index: 1, message: 'The combined commit message cannot be empty.' }])
  })

  it('reports an empty list', () => {
    expect(validateRebase([])).toHaveLength(1)
  })
})

describe('buildTodo', () => {
  it('keeps todo order and attaches messages', () => {
    let e = withActions(['pick', 'reword', 'pick', 'squash', 'drop'])
    e = setMessage(e, 1, 'Better message\n\nDetails\n')
    const todo = buildTodo(e)
    expect(todo.map((t) => t.action)).toEqual(['pick', 'reword', 'pick', 'squash', 'drop'])
    expect(todo.map((t) => t.sha)).toEqual(COMMITS.map((c) => c.sha))
    expect(todo[1].message).toBe('Better message\n\nDetails')
    expect(todo[3].message).toBe('subject 3\n\nsubject 4')
    expect(todo[0].message).toBeUndefined()
    expect(todo[4].message).toBeUndefined()
    expect(todo[0].subject).toBe('subject 1')
  })

  it('sends the custom group message on the first squash item only', () => {
    let e = withActions(['pick', 'squash', 'fixup', 'squash'])
    e = setMessage(e, 3, 'custom combined')
    const todo = buildTodo(e)
    expect(todo[1].message).toBe('custom combined')
    expect(todo[2].message).toBeUndefined()
    expect(todo[3].message).toBeUndefined()
  })

  it('sends no message for fixup-only groups', () => {
    const todo = buildTodo(withActions(['pick', 'fixup']))
    expect(todo[1]).toEqual({ action: 'fixup', sha: COMMITS[1].sha, subject: 'subject 2' })
  })

  it('always gives reword items a message', () => {
    const e: RebaseEntry[] = [{ commit: COMMITS[1], action: 'reword' }]
    expect(buildTodo(e)[0].message).toBe('subject 2\n\nbody two')
  })
})

describe('summary', () => {
  it('summarises actions in a stable order', () => {
    expect(summarize(withActions(['pick', 'squash', 'pick', 'drop', 'pick']))).toBe('5 commits: 3 pick, 1 squash, 1 drop')
    expect(summarize(initialEntries([COMMITS[0]]))).toBe('1 commit: 1 pick')
    expect(summarize([])).toBe('0 commits')
  })

  it('counts resulting commits', () => {
    expect(resultCount(withActions(['pick', 'squash', 'fixup', 'drop', 'edit']))).toBe(2)
  })
})
