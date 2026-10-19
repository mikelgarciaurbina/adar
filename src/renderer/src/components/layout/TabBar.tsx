// Top tab strip: one tab per open repository (GitKraken style). The bar doubles as
// the window drag region; tabs and buttons opt out with no-drag.

import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleArrowUp, Copy, Download, FolderGit2, FolderInput, FolderOpen, FolderPlus, Plus, SquareTerminal, X } from 'lucide-react'
import { isElectron, isMac } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { showContextMenu, showMenuBelow, type MenuItem } from '@renderer/components/common/ContextMenu'
import { getCommand } from '@renderer/commands'
import { useUpdates } from '@renderer/components/update/updateStore'
import { isMod, shortcutLabel } from '@renderer/lib/keys'
import { useApp } from '@renderer/store/appStore'
import { distinctParents, pendingUpdateVersion, reorderIndex } from './chrome'
import { useWindowFullscreen } from './hooks'
import './layout.css'

const TAB_MIME = 'application/x-adar-tab'

function shortcutOf(id: string): string | undefined {
  const spec = getCommand(id)?.shortcut
  return spec ? shortcutLabel(spec) : undefined
}

/** Items of the "+" menu, also reused by the toolbar's repository dropdown. */
export function repoLifecycleItems(): MenuItem[] {
  const s = useApp.getState()
  return [
    { label: 'Open Repository…', icon: <FolderOpen size={14} />, shortcut: shortcutOf('open-repo'), onClick: () => git.openRepoDialog() },
    { label: 'Open by Path…', icon: <FolderInput size={14} />, shortcut: shortcutOf('open-repo-path'), onClick: () => s.openModal({ kind: 'open' }) },
    { label: 'Clone Repository…', icon: <Download size={14} />, shortcut: shortcutOf('clone-repo'), onClick: () => s.openModal({ kind: 'clone' }) },
    { label: 'Init Repository…', icon: <FolderPlus size={14} />, shortcut: shortcutOf('init-repo'), onClick: () => s.openModal({ kind: 'init' }) }
  ]
}

interface TabLite {
  path: string
  name: string
}

export function TabBar() {
  // Select a primitive key so the bar only re-renders when paths/names change,
  // not on every status/log refresh of a tab.
  const tabsKey = useApp((s) => s.tabs.map((t) => `${t.path}\u0000${t.name}`).join('\u0001'))
  const activePath = useApp((s) => s.activePath)
  const busyKey = useApp((s) => Object.keys(s.busy).join('\u0001'))
  const tabs = useMemo<TabLite[]>(
    () =>
      tabsKey
        ? tabsKey.split('\u0001').map((k) => {
            const [path, name] = k.split('\u0000')
            return { path, name }
          })
        : [],
    [tabsKey]
  )
  const hints = useMemo(() => distinctParents(tabs), [tabs])
  const busyRepos = useMemo(() => {
    const set = new Set<string>()
    for (const key of busyKey ? busyKey.split('\u0001') : []) {
      const i = key.indexOf(':')
      if (i >= 0) set.add(key.slice(i + 1))
    }
    return set
  }, [busyKey])

  const stripRef = useRef<HTMLDivElement>(null)
  const tabEls = useRef(new Map<string, HTMLDivElement>())
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null)
  const dragFrom = useRef<number | null>(null)

  // Keep the active tab visible.
  useEffect(() => {
    if (!activePath) return
    tabEls.current.get(activePath)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activePath, tabsKey])

  // Mod+1…9 switches tabs (9 = last), like browsers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isMod(e) || e.shiftKey || e.altKey) return
      if (!/^[1-9]$/.test(e.key)) return
      if (document.querySelector('.ui-backdrop, .pal-overlay')) return
      const list = useApp.getState().tabs
      if (!list.length) return
      const n = Number(e.key)
      const target = n === 9 ? list[list.length - 1] : list[n - 1]
      if (!target) return
      e.preventDefault()
      useApp.getState().setActive(target.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const close = (path: string) => void useApp.getState().closeTab(path)

  const closeOthers = (path: string) => {
    for (const t of useApp.getState().tabs) if (t.path !== path) void useApp.getState().closeTab(t.path)
    useApp.getState().setActive(path)
  }

  const closeToRight = (path: string) => {
    const list = useApp.getState().tabs
    const idx = list.findIndex((t) => t.path === path)
    for (const t of list.slice(idx + 1)) void useApp.getState().closeTab(t.path)
  }

  const onContextMenu = (e: React.MouseEvent, tab: TabLite, index: number) => {
    showContextMenu(e, [
      { type: 'header', label: tab.name },
      { label: 'Close', icon: <X size={14} />, shortcut: shortcutOf('close-tab'), onClick: () => close(tab.path) },
      { label: 'Close Others', disabled: tabs.length < 2, onClick: () => closeOthers(tab.path) },
      { label: 'Close Tabs to the Right', disabled: index >= tabs.length - 1, onClick: () => closeToRight(tab.path) },
      { type: 'separator' },
      { label: isMac ? 'Reveal in Finder' : 'Show in Folder', icon: <FolderOpen size={14} />, onClick: () => git.showInFolder(tab.path) },
      { label: 'Open in Terminal', icon: <SquareTerminal size={14} />, onClick: () => git.openInTerminal(tab.path) },
      { label: 'Copy Path', icon: <Copy size={14} />, onClick: () => git.copyText(tab.path, 'Path copied') }
    ])
  }

  const onDragStart = (e: React.DragEvent, index: number) => {
    dragFrom.current = index
    e.dataTransfer.setData(TAB_MIME, String(index))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e: React.DragEvent, index: number) => {
    if (!Array.from(e.dataTransfer.types).includes(TAB_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const after = e.clientX > r.left + r.width / 2
    setDrop((d) => (d && d.index === index && d.after === after ? d : { index, after }))
  }

  const onDrop = (e: React.DragEvent, index: number) => {
    if (!Array.from(e.dataTransfer.types).includes(TAB_MIME)) return
    e.preventDefault()
    const raw = e.dataTransfer.getData(TAB_MIME)
    const from = raw !== '' ? Number(raw) : dragFrom.current
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const after = e.clientX > r.left + r.width / 2
    setDrop(null)
    dragFrom.current = null
    if (from === null || !Number.isInteger(from) || from < 0) return
    const to = reorderIndex(from, index, after)
    if (to !== from) useApp.getState().moveTab(from, to)
  }

  // macOS traffic lights sit over the bar's left end, except in full screen (hidden there).
  const macChrome = isElectron && isMac
  const zoom = useApp((s) => s.settings.zoom || 1)
  const fullscreen = useWindowFullscreen(macChrome, zoom)
  const reserveTrafficLights = macChrome && !fullscreen

  const updateVersion = useUpdates((s) => pendingUpdateVersion(s.status))
  const updateReady = useUpdates((s) => s.status?.state === 'downloaded')

  return (
    <div className={`tb-tabbar${reserveTrafficLights ? ' tb-tabbar-mac' : ''}`} role="tablist" aria-label="Open repositories">
      <div
        ref={stripRef}
        className="tb-tabs"
        onWheel={(e) => {
          const el = stripRef.current
          if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY
        }}
      >
        {tabs.map((tab, i) => {
          const active = tab.path === activePath
          const isBusy = busyRepos.has(tab.path)
          const indicator = drop && drop.index === i ? (drop.after ? ' tb-drop-after' : ' tb-drop-before') : ''
          return (
            <div
              key={tab.path}
              ref={(el) => {
                if (el) tabEls.current.set(tab.path, el)
                else tabEls.current.delete(tab.path)
              }}
              className={`tb-tab${active ? ' tb-tab-active' : ''}${indicator}`}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={tab.path}
              draggable
              onDragStart={(e) => onDragStart(e, i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDragLeave={(e) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop((d) => (d?.index === i ? null : d))
              }}
              onDrop={(e) => onDrop(e, i)}
              onDragEnd={() => {
                setDrop(null)
                dragFrom.current = null
              }}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault()
              }}
              onClick={() => useApp.getState().setActive(tab.path)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  close(tab.path)
                }
              }}
              onContextMenu={(e) => onContextMenu(e, tab, i)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault()
                  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
                  useApp.getState().setActive(next.path)
                  tabEls.current.get(next.path)?.focus()
                }
              }}
            >
              <span className="tb-tab-icon">{isBusy ? <span className="ui-spinner ui-spinner-sm" /> : <FolderGit2 size={13} />}</span>
              <span className="tb-tab-name">
                {tab.name}
                {hints.has(tab.path) && <span className="tb-tab-hint">{hints.get(tab.path)}</span>}
              </span>
              <button
                className="tb-tab-close"
                tabIndex={-1}
                aria-label={`Close ${tab.name}`}
                title={`Close${shortcutOf('close-tab') ? ` (${shortcutOf('close-tab')})` : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  close(tab.path)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        <button
          className="tb-tab-add"
          title="Open, clone or init a repository"
          aria-label="New tab"
          onClick={(e) => showMenuBelow(e.currentTarget, repoLifecycleItems())}
        >
          <Plus size={15} />
        </button>
        <div className="tb-tabs-fill" />
      </div>
      {updateVersion && (
        <button
          className="tb-update-pill"
          title={`Adar ${updateVersion} ${updateReady ? 'is ready to install' : 'is available'} — see what's new`}
          onClick={() => useUpdates.getState().setNotesOpen(true)}
        >
          <CircleArrowUp size={12} />
          <span>Update</span>
        </button>
      )}
    </div>
  )
}
