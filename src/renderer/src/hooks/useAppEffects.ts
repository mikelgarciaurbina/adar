// Global side effects mounted once by App: backend events, keyboard shortcuts,
// auto-fetch, refresh on focus and theme.

import { useEffect } from 'react'
import { cli, isElectron, onAdarEvent } from '@renderer/api/client'
import { openRepoAt, silentFetch } from '@renderer/actions/git'
import { runCommand } from '@renderer/commands'
import { isEditableTarget, isMod } from '@renderer/lib/keys'
import { getActiveTab, useApp, type RefreshScope } from '@renderer/store/appStore'

/** Coalesce repo-changed events per repo into one refresh. */
const pending = new Map<string, { scopes: Set<RefreshScope>; timer: ReturnType<typeof setTimeout> }>()
function scheduleRefresh(repo: string, scopes: RefreshScope[]) {
  const entry = pending.get(repo)
  if (entry) {
    scopes.forEach((s) => entry.scopes.add(s))
    return
  }
  const e = {
    scopes: new Set(scopes),
    timer: setTimeout(() => {
      pending.delete(repo)
      void useApp.getState().refresh(repo, [...e.scopes])
    }, 250)
  }
  pending.set(repo, e)
}

export function useBackendEvents(): void {
  useEffect(
    () =>
      onAdarEvent((ev) => {
        const s = useApp.getState()
        switch (ev.type) {
          case 'repo-changed': {
            if (!s.tabs.some((t) => t.path === ev.repoPath)) return
            const scopes = new Set<RefreshScope>()
            if (ev.scopes.includes('worktree') || ev.scopes.includes('index')) scopes.add('status')
            if (ev.scopes.includes('refs')) {
              scopes.add('refs')
              scopes.add('log')
              scopes.add('info')
              scopes.add('status')
            }
            if (scopes.size) scheduleRefresh(ev.repoPath, [...scopes])
            break
          }
          case 'progress':
            if (ev.done) s.setProgress(ev.opId, null)
            else s.setProgress(ev.opId, { message: ev.message, percent: ev.percent, repoPath: ev.repoPath })
            break
          case 'credential-request':
            s.pushCredentialRequest({ id: ev.id, prompt: ev.prompt, kind: ev.kind, secret: ev.secret })
            break
          case 'menu':
            runCommand(ev.command)
            break
        }
      }),
    []
  )
}

interface Binding {
  key: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
  command: string
  /** Fire even when focus is in a text field. */
  inInputs?: boolean
  /** Only needed in the browser (Electron's native menu already handles it). */
  browserOnly?: boolean
}

const BINDINGS: Binding[] = [
  { key: 'z', mod: true, command: 'undo' },
  { key: 'z', mod: true, shift: true, command: 'redo' },
  { key: 'p', mod: true, command: 'command-palette', inInputs: true, browserOnly: true },
  { key: 'f', mod: true, command: 'search-commits', browserOnly: true },
  { key: 'f', mod: true, shift: true, command: 'fetch', browserOnly: true },
  { key: 'o', mod: true, command: 'open-repo', browserOnly: true },
  { key: 'b', mod: true, command: 'create-branch', browserOnly: true },
  { key: 'j', mod: true, command: 'toggle-left-panel', browserOnly: true },
  { key: 'k', mod: true, command: 'toggle-right-panel', browserOnly: true },
  { key: 's', mod: true, shift: true, command: 'stash', browserOnly: true },
  { key: 's', mod: true, alt: true, command: 'pop-stash', browserOnly: true },
  { key: 'a', mod: true, shift: true, command: 'stage-all', browserOnly: true },
  { key: 'ArrowDown', mod: true, shift: true, command: 'pull', browserOnly: true },
  { key: 'ArrowUp', mod: true, shift: true, command: 'push', browserOnly: true },
  { key: ',', mod: true, command: 'settings', browserOnly: true },
  { key: '`', ctrl: true, command: 'git-console', inInputs: true, browserOnly: true }
]

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const editable = isEditableTarget(e.target)
      for (const b of BINDINGS) {
        if (b.browserOnly && isElectron) continue
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
        if (key !== b.key) continue
        if (!!b.mod !== isMod(e)) continue
        if (!!b.shift !== e.shiftKey) continue
        if (!!b.alt !== e.altKey) continue
        if (b.ctrl && !e.ctrlKey) continue
        if (editable && !b.inInputs) continue
        // Git undo/redo only when no modal/dialog is open.
        if ((b.command === 'undo' || b.command === 'redo') && document.querySelector('.ui-backdrop')) continue
        e.preventDefault()
        runCommand(b.command)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function useAutoFetch(): void {
  const minutes = useApp((s) => s.settings.autoFetchMinutes)
  useEffect(() => {
    if (!minutes || minutes <= 0) return
    const tick = () => {
      for (const t of useApp.getState().tabs) void silentFetch(t.path)
    }
    const first = setTimeout(tick, 5000)
    const id = setInterval(tick, minutes * 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [minutes])
}

export function useRefreshOnFocus(): void {
  useEffect(() => {
    const onFocus = () => {
      const tab = getActiveTab()
      if (tab) void useApp.getState().refresh(tab.path, ['status', 'refs', 'info'])
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}

let swapTimer = 0

export function useTheme(): void {
  const theme = useApp((s) => s.settings.theme)
  useEffect(() => {
    const apply = () => {
      const resolved =
        theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme
      const root = document.documentElement
      // Switching themes cross-fades colours (240 ms, see base.css); the first paint does not.
      if (root.dataset.theme && root.dataset.theme !== resolved) {
        root.classList.add('theme-swap')
        window.clearTimeout(swapTimer)
        swapTimer = window.setTimeout(() => root.classList.remove('theme-swap'), 300)
      }
      root.dataset.theme = resolved
    }
    apply()
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

/**
 * Folders the app was asked to open from outside (the `adar` CLI, the Dock, launch arguments):
 * queued ones are fetched once the app is ready, later ones arrive as events. Each goes through
 * openRepoAt, so the trust prompt and "not a repository" handling apply.
 */
export function useOpenRequests(): void {
  const ready = useApp((s) => s.ready)
  useEffect(() => {
    if (!ready || !isElectron) return
    let cancelled = false
    let chain = Promise.resolve()
    const open = (p: string) => {
      chain = chain.then(() => openRepoAt(p).then(() => undefined, () => undefined))
    }
    // Listen first, then take the queue, so nothing falls between the two.
    const off = onAdarEvent((ev) => {
      if (ev.type === 'open-repo-request') open(ev.path)
    })
    void cli.cliTakeOpenRequests().then(
      (paths) => {
        if (!cancelled) for (const p of paths) open(p)
      },
      () => undefined
    )
    return () => {
      cancelled = true
      off()
    }
  }, [ready])
}
