// Command palette (Mod+P): fuzzy search over registered commands plus dynamic
// entries (checkout branches, switch tabs, open recent repos, open diffs).

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AppWindow,
  ArrowLeftRight,
  Archive,
  Cloud,
  Eye,
  FileDiff,
  FileWarning,
  FolderClock,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  Layers,
  Search,
  SquareStack
} from 'lucide-react'
import * as git from '@renderer/actions/git'
import { openGroup } from '@renderer/actions/groups'
import { COMMANDS, runCommand, type Command } from '@renderer/commands'
import { tildify } from '@renderer/components/layout/chrome'
import { shortcutLabel } from '@renderer/lib/keys'
import { getActiveTab, useApp } from '@renderer/store/appStore'
import type { DiffTarget } from '@shared/types'
import { fuzzyFilter, highlightSegments } from './fuzzy'
import { loadStringList, writeJson } from './history'
import './palette.css'

const MAX_RESULTS = 50
const RECENT_KEY = 'adar.palette.recent'
const RECENT_LIMIT = 8

interface Entry {
  id: string
  label: string
  group: string
  detail?: string
  /** The detail is a filesystem path: truncate it from the left so its end stays visible. */
  detailIsPath?: boolean
  shortcut?: string
  icon: ReactNode
  run: () => void | Promise<void>
  /** Section header used when the query is empty; entries without one are hidden then. */
  idle?: string
}

const GROUP_ORDER: Command['group'][] = ['Remote', 'Branch', 'Stash', 'Changes', 'Repository', 'View', 'App']

const GROUP_ICON: Record<Command['group'], ReactNode> = {
  Repository: <SquareStack size={14} />,
  Branch: <GitBranch size={14} />,
  Remote: <Globe size={14} />,
  Stash: <Archive size={14} />,
  View: <Eye size={14} />,
  App: <AppWindow size={14} />,
  Changes: <GitCommitHorizontal size={14} />
}

function rememberCommand(id: string) {
  const list = loadStringList(RECENT_KEY).filter((x) => x !== id)
  list.unshift(id)
  writeJson(RECENT_KEY, list.slice(0, RECENT_LIMIT))
}

/** Snapshot of everything the palette can run, built once when it opens. */
function buildEntries(): Entry[] {
  const s = useApp.getState()
  const tab = getActiveTab()
  const home = s.appInfo?.homeDir
  const recentIds = loadStringList(RECENT_KEY)
  const out: Entry[] = []

  const commands = COMMANDS.filter((c) => c.id !== 'command-palette' && (!c.when || c.when()))
  const byId = new Map(commands.map((c) => [c.id, c]))
  const recentCmds = recentIds.map((id) => byId.get(id)).filter((c): c is Command => !!c)
  const recentSet = new Set(recentCmds.map((c) => c.id))
  const commandEntry = (c: Command, section: string): Entry => ({
    id: `cmd:${c.id}`,
    label: c.label,
    group: c.group,
    shortcut: c.shortcut ? shortcutLabel(c.shortcut) : undefined,
    icon: GROUP_ICON[c.group],
    idle: section,
    run: () => {
      rememberCommand(c.id)
      runCommand(c.id)
    }
  })

  // Empty-query order: recently used, open tabs, then commands grouped by area.
  for (const c of recentCmds) out.push(commandEntry(c, 'Recently used'))

  for (const t of s.tabs) {
    if (t.path === s.activePath) continue
    out.push({
      id: `tab:${t.path}`,
      label: `Switch to tab ${t.name}`,
      group: 'Tab',
      detail: tildify(t.path, home),
      detailIsPath: true,
      icon: <ArrowLeftRight size={14} />,
      idle: 'Tabs',
      run: () => s.setActive(t.path)
    })
  }

  const rest = commands.filter((c) => !recentSet.has(c.id))
  rest.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  for (const c of rest) out.push(commandEntry(c, c.group))

  if (tab?.refs) {
    const repo = tab.path
    for (const b of tab.refs.branches) {
      if (b.isHead) continue
      out.push({
        id: `branch:${b.fullName}`,
        label: `Checkout ${b.name}`,
        group: 'Branch',
        detail: b.upstream ? `↔ ${b.upstream}` : undefined,
        icon: <GitBranch size={14} />,
        run: () => void git.checkout(repo, b.name)
      })
    }
    for (const r of tab.refs.remotes) {
      if (r.isSymbolic) continue
      out.push({
        id: `remote:${r.fullName}`,
        label: `Checkout ${r.name}`,
        group: 'Remote branch',
        icon: <Cloud size={14} />,
        run: () => void git.checkoutRemote(repo, r)
      })
    }
  }

  const openPaths = new Set(s.tabs.map((t) => t.path))
  for (const g of s.settings.tabGroups) {
    if (g.repos.every((p) => openPaths.has(p))) continue
    out.push({
      id: `group:${g.id}`,
      label: `Open group ${g.name || 'Unnamed group'}`,
      group: 'Groups',
      detail: g.repos.map((p) => p.split(/[\\/]/).pop()).join(', '),
      icon: <Layers size={14} />,
      run: () => void openGroup(g.id)
    })
  }
  for (const r of s.recent) {
    if (openPaths.has(r.path)) continue
    out.push({
      id: `recent:${r.path}`,
      label: `Open recent ${r.name}`,
      group: 'Recent',
      detail: tildify(r.path, home),
      detailIsPath: true,
      icon: <FolderClock size={14} />,
      run: () => void git.openRepoAt(r.path)
    })
  }

  if (tab?.status) {
    const repo = tab.path
    const st = tab.status
    for (const c of st.conflicted) {
      out.push({
        id: `conflict:${c.path}`,
        label: `Resolve conflict ${c.path}`,
        group: 'Conflict',
        detail: c.kind,
        icon: <FileWarning size={14} />,
        run: () => {
          s.select(repo, { kind: 'wip' })
          git.openConflict(repo, c.path)
        }
      })
    }
    const conflicted = new Set(st.conflicted.map((c) => c.path))
    const unstagedTargets: DiffTarget[] = st.unstaged.filter((f) => !conflicted.has(f.path)).map((f) => ({ kind: 'unstaged', path: f.path }))
    const stagedTargets: DiffTarget[] = st.staged.map((f) => ({ kind: 'staged', path: f.path }))
    for (const f of st.unstaged) {
      if (conflicted.has(f.path)) continue
      out.push({
        id: `unstaged:${f.path}`,
        label: `Open diff ${f.path}`,
        group: 'Changes',
        detail: f.status === 'untracked' ? 'untracked' : 'unstaged',
        icon: <FileDiff size={14} />,
        run: () => {
          s.select(repo, { kind: 'wip' })
          git.openDiff(repo, { kind: 'unstaged', path: f.path }, unstagedTargets)
        }
      })
    }
    for (const f of st.staged) {
      out.push({
        id: `staged:${f.path}`,
        label: `Open diff ${f.path}`,
        group: 'Changes',
        detail: 'staged',
        icon: <FileDiff size={14} />,
        run: () => {
          s.select(repo, { kind: 'wip' })
          git.openDiff(repo, { kind: 'staged', path: f.path }, stagedTargets)
        }
      })
    }
  }

  return out
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen)
  if (!open) return null
  return <PalettePanel />
}

function PalettePanel() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Rebuild only when the underlying data changes while the palette is open.
  const refsVersion = useApp((s) => s.tabs.find((t) => t.path === s.activePath)?.refs)
  const statusVersion = useApp((s) => s.tabs.find((t) => t.path === s.activePath)?.status)
  const tabsCount = useApp((s) => s.tabs.length)
  const recent = useApp((s) => s.recent)
  // The selected values above are only change signals for rebuilding the snapshot.
  const entries = useMemo(() => buildEntries(), [refsVersion, statusVersion, tabsCount, recent])

  const results = useMemo(() => {
    const q = deferredQuery.trim()
    const pool = q ? entries : entries.filter((e) => e.idle)
    return fuzzyFilter(pool, q, (e) => e.label, MAX_RESULTS)
  }, [entries, deferredQuery])

  useEffect(() => {
    setActive(0)
  }, [deferredQuery])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const close = () => useApp.getState().setPaletteOpen(false)

  const runEntry = (entry: Entry | undefined) => {
    if (!entry) return
    close()
    // Let the palette unmount (and focus return) before running.
    setTimeout(() => void entry.run(), 0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = results.length
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (n) setActive((i) => (i + 1) % n)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (n) setActive((i) => (i - 1 + n) % n)
        break
      case 'PageDown':
        e.preventDefault()
        if (n) setActive((i) => Math.min(n - 1, i + 8))
        break
      case 'PageUp':
        e.preventDefault()
        if (n) setActive((i) => Math.max(0, i - 8))
        break
      case 'Enter':
        e.preventDefault()
        runEntry(results[active]?.item)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close()
        break
      case 'Tab':
        e.preventDefault()
        break
    }
  }

  const stale = query !== deferredQuery

  return (
    <div
      className="pal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="pal-panel" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="pal-input-row">
          <Search size={15} className="pal-input-icon" />
          <input
            ref={inputRef}
            className="pal-input"
            placeholder="Type a command, branch, file or repository…"
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-results"
            aria-activedescendant={results[active] ? `pal-opt-${active}` : undefined}
          />
        </div>
        <div ref={listRef} id="pal-results" className={`pal-results${stale ? ' pal-stale' : ''}`} role="listbox">
          {results.length === 0 ? (
            <div className="pal-empty">No matching commands</div>
          ) : (
            results.map((r, i) => {
              const e = r.item
              const isActive = i === active
              const prevSection = i > 0 ? results[i - 1].item.idle : null
              const showGroupHeader = !deferredQuery.trim() && !!e.idle && e.idle !== prevSection
              return (
                <div key={e.id}>
                  {showGroupHeader && <div className="pal-group-header">{e.idle}</div>}
                  <div
                    id={`pal-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isActive}
                    className={`pal-item${isActive ? ' pal-active' : ''}`}
                    onMouseMove={() => !isActive && setActive(i)}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => runEntry(e)}
                  >
                    <span className="pal-item-icon">{e.icon}</span>
                    <span className="pal-item-text">
                      <span className="pal-item-label">
                        {highlightSegments(e.label, r.indexes).map((s, k) =>
                          s.match ? (
                            <mark key={k} className="pal-match">
                              {s.text}
                            </mark>
                          ) : (
                            <span key={k}>{s.text}</span>
                          )
                        )}
                      </span>
                      {e.detail &&
                        (e.detailIsPath ? (
                          <span className="pal-item-detail pal-item-path">
                            <bdi>{e.detail}</bdi>
                          </span>
                        ) : (
                          <span className="pal-item-detail">{e.detail}</span>
                        ))}
                    </span>
                    {deferredQuery.trim() && <span className="pal-item-group">{e.group}</span>}
                    {e.shortcut && <kbd className="ui-kbd pal-item-kbd">{e.shortcut}</kbd>}
                  </div>
                </div>
              )
            })
          )}
        </div>
        <div className="pal-footer">
          <span>
            <kbd className="ui-kbd">↑</kbd>
            <kbd className="ui-kbd">↓</kbd> navigate
          </span>
          <span>
            <kbd className="ui-kbd">↵</kbd> run
          </span>
          <span>
            <kbd className="ui-kbd">esc</kbd> close
          </span>
          <span className="pal-footer-count">
            {results.length >= MAX_RESULTS ? `${MAX_RESULTS}+ results` : `${results.length} result${results.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>
    </div>
  )
}
