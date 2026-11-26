// The notifications Adar shows: kept so that their click arrives, and what each one opens.

import { describe, expect, it } from 'vitest'
import { MAX_KEPT, Notices, WindowGate, noticeId, parseTarget, targetOfId, type NoticeHandle, type NoticeOptions, type NoticeTarget } from './notices'

interface Fake extends NoticeHandle {
  options: NoticeOptions
  shown: boolean
  fire(event: 'click' | 'failed'): void
}

function fake(options: NoticeOptions): Fake {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    options,
    id: options.id,
    shown: false,
    on(event, listener) {
      ;(listeners[event] ??= []).push(listener)
    },
    show() {
      this.shown = true
    },
    fire(event) {
      for (const l of listeners[event] ?? []) l()
    }
  }
}

function setup(over: { ids?: boolean; history?: () => Promise<NoticeHandle[]> } = {}) {
  const made: Fake[] = []
  const opened: NoticeTarget[] = []
  const notices = new Notices({
    create: (options) => {
      const n = fake(options)
      made.push(n)
      return n
    },
    open: (target) => void opened.push(target),
    ids: over.ids ?? true,
    history: over.history
  })
  return { notices, made, opened }
}

const text = { title: 'Claude Code finished', subtitle: 'Basoa › landing', body: '3 files changed' }
const terminal: NoticeTarget = { kind: 'terminal', owner: '/Users/ana/code/landing', id: 't7' }
const repo: NoticeTarget = { kind: 'repo', repo: '/Users/ana/code/api' }

describe('Notices', () => {
  it('shows a notification, keeps it, and opens what it is about when it is clicked', () => {
    const { notices, made, opened } = setup()
    notices.show(text, terminal)
    expect(made[0].shown).toBe(true)
    expect(made[0].options).toMatchObject(text)
    expect(notices.size).toBe(1)
    made[0].fire('click')
    expect(opened).toEqual([terminal])
    // Clicked, it is gone from the screen: nothing left to keep.
    expect(notices.size).toBe(0)
  })

  it('writes what a click opens in the identifier, each notification with its own', () => {
    const { notices, made } = setup()
    notices.show(text, repo)
    notices.show(text, repo)
    expect(made[0].options.id).not.toBe(made[1].options.id)
    expect(targetOfId(made[0].options.id)).toEqual(repo)
    expect(targetOfId(made[1].options.id)).toEqual(repo)
    // Where identifiers are short (Windows' are), the notification has the system's own.
    const plain = setup({ ids: false })
    plain.notices.show(text, repo)
    expect(plain.made[0].options.id).toBeUndefined()
    plain.made[0].fire('click')
    expect(plain.opened).toEqual([repo])
  })

  it('keeps the latest ones only, and forgets one that could not be shown', () => {
    const { notices, made, opened } = setup()
    for (let i = 0; i < MAX_KEPT + 5; i++) notices.show(text, { kind: 'repo', repo: `/code/r${i}` })
    expect(notices.size).toBe(MAX_KEPT)
    made[made.length - 1].fire('failed')
    expect(notices.size).toBe(MAX_KEPT - 1)
    made[made.length - 2].fire('click')
    expect(opened).toEqual([{ kind: 'repo', repo: `/code/r${MAX_KEPT + 3}` }])
  })

  it('answers the clicks on notifications an earlier run left in Notification Center', async () => {
    const old = fake({ ...text, id: noticeId(repo, 'earlier0') })
    const foreign = fake({ ...text, id: 'something-else' })
    const { notices, made, opened } = setup({ history: async () => [old, foreign, ...made] })
    notices.show(text, terminal)
    expect(await notices.restore()).toBe(1)
    expect(notices.size).toBe(2)
    old.fire('click')
    foreign.fire('click')
    expect(opened).toEqual([repo])
    // The one shown in this run is not taken twice.
    made[0].fire('click')
    expect(opened).toEqual([repo, terminal])
  })

  it('opens once when a notification is two objects, and goes on when Notification Center will not say', async () => {
    const { notices, made, opened } = setup()
    notices.show(text, terminal)
    made[0].fire('click')
    made[0].fire('click')
    expect(opened).toEqual([terminal])
    const failing = setup({ history: async () => Promise.reject(new Error('not signed')) })
    expect(await failing.notices.restore()).toBe(0)
    expect(await setup().notices.restore()).toBe(0)
  })
})

describe('what a notification opens, read back from its identifier', () => {
  it('is only what Adar writes', () => {
    const targets: NoticeTarget[] = [
      repo,
      terminal,
      { kind: 'terminal', owner: 'group:g1', id: 't2' },
      { kind: 'pull', repo: '/code/api', number: 42, view: 'review' },
      { kind: 'agent', path: '/code/api-wt', repo: '/code/api', view: 'commit', sha: 'a'.repeat(40) },
      { kind: 'agent', path: 'C:\\code\\api', repo: 'C:\\code\\api', view: 'changes' }
    ]
    for (const t of targets) expect(targetOfId(noticeId(t, 'x1'))).toEqual(t)
    for (const bad of [
      { kind: 'repo', repo: 'relative/path' },
      { kind: 'repo', repo: '/a\0b' },
      { kind: 'pull', repo: '/code/api', number: -1, view: 'review' },
      { kind: 'pull', repo: '/code/api', number: 1, view: 'settings' },
      { kind: 'agent', path: '/a', repo: '/a', view: 'graph' },
      { kind: 'terminal', owner: 'somewhere', id: 't1' },
      { kind: 'terminal', owner: '/code/api', id: '' },
      { kind: 'run', command: 'rm -rf /' },
      null,
      'repo'
    ]) {
      expect(parseTarget(bad)).toBeNull()
    }
    // A commit's name that is none is left out, not passed on.
    expect(parseTarget({ kind: 'agent', path: '/a', repo: '/a', view: 'commit', sha: '--all' })).toEqual({ kind: 'agent', path: '/a', repo: '/a', view: 'commit' })
    for (const id of ['', 'adar.', 'adar.x', 'adar.x.not base64!', `adar.x.${Buffer.from('not json').toString('base64url')}`, 'other.x.e30', 42, null]) expect(targetOfId(id)).toBeNull()
  })
})

describe('WindowGate', () => {
  it('keeps what a click opens until the window listens, then sends it in order', () => {
    const sent: string[] = []
    const gate = new WindowGate<string>((e) => void sent.push(e))
    // The window was closed: the click made a new one, which hears nothing yet.
    gate.emit('open-terminal')
    gate.emit('open-pull')
    expect(sent).toEqual([])
    gate.ready()
    expect(sent).toEqual(['open-terminal', 'open-pull'])
    gate.emit('open-agent')
    expect(sent).toEqual(['open-terminal', 'open-pull', 'open-agent'])
    // The page loads again: it waits once more.
    gate.paused()
    gate.gone()
    gate.emit('later')
    expect(sent).toHaveLength(3)
    gate.ready()
    expect(sent[3]).toBe('later')
  })

  it('goes on with the same page when a load went nowhere, and never before a new page listens', () => {
    const sent: string[] = []
    const gate = new WindowGate<string>((e) => void sent.push(e))
    gate.ready()
    // A navigation the window refuses: it starts loading and stops where it was.
    gate.paused()
    gate.emit('during')
    expect(sent).toEqual([])
    gate.resumed()
    expect(sent).toEqual(['during'])
    // A real reload: the load began, then the old page was gone. Stopping to load is not listening.
    gate.paused()
    gate.gone()
    gate.resumed()
    gate.emit('for the new page')
    expect(sent).toEqual(['during'])
    gate.ready()
    expect(sent).toEqual(['during', 'for the new page'])
    // A window that never listened does not start to because a load stopped.
    const fresh = new WindowGate<string>((e) => void sent.push(e))
    fresh.paused()
    fresh.resumed()
    fresh.emit('too early')
    expect(sent).toHaveLength(2)
  })
})
