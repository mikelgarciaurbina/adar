// Top tab strip: one tab per open repository (GitKraken style). The bar doubles as
// the window drag region; tabs and buttons opt out with no-drag.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ChevronDown, CircleArrowUp, Copy, Download, FolderGit2, FolderInput, FolderOpen, FolderPlus, GitBranch, Layers, Plus, RefreshCw, SquareTerminal, X } from 'lucide-react'
import { isElectron, isMac } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { closeGroup, fetchGroup, newGroup, openGroup, renameGroup, setGroupColor } from '@renderer/actions/groups'
import { showContextMenu, showMenuBelow, type MenuItem } from '@renderer/components/common/ContextMenu'
import { getCommand } from '@renderer/commands'
import { useUpdates } from '@renderer/components/update/updateStore'
import { customColorsInUse, GROUP_COLOR_LABELS, groupLine } from '@renderer/lib/groupColors'
import { isMod, shortcutLabel } from '@renderer/lib/keys'
import { dropPlacement, groupOf, tabSegments } from '@renderer/lib/tabGroups'
import { useApp } from '@renderer/store/appStore'
import { TAB_GROUP_COLORS, type GroupColor, type TabGroup } from '@shared/types'
import { pendingUpdateVersion, tabHints } from './chrome'
import { GroupColourPopover } from './GroupColourPopover'
import { groupStyle } from './GroupTray'
import { useWindowFullscreen } from './hooks'
import './layout.css'

const TAB_MIME = 'application/x-adar-tab'
/** Tabs share the bar: they start at this width, grow to TAB_MAX_W and shrink down to an icon. */
const TAB_BASIS_W = 200
const TAB_MAX_W = 220
/** Room for a group's label (and its tray padding) when it shares the bar with its tabs. */
const CHIP_BASIS_W = 96
const CHIP_MAX_W = 176

function shortcutOf(id: string): string | undefined {
  const spec = getCommand(id)?.shortcut
  return spec ? shortcutLabel(spec) : undefined
}

/** Coloured dot for menus and lists. */
export function GroupDot({ group }: { group: Pick<TabGroup, 'color'> }) {
  return <span className="tb-group-dot" style={{ background: groupLine(group.color) }} />
}

/** "Open Group" entries (one per saved group), or nothing when there are no groups. */
export function openGroupItems(): MenuItem[] {
  const s = useApp.getState()
  const groups = s.settings.tabGroups
  if (!groups.length) return []
  const open = new Set(s.tabs.map((t) => t.path))
  return [
    { type: 'separator' },
    {
      label: 'Open Group',
      icon: <Layers size={14} />,
      submenu: groups.map((g) => ({
        label: `${g.name || 'Unnamed group'} (${g.repos.length})`,
        icon: <GroupDot group={g} />,
        checked: g.repos.every((p) => open.has(p)),
        onClick: () => void openGroup(g.id)
      }))
    }
  ]
}

/** Items of the "+" menu, also reused by the toolbar's repository dropdown. */
export function repoLifecycleItems(): MenuItem[] {
  const s = useApp.getState()
  return [
    { label: 'Open Repository…', icon: <FolderOpen size={14} />, shortcut: shortcutOf('open-repo'), onClick: () => git.openRepoDialog() },
    { label: 'Open by Path…', icon: <FolderInput size={14} />, shortcut: shortcutOf('open-repo-path'), onClick: () => s.openModal({ kind: 'open' }) },
    { label: 'Clone Repository…', icon: <Download size={14} />, shortcut: shortcutOf('clone-repo'), onClick: () => s.openModal({ kind: 'clone' }) },
    { label: 'Init Repository…', icon: <FolderPlus size={14} />, shortcut: shortcutOf('init-repo'), onClick: () => s.openModal({ kind: 'init' }) },
    ...openGroupItems()
  ]
}

interface TabLite {
  path: string
  name: string
  /** A linked worktree: the main worktree's path ('' otherwise). */
  mainWorktree: string
  branch: string
}

export function TabBar() {
  // Select a primitive key so the bar only re-renders when paths/names change,
  // not on every status/log refresh of a tab.
  const tabsKey = useApp((s) => s.tabs.map((t) => `${t.path}\u0000${t.name}\u0000${t.info?.mainWorktree ?? ''}\u0000${t.info?.head.branch ?? ''}`).join('\u0001'))
  const activePath = useApp((s) => s.activePath)
  const busyKey = useApp((s) => Object.keys(s.busy).join('\u0001'))
  const tabs = useMemo<TabLite[]>(
    () =>
      tabsKey
        ? tabsKey.split('\u0001').map((k) => {
            const [path, name, mainWorktree = '', branch = ''] = k.split('\u0000')
            return { path, name, mainWorktree, branch }
          })
        : [],
    [tabsKey]
  )
  const groups = useApp((s) => s.settings.tabGroups)
  const hints = useMemo(() => tabHints(tabs, groups), [tabs, groups])
  const segments = useMemo(() => tabSegments(tabs, groups), [tabs, groups])
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
  /** Drop indicator: before/after tab `index`, or before the chip of group `chip` (a drop that lands outside it). */
  const [drop, setDrop] = useState<{ index: number; after: boolean; chip?: string } | null>(null)
  /** Group chip under a dragged tab (dropping there joins the group). */
  const [chipDrop, setChipDrop] = useState<string | null>(null)
  /** A group's colour picker (under its label), and the colour it shows the group in meanwhile. */
  const [colourEdit, setColourEdit] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const [colourPreview, setColourPreview] = useState<{ id: string; color: GroupColor } | null>(null)
  const colourGroup = colourEdit ? (groups.find((g) => g.id === colourEdit.id) ?? null) : null
  const dragFrom = useRef<number | null>(null)

  // Keep the active tab visible.
  useEffect(() => {
    if (!activePath) return
    tabEls.current.get(activePath)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activePath, tabsKey])

  // Tabs shrink to share the bar; only when even their smallest size does not fit does the strip scroll,
  // and then a list of every open repository appears at the end of the bar.
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const el = stripRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tabsKey, groups, activePath])

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

  const groupItems = (tab: TabLite): MenuItem[] => {
    const own = groupOf(groups, tab.path)
    const others = groups.filter((g) => g.id !== own?.id)
    const items: MenuItem[] = [{ label: 'Add to New Group…', icon: <Layers size={14} />, onClick: () => void newGroup([tab.path]) }]
    if (others.length) {
      items.push({
        label: own ? 'Move to Group' : 'Add to Group',
        submenu: others.map((g) => ({
          label: g.name || 'Unnamed group',
          icon: <GroupDot group={g} />,
          onClick: () => useApp.getState().setTabGroup(tab.path, g.id)
        }))
      })
    }
    if (own) items.push({ label: `Remove from “${own.name || 'group'}”`, onClick: () => useApp.getState().setTabGroup(tab.path, null) })
    return items
  }

  const onContextMenu = (e: React.MouseEvent, tab: TabLite, index: number) => {
    showContextMenu(e, [
      { type: 'header', label: tab.name },
      { label: 'Close', icon: <X size={14} />, shortcut: shortcutOf('close-tab'), onClick: () => close(tab.path) },
      { label: 'Close Others', disabled: tabs.length < 2, onClick: () => closeOthers(tab.path) },
      { label: 'Close Tabs to the Right', disabled: index >= tabs.length - 1, onClick: () => closeToRight(tab.path) },
      { type: 'separator' },
      ...groupItems(tab),
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
    // The left edge of a group's first tab puts an outsider before the group: show the line before its chip.
    let chip: string | undefined
    const from = dragFrom.current
    const g = groupOf(groups, tabs[index]?.path ?? '')
    if (!after && g && from !== null && dropPlacement(tabs, groups, from, index, false, useApp.getState().activePath).groupId === null) chip = g.id
    setDrop((d) => (d && d.index === index && d.after === after && d.chip === chip ? d : { index, after, chip }))
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
    const { to, groupId } = dropPlacement(tabs, groups, from, index, after, useApp.getState().activePath)
    if (to !== from || (groupOf(groups, tabs[from]?.path ?? '')?.id ?? null) !== groupId) useApp.getState().moveTabTo(from, to, groupId)
  }

  /** A tab dropped on a group's chip joins the group (at its end). */
  const onChipDrop = (e: React.DragEvent, group: TabGroup) => {
    if (!Array.from(e.dataTransfer.types).includes(TAB_MIME)) return
    e.preventDefault()
    const raw = e.dataTransfer.getData(TAB_MIME)
    const from = raw !== '' ? Number(raw) : dragFrom.current
    setDrop(null)
    setChipDrop(null)
    dragFrom.current = null
    if (from === null || !Number.isInteger(from) || from < 0 || !tabs[from]) return
    const members = tabs.map((t, i) => (group.repos.includes(t.path) ? i : -1)).filter((i) => i >= 0)
    const last = members[members.length - 1] ?? tabs.length - 1
    useApp.getState().moveTabTo(from, from <= last ? last : last + 1, group.id)
  }

  const tabItem = (t: TabLite): MenuItem => ({
    label: hints.has(t.path) ? `${t.name} — ${hints.get(t.path)}` : t.name,
    icon: <FolderGit2 size={14} />,
    checked: t.path === activePath,
    onClick: () => useApp.getState().setActive(t.path)
  })

  /** Every open repository, in tab order and under its group's name. */
  const tabListItems = (): MenuItem[] => {
    const items: MenuItem[] = []
    segments.forEach((seg, i) => {
      if (seg.kind === 'tab') {
        items.push(tabItem(seg.tab))
        return
      }
      if (i > 0 && items.length) items.push({ type: 'separator' })
      items.push({ type: 'header', label: seg.group.name || 'Unnamed group' })
      for (const x of seg.tabs) items.push(tabItem(x.tab))
      if (segments[i + 1]?.kind === 'tab') items.push({ type: 'separator' })
    })
    return items
  }

  const onChipContextMenu = (e: React.MouseEvent, group: TabGroup) => {
    const st = useApp.getState()
    const openCount = tabs.filter((t) => group.repos.includes(t.path)).length
    const anchor = e.currentTarget.getBoundingClientRect()
    // Custom colours groups use, by hex: this group's checked, another's with that group's name.
    const custom: MenuItem[] = customColorsInUse(groups).map(({ color }) => {
      const other = groups.find((g) => g.id !== group.id && g.color === color)
      return {
        label: color.toUpperCase(),
        icon: <GroupDot group={{ color }} />,
        checked: color === group.color,
        shortcut: other ? other.name || 'Unnamed group' : undefined,
        onClick: () => setGroupColor(group.id, color)
      }
    })
    showContextMenu(e, [
      { type: 'header', label: group.name || 'Unnamed group' },
      { label: 'Rename Group…', onClick: () => void renameGroup(group.id) },
      {
        label: 'Colour',
        submenu: [
          ...TAB_GROUP_COLORS.map((c): MenuItem => {
            const other = groups.find((g) => g.id !== group.id && g.color === c)
            return {
              label: GROUP_COLOR_LABELS[c],
              icon: <GroupDot group={{ color: c }} />,
              checked: c === group.color,
              // Shows which other group already uses the colour.
              shortcut: other ? other.name || 'Unnamed group' : undefined,
              onClick: () => setGroupColor(group.id, c)
            }
          }),
          { type: 'separator' },
          ...custom,
          ...(custom.length ? [{ type: 'separator' } as const] : []),
          { label: 'Custom Colour…', icon: <span className="tb-group-dot tb-group-dot-custom" />, onClick: () => setColourEdit({ id: group.id, anchor }) }
        ]
      },
      { label: group.collapsed ? 'Expand' : 'Collapse', onClick: () => st.updateGroup(group.id, { collapsed: !group.collapsed }) },
      ...(openCount < group.repos.length ? [{ label: 'Open All Repositories', onClick: () => void openGroup(group.id) }] : []),
      {
        label: openCount > 1 ? `Fetch All (${openCount} repositories)` : 'Fetch All',
        icon: <RefreshCw size={14} />,
        disabled: openCount === 0,
        onClick: () => void fetchGroup(group.id)
      },
      { type: 'separator' },
      { label: 'Ungroup', onClick: () => st.deleteGroup(group.id) },
      { label: 'Close Group', icon: <X size={14} />, onClick: () => void closeGroup(group.id) }
    ])
  }

  // macOS traffic lights sit over the bar's left end, except in full screen (hidden there).
  const macChrome = isElectron && isMac
  const zoom = useApp((s) => s.settings.zoom || 1)
  const fullscreen = useWindowFullscreen(macChrome, zoom)
  const reserveTrafficLights = macChrome && !fullscreen

  const updateVersion = useUpdates((s) => pendingUpdateVersion(s.status))
  const updateReady = useUpdates((s) => s.status?.state === 'downloaded')

  const renderTab = (tab: TabLite, i: number, group: TabGroup | null) => {
    const active = tab.path === activePath
    const isBusy = busyRepos.has(tab.path)
    const indicator = drop && drop.index === i && !drop.chip ? (drop.after ? ' tb-drop-after' : ' tb-drop-before') : ''
    return (
      <div
        key={tab.path}
        ref={(el) => {
          if (el) tabEls.current.set(tab.path, el)
          else tabEls.current.delete(tab.path)
        }}
        className={`tb-tab${active ? ' tb-tab-active' : ''}${group ? ' tb-tab-grouped' : ''}${indicator}`}
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        title={[
          tab.path,
          tab.mainWorktree ? `Worktree of ${tab.mainWorktree}${tab.branch ? ` · ${tab.branch}` : ''}` : null,
          group ? `Group: ${group.name || 'Unnamed group'}` : null
        ]
          .filter(Boolean)
          .join('\n')}
        draggable
        onDragStart={(e) => onDragStart(e, i)}
        onDragOver={(e) => onDragOver(e, i)}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop((d) => (d?.index === i ? null : d))
        }}
        onDrop={(e) => onDrop(e, i)}
        onDragEnd={() => {
          setDrop(null)
          setChipDrop(null)
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
            // Render first: a hidden tab of a collapsed group only exists once it is active.
            flushSync(() => useApp.getState().setActive(next.path))
            tabEls.current.get(next.path)?.focus()
          }
        }}
      >
        <span className="tb-tab-icon">{isBusy ? <span className="ui-spinner ui-spinner-sm" /> : <FolderGit2 size={13} />}</span>
        <span className="tb-tab-name">
          {tab.name}
          {hints.has(tab.path) && <span className="tb-tab-hint">{hints.get(tab.path)}</span>}
        </span>
        {tab.mainWorktree && (
          <span className="tb-tab-worktree" aria-label="Worktree">
            <GitBranch size={10} />
            worktree
          </span>
        )}
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
  }

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
        {segments.map((seg) => {
          if (seg.kind === 'tab') return renderTab(seg.tab, seg.index, null)
          const { group } = seg
          // A collapsed group still shows the active tab, so the open repository is never hidden.
          const shown = group.collapsed ? seg.tabs.filter((x) => x.tab.path === activePath) : seg.tabs
          const label = group.name || 'Unnamed group'
          // The group is a tray: its label and tabs share a tint and a line in the group's colour.
          return (
            <div
              key={`group:${group.id}`}
              className={`tb-group${group.collapsed ? ' tb-group-collapsed' : ''}${chipDrop === group.id ? ' tb-group-drop' : ''}${drop?.chip === group.id ? ' tb-drop-before' : ''}`}
              style={{
                ...groupStyle(colourPreview?.id === group.id ? colourPreview.color : group.color),
                // The tray shares the bar like its tabs would on their own (its tabs split the tray).
                flex: shown.length ? `${shown.length} 1 ${shown.length * TAB_BASIS_W + CHIP_BASIS_W}px` : 'none',
                maxWidth: shown.length ? shown.length * TAB_MAX_W + CHIP_MAX_W : undefined
              }}
            >
              <button
                className="tb-group-chip"
                title={`${label}: ${seg.tabs.map((x) => x.tab.name).join(', ')}\nClick to ${group.collapsed ? 'expand' : 'collapse'}, right-click for options`}
                aria-expanded={!group.collapsed}
                aria-label={`Group ${label}, ${seg.tabs.length} ${seg.tabs.length === 1 ? 'tab' : 'tabs'}`}
                onClick={() => useApp.getState().updateGroup(group.id, { collapsed: !group.collapsed })}
                onContextMenu={(e) => onChipContextMenu(e, group)}
                onDragOver={(e) => {
                  if (!Array.from(e.dataTransfer.types).includes(TAB_MIME)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setChipDrop(group.id)
                }}
                onDragLeave={() => setChipDrop((d) => (d === group.id ? null : d))}
                onDrop={(e) => onChipDrop(e, group)}
              >
                <span className="tb-group-mark" aria-hidden="true" />
                <span className="tb-group-name">{label}</span>
                {group.collapsed && <span className="tb-group-count">{seg.tabs.length}</span>}
              </button>
              {shown.map((x) => renderTab(x.tab, x.index, group))}
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
      {overflow && (
        <button className="tb-tab-list" title="All open repositories" aria-label="All open repositories" onClick={(e) => showMenuBelow(e.currentTarget, tabListItems())}>
          <ChevronDown size={15} />
        </button>
      )}
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
      {colourEdit && colourGroup && (
        <GroupColourPopover
          key={colourGroup.id}
          group={colourGroup}
          anchor={colourEdit.anchor}
          onPreview={(color) => setColourPreview(color ? { id: colourGroup.id, color } : null)}
          onClose={() => setColourEdit(null)}
        />
      )}
    </div>
  )
}
