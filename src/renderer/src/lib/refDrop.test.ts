import { describe, expect, it } from 'vitest'
import { refDropActions, type DropRef } from './refDrop'

const branch = (name: string, sha = name): DropRef => ({ name, type: 'branch', sha })
const labels = (s: DropRef, t: DropRef, cur: string | null) =>
  refDropActions(s, t, cur).map((a) => (a.kind === 'separator' ? '—' : a.label))

describe('refDropActions', () => {
  it('drop onto the checked-out branch: merge into it, rebase it onto the dragged branch (GitKraken)', () => {
    expect(labels(branch('next'), branch('pepito'), 'pepito')).toEqual([
      'Fast-forward pepito to next',
      'Merge next into pepito',
      'Rebase pepito onto next',
      '—',
      'Reset pepito to next…'
    ])
  })

  it('drag the checked-out branch onto another: rebase the checked-out branch onto the target', () => {
    expect(labels(branch('pre'), branch('main'), 'pre')).toEqual(['Fast-forward main to pre', 'Merge pre into main', 'Rebase pre onto main'])
    const rebase = refDropActions(branch('pre'), branch('main'), 'pre').find((a) => a.kind === 'rebase')
    expect(rebase).toMatchObject({ branch: 'pre', onto: 'main' })
  })

  it('neither checked out: the dragged branch is the one rebased', () => {
    expect(labels(branch('feature'), branch('main'), 'dev')).toEqual(['Fast-forward main to feature', 'Merge feature into main', 'Rebase feature onto main'])
  })

  it('drop onto a remote branch: rebase/merge relative to HEAD and push', () => {
    const remote: DropRef = { name: 'origin/main', type: 'remote', sha: 'r' }
    expect(labels(branch('pre'), remote, 'pre')).toEqual(['Rebase pre onto origin/main', 'Merge origin/main into pre', '—', 'Push pre to origin/main'])
    expect(refDropActions(branch('pre'), remote, 'pre').find((a) => a.kind === 'push')).toMatchObject({ remote: 'origin', remoteBranch: 'main' })
    expect(labels(branch('x'), remote, 'pre')).toEqual(['Merge origin/main into pre', '—', 'Push x to origin/main'])
  })

  it('skips fast-forward when both refs point at the same commit', () => {
    expect(labels(branch('a', 'same'), branch('b', 'same'), 'b')[0]).toBe('Merge a into b')
  })

  it('passes full ref names for ambiguous short names and honours remotes with "/"', () => {
    const tag: DropRef = { name: 'v1', type: 'tag', sha: 't', fullName: 'refs/tags/v1' }
    const rev = (r: DropRef) => (r.name === 'v1' ? r.fullName ?? r.name : r.name)
    expect(refDropActions(tag, branch('main'), 'main', rev).find((a) => a.kind === 'merge')).toMatchObject({ source: 'refs/tags/v1' })
    const remote: DropRef = { name: 'team/upstream/main', type: 'remote', sha: 'r', remote: 'team/upstream' }
    expect(refDropActions(branch('x'), remote, null).find((a) => a.kind === 'push')).toMatchObject({ remote: 'team/upstream', remoteBranch: 'main' })
  })

  it('drop onto a tag, and dropping a ref on itself', () => {
    expect(labels(branch('pre'), { name: 'v1.0', type: 'tag', sha: 't' }, 'pre')).toEqual(['Rebase pre onto v1.0', 'Merge v1.0 into pre'])
    expect(refDropActions(branch('main'), branch('main'), 'main')).toEqual([])
  })
})
