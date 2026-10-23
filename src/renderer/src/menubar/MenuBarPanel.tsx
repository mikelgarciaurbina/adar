// The menu bar panel (macOS): one project at a time — its branch with Pull and Push, and its latest commits on
// their lanes with the incoming ones (on the upstream, not yet pulled) marked — plus a switcher to pick another
// project or follow Adar's active tab. Runs in its own window (src/main/menuBar.ts) and may only read the
// repositories Adar opened, and fetch, pull or push them.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, Check, ChevronDown, ChevronUp, Cloud, Ellipsis, FolderGit2, GitBranch, RefreshCw, Search } from 'lucide-react'
import { describeError, toErrorPayload } from '@shared/errors'
import { DEFAULT_SETTINGS, type AppSettings, type Commit, type PullMode, type RecentRepo, type RefsResult, type WorkingStatus } from '@shared/types'
import { api, menuBar, onAdarEvent } from '@renderer/api/client'
import { badgeColorsFor, laneColor, laneForString, laneInk } from '@renderer/lib/colors'
import { basename, dirname, pluralize } from '@renderer/lib/format'
import { computeGraph } from '@renderer/components/graph/layout'
import { buildDisplayRows, hasWorkingChanges, lanesInRange, type DisplayModel, type DisplayRow } from '@renderer/components/graph/model'
import { colorOf, graphContentWidth } from '@renderer/components/graph/geometry'
import { GraphCell } from '@renderer/components/graph/GraphCell'
import { badgesOf, fetchedLabel, groupOf, incomingShas, pickProject, projectSections, shortAge, type ProjectBadges } from './model'

const PINNED_KEY = 'adar-menubar-project'
/** Commits loaded per project and rows shown (the WIP row counts). */
const LOG_COUNT = 40
const MAX_ROWS = 10
const ROW_H = 30
/** Lanes drawn before the graph is clipped. */
const MAX_LANES = 4
/** Projects whose status the switcher reads for its badges. */
const BADGE_LIMIT = 24

function loadPinned(): string | null {
  try {
    return window.localStorage.getItem(PINNED_KEY) || null
  } catch {
    return null
  }
}

function savePinned(repo: string | null): void {
  try {
    if (repo) window.localStorage.setItem(PINNED_KEY, repo)
    else window.localStorage.removeItem(PINNED_KEY)
  } catch {
    /* storage blocked: the choice lasts until the panel reloads */
  }
}

function applyTheme(theme: AppSettings['theme']): void {
  const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme
  document.documentElement.dataset.theme = resolved
}

interface Project {
  repo: string
  refs: RefsResult
  status: WorkingStatus
  commits: Commit[]
}

type Busy = 'fetch' | 'pull' | 'push' | null
interface Note {
  tone: 'info' | 'danger'
  text: string
  /** Ways forward offered next to the message. */
  actions?: Array<{ label: string; run(): void }>
}

export function MenuBarPanel() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [recent, setRecent] = useState<RecentRepo[]>([])
  const [pinned, setPinned] = useState<string | null>(loadPinned)
  const [repo, setRepo] = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [lastFetch, setLastFetch] = useState<Record<string, number>>({})
  const [switching, setSwitching] = useState(false)
  const [now, setNow] = useState(Date.now)
  const request = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)

  /** Read everything again: settings, recents, which project to show and its branch, status and commits. */
  const reload = useCallback(async (pin: string | null) => {
    const id = ++request.current
    try {
      const [s, r, state] = await Promise.all([api.getSettings(), api.getRecentRepos(), menuBar.menuBarState()])
      if (id !== request.current) return
      const full = { ...DEFAULT_SETTINGS, ...s }
      applyTheme(full.theme)
      setSettings(full)
      setRecent(r)
      setLastFetch(state.lastFetch)
      setNow(Date.now())
      const target = pickProject(pin, full, r)
      setRepo(target)
      if (!target) {
        setProject(null)
        setError(null)
        return
      }
      await menuBar.menuBarUseRepo(target)
      const [refs, status] = await Promise.all([api.getRefs(target), api.getStatus(target)])
      const head = refs.branches.find((b) => b.isHead)
      const upstream = head?.upstream && !head.upstreamGone ? refs.remotes.find((x) => x.name === head.upstream) : undefined
      const commits = refs.head.sha ? (await api.getLog(target, { maxCount: LOG_COUNT, revisions: ['HEAD', ...(upstream ? [upstream.fullName] : [])] })).commits : []
      if (id !== request.current) return
      setProject({ repo: target, refs, status, commits })
      setError(null)
    } catch (err) {
      if (id !== request.current) return
      setProject(null)
      setError(toErrorPayload(err).code === 'UNTRUSTED_REPO' ? 'Adar has not been allowed to open this repository yet.' : describeError(err))
    } finally {
      if (id === request.current) setLoaded(true)
    }
  }, [])

  // Repository changes arrive in bursts (a pull touches refs, index and worktree): redraw once they settle.
  const projectRepo = useRef<string | null>(null)
  projectRepo.current = project?.repo ?? null
  const reloadTimer = useRef(0)

  useEffect(() => {
    void reload(loadPinned())
    return onAdarEvent((ev) => {
      if (ev.type === 'menubar-shown') {
        setSwitching(false)
        setNote(null)
        void reload(loadPinned())
      } else if (ev.type === 'repo-changed' && ev.repoPath === projectRepo.current) {
        window.clearTimeout(reloadTimer.current)
        reloadTimer.current = window.setTimeout(() => void reload(loadPinned()), 300)
      }
    })
  }, [reload])

  // Fit the window to the panel.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = () => void menuBar.menuBarSetHeight(Math.ceil(el.getBoundingClientRect().height)).catch(() => undefined)
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    return () => ro.disconnect()
  }, [])

  const choose = (next: string | null) => {
    savePinned(next)
    setPinned(next)
    setSwitching(false)
    setNote(null)
    void reload(next)
  }

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<Note | null>) => {
    if (busy || !project) return
    setBusy(kind)
    setNote(null)
    try {
      setNote(await action())
    } catch (err) {
      setNote({ tone: 'danger', text: describeError(err) })
    } finally {
      setBusy(null)
      void reload(loadPinned())
    }
  }

  const model = useMemo(() => (project ? graphModel(project) : null), [project])
  const head = project?.refs.branches.find((b) => b.isHead) ?? null
  const upstream = head?.upstream && !head.upstreamGone ? (project?.refs.remotes.find((r) => r.name === head.upstream) ?? null) : null
  const behind = upstream ? (head?.behind ?? 0) : 0
  const ahead = upstream ? (head?.ahead ?? 0) : 0

  const fetch = () =>
    run('fetch', async () => {
      await api.fetch(project!.repo, { all: true, prune: true })
      return null
    })

  const openInAdar = (path: string | null = repo) => void menuBar.menuBarOpenInAdar(path)
  const openAction = { label: 'Open in Adar', run: () => openInAdar() }

  const pull = (mode: PullMode = settings?.defaultPullMode ?? 'ff-only') =>
    run('pull', async () => {
      const res = await api.pull(project!.repo, { mode })
      const branch = head?.name ?? 'HEAD'
      if (res.ok) return { tone: 'info', text: /up to date/i.test(res.message) ? `${branch} is already up to date.` : `Pulled ${pluralize(behind, 'commit')} into ${branch}.` }
      if (res.conflicts.length) return { tone: 'danger', text: `The pull stopped on ${pluralize(res.conflicts.length, 'conflict')}: resolve them in Adar.`, actions: [openAction] }
      // Like Adar's Pull: branches that cannot fast-forward are rebased or merged on request.
      if (mode === 'ff-only' && /not possible to fast-forward|diverg/i.test(res.message)) {
        return {
          tone: 'danger',
          text: `${branch} and ${upstream?.name} have diverged.`,
          actions: [
            { label: 'Pull (rebase)', run: () => void pull('rebase') },
            { label: 'Pull (merge)', run: () => void pull('merge') }
          ]
        }
      }
      return { tone: 'danger', text: res.message.split('\n')[0] || 'The pull failed.', actions: [openAction] }
    })

  const push = () =>
    run('push', async () => {
      try {
        await api.push(project!.repo)
      } catch (err) {
        const p = toErrorPayload(err)
        if (/rejected|non-fast-forward|fetch first/i.test(`${p.message}\n${p.stderr ?? ''}`)) {
          return { tone: 'danger', text: `${upstream?.name} has commits you do not have: pull them first, or force push in Adar.`, actions: [openAction] }
        }
        throw err
      }
      return { tone: 'info', text: `Pushed ${head?.name} to ${upstream?.name}.` }
    })

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !switching) {
      e.preventDefault()
      void menuBar.menuBarHide()
    }
  }

  return (
    <div className="mb-panel" ref={rootRef} onKeyDown={onKeyDown}>
      <header className="mb-header">
        <ProjectButton repo={repo} settings={settings} open={switching} onClick={() => setSwitching((v) => !v)} />
        {!switching && (
          <>
            <button
              type="button"
              className={`mb-icon-btn${busy === 'fetch' ? ' mb-spinning' : ''}`}
              aria-label="Fetch"
              title="Fetch all remotes"
              disabled={!project || !!busy}
              onClick={fetch}
            >
              <RefreshCw size={15} />
            </button>
            <button type="button" className="mb-icon-btn" aria-label="Open in Adar" title="Open in Adar" disabled={!repo} onClick={() => openInAdar()}>
              <ArrowUpRight size={16} />
            </button>
          </>
        )}
      </header>

      {switching && settings ? (
        <Switcher settings={settings} recent={recent} pinned={pinned} current={repo} onChoose={choose} onClose={() => setSwitching(false)} />
      ) : (
        <>
          {project && (
            <BranchBar
              project={project}
              color={model?.headColor ?? 0}
              upstreamName={upstream?.name ?? null}
              behind={behind}
              ahead={ahead}
              busy={busy}
              onPull={() => void pull()}
              onPush={push}
            />
          )}
          {note && (
            <div className={`mb-note mb-note-${note.tone}`} role="status">
              <span>{note.text}</span>
              {note.actions?.map((a) => (
                <button key={a.label} type="button" className="mb-note-action" disabled={!!busy} onClick={a.run}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {project && model ? (
            <MiniGraph project={project} model={model.display} upstreamSha={upstream?.sha ?? null} upstreamName={upstream?.name ?? null} now={now} />
          ) : (
            loaded && <EmptyState repo={repo} error={error} onOpen={() => openInAdar()} />
          )}
          <footer className="mb-footer">
            <span className="mb-fetched">{project ? fetchedLabel(lastFetch[project.repo], now) : ''}</span>
            <button type="button" className="mb-icon-btn" aria-label="Menu" title="Notifications, settings, quit" onClick={() => void menuBar.menuBarShowMenu()}>
              <Ellipsis size={16} />
            </button>
            <button type="button" className="mb-btn" onClick={() => openInAdar()}>
              Open in Adar
            </button>
          </footer>
        </>
      )}
    </div>
  )
}

// ── Header ─────────────────────────────────────────────────────────────────

function ProjectButton({ repo, settings, open, onClick }: { repo: string | null; settings: AppSettings | null; open: boolean; onClick: () => void }) {
  const group = repo && settings ? groupOf(settings, repo) : null
  const tile = repo ? badgeColorsFor(repo) : null
  return (
    <button type="button" className={`mb-project${open ? ' mb-project-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} title="Switch project" onClick={onClick}>
      <span className="mb-project-tile" style={tile ? { color: tile.color, background: `color-mix(in srgb, ${laneColor(laneForString(repo!))} 16%, transparent)` } : undefined}>
        <FolderGit2 size={15} />
      </span>
      <span className="mb-project-text">
        <span className="mb-project-name">{repo ? basename(repo) : 'Adar'}</span>
        {group ? (
          <span className="mb-project-group" style={{ color: `var(--group-${group.color}-ink)` }}>
            <span className="mb-dot" style={{ background: `var(--group-${group.color})` }} />
            {group.name}
          </span>
        ) : (
          <span className="mb-project-path">{repo ? dirname(repo) : 'No repository yet'}</span>
        )}
      </span>
      {open ? <ChevronUp size={14} className="mb-chevron" /> : <ChevronDown size={14} className="mb-chevron" />}
    </button>
  )
}

// ── Branch ─────────────────────────────────────────────────────────────────

interface BranchBarProps {
  project: Project
  /** Lane colour of HEAD in the graph. */
  color: number
  upstreamName: string | null
  behind: number
  ahead: number
  busy: Busy
  onPull(): void
  onPush(): void
}

function BranchBar({ project, color, upstreamName, behind, ahead, busy, onPull, onPush }: BranchBarProps) {
  const { head } = project.refs
  const name = head.branch ?? `detached at ${head.sha?.slice(0, 7) ?? '—'}`
  const pushPrimary = ahead > 0 && behind === 0
  return (
    <div className="mb-branch">
      <span className="mb-branch-dot" style={{ ['--mb-lane' as string]: colorOf(color) }} />
      <span className="mb-branch-text">
        <span className="mb-branch-name" title={name}>
          {name}
        </span>
        <span className="mb-branch-up">
          {upstreamName ? (
            <>
              {upstreamName} · <span className={behind ? 'mb-behind' : undefined}>↓{behind}</span> <span className={ahead ? 'mb-ahead' : undefined}>↑{ahead}</span>
            </>
          ) : head.detached ? (
            'no branch checked out'
          ) : (
            'not published: push it from Adar'
          )}
        </span>
      </span>
      {upstreamName && (
        <>
          <button type="button" className={`mb-btn${pushPrimary ? ' mb-btn-primary' : ' mb-btn-ghost'}`} disabled={!!busy || ahead === 0} title={ahead ? `Push ${pluralize(ahead, 'commit')} to ${upstreamName}` : 'Nothing to push'} onClick={onPush}>
            {pushPrimary && <ArrowUpFromLine size={13} />}
            {busy === 'push' ? 'Pushing…' : ahead ? `Push ${ahead}` : 'Push'}
          </button>
          <button type="button" className={`mb-btn${behind ? ' mb-btn-primary' : ' mb-btn-ghost'}`} disabled={!!busy} title={behind ? `Pull ${pluralize(behind, 'commit')} from ${upstreamName}` : `Pull from ${upstreamName}`} onClick={onPull}>
            {behind > 0 && <ArrowDownToLine size={13} />}
            {busy === 'pull' ? 'Pulling…' : behind ? `Pull ${behind}` : 'Pull'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Graph ──────────────────────────────────────────────────────────────────

/** The project's commits on their lanes (with the WIP row when there are changes) and HEAD's lane colour. */
function graphModel({ refs, status, commits }: Project): { display: DisplayModel; headColor: number } {
  const headSha = refs.head.sha
  const display = buildDisplayRows({ commits, layout: computeGraph(commits), headSha, showWip: hasWorkingChanges(status), stashes: [] })
  const headRow = display.rows.find((r) => r.kind === 'commit' && r.commit.sha === headSha)
  return { display, headColor: headRow?.color ?? 0 }
}

interface MiniGraphProps {
  project: Project
  model: DisplayModel
  upstreamSha: string | null
  upstreamName: string | null
  now: number
}

function MiniGraph({ project, model, upstreamSha, upstreamName, now }: MiniGraphProps) {
  const { refs, status, commits } = project
  const headSha = refs.head.sha
  const incoming = useMemo(() => incomingShas(commits, headSha, upstreamSha), [commits, headSha, upstreamSha])
  const rows = model.rows.slice(0, MAX_ROWS)
  const lanes = lanesInRange(rows, 0, rows.length - 1)
  const width = graphContentWidth(Math.min(MAX_LANES, Math.max(1, lanes)))
  const changes = status.staged.length + status.unstaged.length

  if (!rows.length) return <p className="mb-empty">No commits yet.</p>

  const pills = (row: DisplayRow): ReactNode[] => {
    if (row.kind !== 'commit') return []
    const out: ReactNode[] = []
    const lane = row.color
    if (row.commit.sha === headSha && refs.head.branch) {
      out.push(
        <span key="head" className="mb-pill" style={pillStyle(lane)}>
          <GitBranch size={10} />
          {refs.head.branch}
        </span>
      )
    }
    if (upstreamName && row.commit.sha === upstreamSha) {
      out.push(
        <span key="up" className="mb-pill" style={pillStyle(lane)}>
          <Cloud size={10} />
          {upstreamName}
        </span>
      )
    }
    return out
  }

  return (
    <div className={`mb-graph${lanes > MAX_LANES ? ' gr-root gr-clipped' : ''}`} style={{ ['--mb-graph-w' as string]: `${width}px` }}>
      {rows.map((row) => {
        const isIncoming = row.kind === 'commit' && incoming.has(row.commit.sha)
        const isMerge = row.kind === 'commit' && row.isMerge
        return (
          <div
            key={row.key}
            className={`mb-row${isIncoming ? ' mb-row-incoming' : ''}`}
            title={row.kind === 'commit' ? `${row.commit.subject}\n${row.commit.authorName} · ${row.commit.shortSha}${isIncoming ? '\nNot pulled yet' : ''}` : undefined}
          >
            <span className="mb-row-graph">
              <GraphCell row={row} h={ROW_H} width={width} connector={false} head={row.kind === 'commit' && row.commit.sha === headSha} />
            </span>
            {row.kind === 'wip' ? (
              <span className="mb-row-text">
                <span className="mb-wip" style={{ color: laneInk(row.color) }}>
                  // WIP
                </span>
                <span className="mb-wip-count">{pluralize(changes, 'change')}</span>
              </span>
            ) : row.kind === 'commit' ? (
              <span className="mb-row-text">
                {pills(row)}
                <span className={`mb-subject${isMerge ? ' mb-subject-merge' : ''}`}>{row.commit.subject}</span>
              </span>
            ) : (
              <span className="mb-row-text" />
            )}
            <span className="mb-age">{row.kind === 'commit' ? shortAge(row.commit.authorDate, now) : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function pillStyle(lane: number) {
  const c = colorOf(lane)
  return { color: laneInk(lane), background: `color-mix(in srgb, ${c} 12%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 40%, transparent)` }
}

function EmptyState({ repo, error, onOpen }: { repo: string | null; error: string | null; onOpen(): void }) {
  return (
    <div className="mb-empty">
      <p>{!repo ? 'Open a repository in Adar and it shows up here.' : (error ?? 'Could not read this repository.')}</p>
      <button type="button" className="mb-btn" onClick={onOpen}>
        {repo ? 'Open in Adar' : 'Open Adar'}
      </button>
    </div>
  )
}

// ── Switcher ───────────────────────────────────────────────────────────────

interface SwitcherProps {
  settings: AppSettings
  recent: readonly RecentRepo[]
  pinned: string | null
  current: string | null
  onChoose(repo: string | null): void
  onClose(): void
}

function Switcher({ settings, recent, pinned, current, onChoose, onClose }: SwitcherProps) {
  const [query, setQuery] = useState('')
  const [badges, setBadges] = useState<Record<string, ProjectBadges>>({})
  const sections = useMemo(() => projectSections(settings, recent, query), [settings, recent, query])
  // The flat list keyboard navigation walks: "Follow the active tab" (null) and every project.
  const items = useMemo(() => [...(query ? [] : [null]), ...sections.flatMap((s) => s.projects.map((p) => p.path))], [sections, query])
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setActive(Math.max(0, items.indexOf(pinned ? current : null))), [items, pinned, current])

  // Badges for the projects Adar has open (the others answer with an error and show none).
  useEffect(() => {
    let alive = true
    const all = projectSections(settings, recent).flatMap((s) => s.projects.map((p) => p.path)).slice(0, BADGE_LIMIT)
    for (const p of all) {
      api.getStatus(p).then(
        (st) => alive && setBadges((b) => ({ ...b, [p]: badgesOf(st) })),
        () => undefined
      )
    }
    return () => {
      alive = false
    }
  }, [settings, recent])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items.length) onChoose(items[Math.min(active, items.length - 1)])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (query) setQuery('')
      else onClose()
    }
  }

  let index = query ? 0 : 1
  return (
    <div className="mb-switcher" onKeyDown={onKeyDown}>
      <label className="mb-search">
        <Search size={13} />
        <input type="search" placeholder="Switch to…" aria-label="Find a project" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="mb-list" role="listbox" aria-label="Projects" ref={listRef}>
        {!query && (
          <>
            <button type="button" role="option" aria-selected={!pinned} data-active={active === 0} className="mb-option" onMouseEnter={() => setActive(0)} onClick={() => onChoose(null)}>
              <span className="mb-option-check">{!pinned && <Check size={14} />}</span>
              <span className="mb-option-name">Follow the active tab in Adar</span>
            </button>
            <div className="mb-sep" role="presentation" />
          </>
        )}
        {sections.map((section) => (
          <div key={section.id} role="group" aria-label={section.title}>
            <div className="mb-section" role="presentation" style={section.color ? { color: `var(--group-${section.color}-ink)` } : undefined}>
              {section.color && <span className="mb-dot" style={{ background: `var(--group-${section.color})` }} />}
              {section.title}
            </div>
            {section.projects.map((p) => {
              const i = index++
              const selected = !!pinned && p.path === current
              return (
                <button
                  key={p.path}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-active={active === i}
                  className={`mb-option${selected ? ' mb-option-selected' : ''}`}
                  title={p.path}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onChoose(p.path)}
                >
                  <span className="mb-dot mb-option-dot" style={{ background: laneColor(laneForString(p.path)) }} />
                  <span className="mb-option-name">{p.name}</span>
                  <Badges badges={badges[p.path]} />
                </button>
              )
            })}
          </div>
        ))}
        {!sections.length && <p className="mb-empty">No project matches “{query}”.</p>}
      </div>
    </div>
  )
}

function Badges({ badges }: { badges: ProjectBadges | undefined }) {
  if (!badges) return null
  if (badges.conflicts) return <span className="mb-badge mb-badge-conflict">⚠ conflict</span>
  return (
    <>
      {badges.ahead > 0 && <span className="mb-badge mb-ahead">↑{badges.ahead}</span>}
      {badges.behind > 0 && <span className="mb-badge mb-behind">↓{badges.behind}</span>}
      {badges.changes > 0 && <span className="mb-badge mb-changes">✎{badges.changes}</span>}
    </>
  )
}
