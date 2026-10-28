import { describe, expect, it } from 'vitest'
import { customColorsInUse, groupColorLabel, groupInk, groupLine, recentColorChoices, rememberGroupColor } from './groupColors'

describe('group colours in CSS', () => {
  it('uses the theme tokens for Basoa colours and light-dark() for custom ones', () => {
    expect(groupLine('ember')).toBe('var(--group-ember)')
    expect(groupInk('ember')).toBe('var(--group-ember-ink)')
    expect(groupLine('#e8559a')).toBe('light-dark(#e75499, #ff73b1)')
    expect(groupInk('#e8559a')).toBe('light-dark(#ab1167, #ff73b1)')
    expect(groupColorLabel('sea')).toBe('Sea')
    expect(groupColorLabel('#e8559a')).toBe('#E8559A')
  })

  it('offers the colours other groups use, then the recent ones, without repeats', () => {
    const groups = [
      { name: 'Web', color: '#e8559a' as const },
      { name: '', color: '#00b8c4' as const },
      { name: 'Adar', color: 'sea' as const },
      { name: 'Blog', color: '#e8559a' as const }
    ]
    expect(customColorsInUse(groups)).toEqual([
      { color: '#e8559a', group: 'Web' },
      { color: '#00b8c4', group: 'Unnamed group' }
    ])
    expect(recentColorChoices(groups, ['#ff3b30', '#00b8c4', '#7a2d8c'], 4).map((c) => c.color)).toEqual(['#e8559a', '#00b8c4', '#ff3b30', '#7a2d8c'])
    expect(rememberGroupColor(['#ff3b30', '#e8559a'], '#e8559a')).toEqual(['#e8559a', '#ff3b30'])
    expect(rememberGroupColor(['#ff3b30'], 'ember')).toEqual(['#ff3b30'])
    expect(rememberGroupColor(['#000001', '#000002', '#000003', '#000004', '#000005', '#000006'], '#e8559a')).toHaveLength(6)
  })
})
