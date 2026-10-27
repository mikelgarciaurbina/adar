// Central application state (zustand). Holds open repository tabs and their
// loaded data, selection, the centre-panel view, UI chrome state and settings.
//
// Components read with selectors:   const tab = useActiveTab()
// and mutate through store actions: useApp.getState().select(path, {...})
// User-facing git operations (with confirmations/toasts/undo) live in
// src/renderer/src/actions/git.tsx — prefer those over calling `api` directly.

import { create } from 'zustand'
import { api, setZoom } from '@renderer/api/client'
import { toast } from '@renderer/components/common/toast'
import { AdarError, describeError } from '@shared/errors'
import {
  DEFAULT_SETTINGS,
  type AppInfo,
  type AppSettings,
  type Commit,
  type CommitSearch,
  type DiffTarget,
  type RecentRepo,
  type RefsResult,
  type RepoInfo,
  type TabGroup,
  type TabGroupColor,
  type WorkingStatus
} from '@shared/types'
import { arrangeTabs, newGroupId, nextGroupColor, syncGroupOrder, withMembership } from '@renderer/lib/tabGroups'
import type { HostingProvider } from '@shared/hosting'

// ── Types ──────────────────────────────────────────────────────────────────

export type Selection =
  | { kind: 'none' }
  /** The "// WIP" node: working tree changes. */
  | { kind: 'wip' }
  | { kind: 'commit'; sha: string }
  | { kind: 'stash'; index: number; sha: string }
  /** A GitHub pull request (left panel, branch label chip or toolbar). */
  | { kind: 'pull'; number: number }

export type CenterView =
  | { kind: 'graph' }
  /** File diff replaces the graph (like GitKraken). `siblings` enables prev/next file navigation. */
  | { kind: 'diff'; target: DiffTarget; siblings?: DiffTarget[] }
  | { kind: 'conflict'; path: string }
  | { kind: 'rebase'; base: string }
  | { kind: 'history'; path: string }
  | { kind: 'blame'; path: string; rev?: string }

export interface HeadSnapshot {
  sha: string | null
  branch: string | null
}

export interface HistoryEntry {
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
  /** HEAD right after the action (captured by pushHistory): undo refuses to run from any other state. */
  head?: HeadSnapshot
  /** HEAD right after the undo: redo refuses to run from any other state. */
  headAfterUndo?: HeadSnapshot
}

/** Thrown when the repository changed since a history entry was recorded (its inverse would be unsafe). */
export class StaleHistoryError extends Error {
  constructor(label: string) {
    super(`The repository changed since "${label}"`)
    this.name = 'StaleHistoryError'
  }
}

export interface SearchState {
  open: boolean
  query: string
  mode: CommitSearch['mode']
  /** Matching shas, newest first. */
  results: string[]
  index: number
  loading: boolean
}

export interface CommitDraft {
  summary: string
  description: string
  amend: boolean
}

export interface RepoTab {
  path: string
  name: string
  info: RepoInfo | null
  refs: RefsResult | null
  commits: Commit[]
  hasMore: boolean
  status: WorkingStatus | null
  loading: { log: boolean; refs: boolean; status: boolean; more: boolean }
  error: string | null
  selection: Selection
  /** Shas selected with Cmd/Shift-click (includes the primary selected commit). */
  multiSelect: string[]
  /** Anchor for Shift-click / Shift+Arrow range selection (first commit clicked). */
  selectionAnchor?: string | null
  center: CenterView
  search: SearchState
  /** Full ref names hidden from the graph. */
  hiddenRefs: string[]
  /** Full ref name shown alone in the graph. */
  soloRef: string | null
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  draft: CommitDraft
  lastFetch: number | null
}

export type ModalState =
  | { kind: 'clone'; url?: string }
  | { kind: 'init' }
  | { kind: 'open' }
  | { kind: 'settings'; section?: string }
  | { kind: 'identity'; repo: string | null }
  | { kind: 'remotes'; repo: string }
  | { kind: 'about' }
  /** from: the version Adar was just updated from ('' when unknown); absent when opened from a command. */
  | { kind: 'whats-new'; from?: string }
  /**
   * Turn pull requests on for a provider (Data Center: for `server`, asked by a remote on `remoteHost`);
   * `next` runs once signed in.
   */
  | { kind: 'pulls-connect'; provider: HostingProvider; server?: string; remoteHost?: string; next?: () => void }
  | { kind: 'create-pull'; repo: string; head?: string; base?: string }
  | { kind: 'branch-cleanup'; repo: string }

export interface CredentialRequest {
  id: string
  prompt: string
  kind: 'username' | 'password' | 'passphrase' | 'yesno' | 'other'
  secret: boolean
}

export interface ProgressState {
  message: string
  percent?: number
  repoPath?: string
}

export interface AppState {
  ready: boolean
  appInfo: AppInfo | null
  settings: AppSettings
  recent: RecentRepo[]
  tabs: RepoTab[]
  activePath: string | null
  leftCollapsed: boolean
  rightCollapsed: boolean
  modal: ModalState | null
  paletteOpen: boolean
  consoleOpen: boolean
  /** Long-running operations in flight: key → label (e.g. "push:/repo" → "Pushing…"). */
  busy: Record<string, string>
  /** Latest progress line per opId. */
  progress: Record<string, ProgressState>
  credentialQueue: CredentialRequest[]

  // lifecycle
  init(): Promise<void>
  /** Open (or switch to) a repository; resolves to its tab's path (git's real path of the worktree root). */
  openRepo(path: string): Promise<string>
  closeTab(path: string): Promise<void>
  setActive(path: string | null): void
  moveTab(from: number, to: number): void

  // tab groups (settings.tabGroups; groups outlive their tabs)
  /** Group these repositories (taken out of any other group); returns the new group's id. */
  createGroup(paths: string[], opts?: { name?: string; color?: TabGroupColor }): string
  /** Move a repository into a group, or out of its group (null). */
  setTabGroup(path: string, groupId: string | null): void
  updateGroup(id: string, patch: Partial<Pick<TabGroup, 'name' | 'color' | 'collapsed'>>): void
  /** Forget a group; its open tabs stay, ungrouped. */
  deleteGroup(id: string): void
  /** Tab bar drag & drop: move tab `from` to index `to` (splice semantics) and into group `groupId`. */
  moveTabTo(from: number, to: number, groupId: string | null): void

  // data loading
  refresh(path: string, what?: RefreshScope[]): Promise<void>
  loadMore(path: string): Promise<void>
  /** Page in commits until `sha` is loaded (or history is exhausted). Returns true if found. */
  ensureCommitLoaded(path: string, sha: string): Promise<boolean>
  refreshRecent(): Promise<void>

  // selection & views
  select(path: string, selection: Selection, opts?: { additive?: boolean; range?: boolean }): void
  setCenter(path: string, view: CenterView): void
  setSearch(path: string, patch: Partial<SearchState>): void
  runSearch(path: string): Promise<void>
  setRefHidden(path: string, fullName: string, hidden: boolean): void
  /** Hide/show several refs with a single log refresh. */
  setRefsHidden(path: string, fullNames: string[], hidden: boolean): void
  /** Record that a fetch completed now (status bar "fetched … ago"). */
  markFetched(path: string): void
  setSoloRef(path: string, fullName: string | null): void
  updateDraft(path: string, patch: Partial<CommitDraft>): void

  // undo / redo
  pushHistory(path: string, entry: HistoryEntry): void
  /** Returns false when there was nothing to do or another undo/redo is still running. */
  undo(path: string): Promise<boolean>
  redo(path: string): Promise<boolean>
  clearHistory(path: string): void

  // settings & chrome
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  openModal(modal: ModalState): void
  closeModal(): void
  setPaletteOpen(open: boolean): void
  setConsoleOpen(open: boolean): void
  toggleLeft(): void
  toggleRight(): void
  setBusy(key: string, label: string | null): void
  setProgress(opId: string, progress: ProgressState | null): void
  pushCredentialRequest(req: CredentialRequest): void
  shiftCredentialRequest(id: string): void
}

export type RefreshScope = 'info' | 'refs' | 'log' | 'status'

// ── Helpers ────────────────────────────────────────────────────────────────

const EMPTY_SEARCH: SearchState = { open: false, query: '', mode: 'message', results: [], index: 0, loading: false }

function newTab(path: string, name: string): RepoTab {
  return {
    path,
    name,
    info: null,
    refs: null,
    commits: [],
    hasMore: false,
    status: null,
    loading: { log: false, refs: false, status: false, more: false },
    error: null,
    selection: { kind: 'none' },
    multiSelect: [],
    selectionAnchor: null,
    center: { kind: 'graph' },
    search: { ...EMPTY_SEARCH },
    hiddenRefs: [],
    soloRef: null,
    undoStack: [],
    redoStack: [],
    draft: { summary: '', description: '', amend: false },
    lastFetch: null
  }
}

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** Revisions the graph should show given hidden/solo refs and settings. undefined = --all. */
export function graphRevisions(tab: RepoTab, settings: AppSettings): string[] | undefined {
  if (tab.soloRef) return [tab.soloRef]
  const refs = tab.refs
  const needsFilter = tab.hiddenRefs.length > 0 || !settings.graphShowRemotes
  if (!refs || !needsFilter) return undefined
  const hidden = new Set(tab.hiddenRefs)
  const revs: string[] = []
  for (const r of refs.branches) if (!hidden.has(r.fullName)) revs.push(r.fullName)
  if (settings.graphShowRemotes) {
    for (const r of refs.remotes) if (!r.isSymbolic && !hidden.has(r.fullName)) revs.push(r.fullName)
  }
  for (const r of refs.tags) if (!hidden.has(r.fullName)) revs.push(r.fullName)
  if (refs.head.sha && refs.head.detached) revs.push('HEAD')
  return revs.length ? revs : ['HEAD']
}

// Per-tab generation counters so stale async results are dropped.
const generations = new Map<string, Record<RefreshScope, number>>()
function nextGen(path: string, scope: RefreshScope): number {
  const g = generations.get(path) ?? { info: 0, refs: 0, log: 0, status: 0 }
  g[scope] += 1
  generations.set(path, g)
  return g[scope]
}
function isCurrentGen(path: string, scope: RefreshScope, gen: number): boolean {
  return generations.get(path)?.[scope] === gen
}

const historyBusy = new Set<string>()

async function currentHead(path: string): Promise<HeadSnapshot> {
  const info = await api.getRepoInfo(path)
  return { sha: info.head.sha, branch: info.head.branch }
}

function sameHead(a: HeadSnapshot, b: HeadSnapshot): boolean {
  return a.sha === b.sha && a.branch === b.branch
}

let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSettings: Partial<AppSettings> = {}
const loadMoreInFlight = new Map<string, Promise<void>>()

// ── Store ──────────────────────────────────────────────────────────────────

export const useApp = create<AppState>()((set, get) => {
  const updateTab = (path: string, fn: (tab: RepoTab) => Partial<RepoTab>) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, ...fn(t) } : t)) }))
  }
  const getTab = (path: string) => get().tabs.find((t) => t.path === path)

  const persistTabs = () => {
    const { tabs, activePath } = get()
    void get().updateSettings({ openTabs: tabs.map((t) => t.path), activeTab: activePath })
  }

  /** Save new groups, keeping each group's tabs together and its repository order in step with the tabs. */
  const applyGroups = (groups: TabGroup[], tabs: RepoTab[] = get().tabs) => {
    const arranged = arrangeTabs(tabs, groups)
    set({ tabs: arranged })
    void get().updateSettings({ tabGroups: syncGroupOrder(groups, arranged) })
    persistTabs()
  }
  const cleanName = (name: string) => name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80)

  /** Fetch the next page of the log for `path` (callers go through loadMore, which dedupes). */
  const loadMorePage = async (path: string): Promise<void> => {
    const tab = getTab(path)
    if (!tab || !tab.hasMore) return
    updateTab(path, (t) => ({ loading: { ...t.loading, more: true } }))
    const gen = generations.get(path)?.log ?? 0
    try {
      const settings = get().settings
      const page = await api.getLog(path, {
        maxCount: settings.graphPageSize || 2000,
        skip: tab.commits.length,
        revisions: graphRevisions(tab, settings)
      })
      // A log refresh replaced the list meanwhile: this page is stale.
      if ((generations.get(path)?.log ?? 0) !== gen) return
      updateTab(path, (t) => {
        const seen = new Set(t.commits.map((c) => c.sha))
        return { commits: [...t.commits, ...page.commits.filter((c) => !seen.has(c.sha))], hasMore: page.hasMore }
      })
    } catch {
      /* keep what we have; callers detect the lack of progress */
    } finally {
      updateTab(path, (t) => ({ loading: { ...t.loading, more: false } }))
    }
  }

  return {
    ready: false,
    appInfo: null,
    settings: { ...DEFAULT_SETTINGS },
    recent: [],
    tabs: [],
    activePath: null,
    leftCollapsed: false,
    rightCollapsed: false,
    modal: null,
    paletteOpen: false,
    consoleOpen: false,
    busy: {},
    progress: {},
    credentialQueue: [],

    async init() {
      try {
        const [appInfo, settings, recent] = await Promise.all([api.getAppInfo(), api.getSettings(), api.getRecentRepos()])
        set({ appInfo, settings: { ...DEFAULT_SETTINGS, ...settings }, recent })
        if (settings.zoom && settings.zoom !== 1) setZoom(settings.zoom)
        const toRestore = settings.openTabs ?? []
        for (const p of toRestore) {
          try {
            const info = await api.openRepo(p)
            set((s) => ({ tabs: [...s.tabs, { ...newTab(info.path, info.name), info }] }))
          } catch (err) {
            // A repo that gained command-running config since it was last opened needs a fresh decision.
            if (err instanceof AdarError && err.code === 'UNTRUSTED_REPO') {
              toast.warning(`${basename(p)} now has configuration that runs commands, so it was not reopened.`, {
                duration: 0,
                actions: [{ label: 'Review…', onClick: () => void import('@renderer/actions/git').then((m) => m.openRepoAt(p)) }]
              })
            }
            // Repo moved or deleted — skip silently.
          }
        }
        set((s) => ({ tabs: arrangeTabs(s.tabs, s.settings.tabGroups ?? []) }))
        const tabs = get().tabs
        const active = tabs.find((t) => t.path === settings.activeTab)?.path ?? tabs[0]?.path ?? null
        set({ activePath: active })
        for (const t of tabs) void get().refresh(t.path)
      } catch (err) {
        console.error('[adar] init failed', err)
      } finally {
        set({ ready: true })
      }
    },

    async openRepo(path) {
      const existing = get().tabs.find((t) => t.path === path)
      if (existing) {
        get().setActive(existing.path)
        return existing.path
      }
      const info = await api.openRepo(path)
      const already = get().tabs.find((t) => t.path === info.path)
      if (already) {
        get().setActive(already.path)
        return already.path
      }
      // A repository of a group joins its group's tabs.
      set((s) => ({ tabs: arrangeTabs([...s.tabs, { ...newTab(info.path, info.name), info }], s.settings.tabGroups), activePath: info.path }))
      persistTabs()
      void get().refreshRecent()
      await get().refresh(info.path)
      return info.path
    },

    async closeTab(path) {
      const { tabs, activePath } = get()
      const idx = tabs.findIndex((t) => t.path === path)
      if (idx < 0) return
      const remaining = tabs.filter((t) => t.path !== path)
      let nextActive = activePath
      if (activePath === path) nextActive = remaining[Math.min(idx, remaining.length - 1)]?.path ?? null
      set({ tabs: remaining, activePath: nextActive })
      generations.delete(path)
      persistTabs()
      try {
        await api.closeRepo(path)
      } catch {
        /* ignore */
      }
    },

    setActive(path) {
      if (get().activePath === path) return
      set({ activePath: path })
      persistTabs()
      if (path) void get().refresh(path, ['status'])
    },

    moveTab(from, to) {
      const tabs = [...get().tabs]
      const [moved] = tabs.splice(from, 1)
      if (!moved) return
      tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, moved)
      applyGroups(get().settings.tabGroups, tabs)
    },

    createGroup(paths, opts) {
      const unique = [...new Set(paths)]
      let groups = get().settings.tabGroups
      for (const p of unique) groups = withMembership(groups, p, null)
      const id = newGroupId()
      applyGroups([...groups, { id, name: cleanName(opts?.name ?? ''), color: opts?.color ?? nextGroupColor(groups), repos: unique, collapsed: false }])
      return id
    },

    setTabGroup(path, groupId) {
      applyGroups(withMembership(get().settings.tabGroups, path, groupId))
    },

    updateGroup(id, patch) {
      const clean = patch.name === undefined ? patch : { ...patch, name: cleanName(patch.name) }
      applyGroups(get().settings.tabGroups.map((g) => (g.id === id ? { ...g, ...clean } : g)))
    },

    deleteGroup(id) {
      applyGroups(get().settings.tabGroups.filter((g) => g.id !== id))
    },

    moveTabTo(from, to, groupId) {
      const tabs = [...get().tabs]
      const [moved] = tabs.splice(from, 1)
      if (!moved) return
      tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, moved)
      applyGroups(withMembership(get().settings.tabGroups, moved.path, groupId), tabs)
    },

    async refresh(path, what = ['info', 'refs', 'log', 'status']) {
      const tab = getTab(path)
      if (!tab) return
      const tasks: Promise<void>[] = []

      if (what.includes('info')) {
        const gen = nextGen(path, 'info')
        tasks.push(
          api.getRepoInfo(path).then(
            (info) => {
              if (isCurrentGen(path, 'info', gen)) updateTab(path, () => ({ info, error: null }))
            },
            (err) => {
              if (isCurrentGen(path, 'info', gen)) updateTab(path, () => ({ error: describeError(err) }))
            }
          )
        )
      }

      if (what.includes('status')) {
        const gen = nextGen(path, 'status')
        updateTab(path, (t) => ({ loading: { ...t.loading, status: true } }))
        tasks.push(
          api.getStatus(path).then(
            (status) => {
              if (!isCurrentGen(path, 'status', gen)) return
              updateTab(path, (t) => ({ status, loading: { ...t.loading, status: false } }))
            },
            (err) => {
              if (!isCurrentGen(path, 'status', gen)) return
              // A vanished repository folder must disable the UI right away (not only after the next full refresh).
              const fatal = err instanceof AdarError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_REPO')
              updateTab(path, (t) => ({ loading: { ...t.loading, status: false }, ...(fatal ? { error: describeError(err) } : {}) }))
            }
          )
        )
      }

      // Log depends on refs (for hidden/solo revisions) so chain them.
      if (what.includes('refs') || what.includes('log')) {
        const refsGen = what.includes('refs') ? nextGen(path, 'refs') : 0
        const logGen = what.includes('log') ? nextGen(path, 'log') : 0
        updateTab(path, (t) => ({
          loading: { ...t.loading, refs: what.includes('refs') || t.loading.refs, log: what.includes('log') || t.loading.log }
        }))
        tasks.push(
          (async () => {
            if (what.includes('refs')) {
              try {
                const refs = await api.getRefs(path)
                if (isCurrentGen(path, 'refs', refsGen)) updateTab(path, (t) => ({ refs, loading: { ...t.loading, refs: false } }))
              } catch (err) {
                if (isCurrentGen(path, 'refs', refsGen))
                  updateTab(path, (t) => ({ error: describeError(err), loading: { ...t.loading, refs: false } }))
              }
            }
            if (what.includes('log')) {
              const t0 = getTab(path)
              if (!t0) return
              const settings = get().settings
              const pageSize = settings.graphPageSize || 2000
              const maxCount = Math.max(pageSize, t0.commits.length)
              try {
                const page = await api.getLog(path, { maxCount, revisions: graphRevisions(t0, settings) })
                if (!isCurrentGen(path, 'log', logGen)) return
                updateTab(path, (t) => {
                  // Drop the selection only if the commit really vanished (e.g. after reset/amend):
                  // with more pages available it may simply lie beyond the first page.
                  let selection = t.selection
                  const sel = t.selection
                  // The reload covers every commit loaded so far, so a previously loaded commit missing
                  // from it really vanished; a never-loaded one (being paged in) is kept while more pages exist.
                  const wasLoaded = sel.kind === 'commit' && t.commits.some((c) => c.sha === sel.sha)
                  if (sel.kind === 'commit' && !page.commits.some((c) => c.sha === sel.sha) && (wasLoaded || !page.hasMore)) {
                    selection = { kind: 'none' }
                  }
                  return {
                    commits: page.commits,
                    hasMore: page.hasMore,
                    selection,
                    loading: { ...t.loading, log: false }
                  }
                })
              } catch (err) {
                if (isCurrentGen(path, 'log', logGen))
                  updateTab(path, (t) => ({ error: describeError(err), loading: { ...t.loading, log: false } }))
              }
            }
          })()
        )
      }

      await Promise.all(tasks)
    },

    loadMore(path) {
      // Concurrent callers share the in-flight page instead of seeing "no progress".
      const running = loadMoreInFlight.get(path)
      if (running) return running
      const p = loadMorePage(path).finally(() => loadMoreInFlight.delete(path))
      loadMoreInFlight.set(path, p)
      return p
    },

    async ensureCommitLoaded(path, sha) {
      for (let i = 0; i < 50; i++) {
        const tab = getTab(path)
        if (!tab) return false
        if (tab.commits.some((c) => c.sha === sha || c.sha.startsWith(sha))) return true
        if (!tab.hasMore) return false
        const before = tab.commits.length
        await get().loadMore(path)
        // A log refresh may be replacing the list: wait for it before judging progress.
        for (let w = 0; w < 100 && getTab(path)?.loading.log; w++) await new Promise((r) => setTimeout(r, 50))
        const after = getTab(path)
        if (!after) return false
        if (after.commits.some((c) => c.sha === sha || c.sha.startsWith(sha))) return true
        // Stop when paging fails or yields nothing (avoids hammering a failing getLog).
        if (after.commits.length <= before && !after.loading.more) return false
      }
      return false
    },

    async refreshRecent() {
      try {
        set({ recent: await api.getRecentRepos() })
      } catch {
        /* ignore */
      }
    },

    select(path, selection, opts) {
      updateTab(path, (t) => {
        if (selection.kind !== 'commit') return { selection, multiSelect: [], selectionAnchor: null }
        if (opts?.additive) {
          const set_ = new Set(t.multiSelect.length ? t.multiSelect : t.selection.kind === 'commit' ? [t.selection.sha] : [])
          if (set_.has(selection.sha)) set_.delete(selection.sha)
          else set_.add(selection.sha)
          const multi = [...set_]
          return {
            selection: multi.length ? { kind: 'commit', sha: multi[multi.length - 1] } : { kind: 'none' },
            multiSelect: multi,
            selectionAnchor: selection.sha
          }
        }
        const anchor = t.selectionAnchor ?? (t.selection.kind === 'commit' ? t.selection.sha : null)
        if (opts?.range && anchor) {
          const a = t.commits.findIndex((c) => c.sha === anchor)
          const b = t.commits.findIndex((c) => c.sha === selection.sha)
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a]
            return { selection, multiSelect: t.commits.slice(lo, hi + 1).map((c) => c.sha), selectionAnchor: anchor }
          }
        }
        return { selection, multiSelect: [], selectionAnchor: selection.sha }
      })
    },

    setCenter(path, view) {
      updateTab(path, () => ({ center: view }))
    },

    setSearch(path, patch) {
      updateTab(path, (t) => ({ search: { ...t.search, ...patch } }))
    },

    async runSearch(path) {
      const tab = getTab(path)
      if (!tab) return
      const { query, mode } = tab.search
      if (!query.trim()) {
        get().setSearch(path, { results: [], index: 0, loading: false })
        return
      }
      get().setSearch(path, { loading: true })
      try {
        const page = await api.getLog(path, {
          maxCount: 2000,
          search: { text: query.trim(), mode },
          revisions: graphRevisions(tab, get().settings)
        })
        const cur = getTab(path)
        if (!cur) return
        // A newer search superseded this one: let it own the loading flag.
        if (cur.search.query !== query || cur.search.mode !== mode) return
        get().setSearch(path, { results: page.commits.map((c) => c.sha), index: 0, loading: false })
      } catch (err) {
        const cur = getTab(path)
        if (cur && cur.search.query === query && cur.search.mode === mode) get().setSearch(path, { results: [], index: 0, loading: false })
        throw err
      }
    },

    setRefHidden(path, fullName, hidden) {
      updateTab(path, (t) => {
        const set_ = new Set(t.hiddenRefs)
        if (hidden) set_.add(fullName)
        else set_.delete(fullName)
        return { hiddenRefs: [...set_], soloRef: t.soloRef === fullName && hidden ? null : t.soloRef }
      })
      void get().refresh(path, ['log'])
    },

    setRefsHidden(path, fullNames, hidden) {
      if (!fullNames.length) return
      updateTab(path, (t) => {
        const set_ = new Set(t.hiddenRefs)
        for (const n of fullNames) {
          if (hidden) set_.add(n)
          else set_.delete(n)
        }
        return { hiddenRefs: [...set_], soloRef: hidden && t.soloRef && fullNames.includes(t.soloRef) ? null : t.soloRef }
      })
      void get().refresh(path, ['log'])
    },

    markFetched(path) {
      updateTab(path, () => ({ lastFetch: Date.now() }))
    },

    setSoloRef(path, fullName) {
      updateTab(path, () => ({ soloRef: fullName }))
      void get().refresh(path, ['log'])
    },

    updateDraft(path, patch) {
      updateTab(path, (t) => ({ draft: { ...t.draft, ...patch } }))
    },

    pushHistory(path, entry) {
      updateTab(path, (t) => ({ undoStack: [...t.undoStack.slice(-49), entry], redoStack: [] }))
      // Record where HEAD is right after the action; undo only runs from exactly that state.
      if (!entry.head) void currentHead(path).then((h) => (entry.head = entry.head ?? h), () => undefined)
    },

    async undo(path) {
      const entry = getTab(path)?.undoStack.at(-1)
      if (!entry || historyBusy.has(path)) return false
      historyBusy.add(path)
      try {
        if (entry.head && !sameHead(entry.head, await currentHead(path))) throw new StaleHistoryError(entry.label)
        await entry.undo()
        entry.headAfterUndo = await currentHead(path).catch(() => undefined)
        updateTab(path, (t) => ({ undoStack: t.undoStack.slice(0, -1), redoStack: [...t.redoStack, entry] }))
        return true
      } finally {
        historyBusy.delete(path)
      }
    },

    async redo(path) {
      const entry = getTab(path)?.redoStack.at(-1)
      if (!entry || historyBusy.has(path)) return false
      historyBusy.add(path)
      try {
        if (entry.headAfterUndo && !sameHead(entry.headAfterUndo, await currentHead(path))) throw new StaleHistoryError(entry.label)
        await entry.redo()
        entry.head = await currentHead(path).catch(() => undefined)
        updateTab(path, (t) => ({ redoStack: t.redoStack.slice(0, -1), undoStack: [...t.undoStack, entry] }))
        return true
      } finally {
        historyBusy.delete(path)
      }
    },

    clearHistory(path) {
      updateTab(path, () => ({ undoStack: [], redoStack: [] }))
    },

    async updateSettings(patch) {
      const next = { ...get().settings, ...patch }
      set({ settings: next })
      if (patch.zoom !== undefined) setZoom(patch.zoom)
      // Debounce writes (panel resizing fires many updates) and send only the keys that changed,
      // so values written by the backend itself are never overwritten with stale renderer copies.
      pendingSettings = { ...pendingSettings, ...patch }
      if (settingsSaveTimer) clearTimeout(settingsSaveTimer)
      settingsSaveTimer = setTimeout(() => {
        const toSave = pendingSettings
        pendingSettings = {}
        void api.updateSettings(toSave).catch((err) => console.error('[adar] saving settings failed', err))
      }, 300)
    },

    openModal(modal) {
      set({ modal })
    },
    closeModal() {
      set({ modal: null })
    },
    setPaletteOpen(open) {
      set({ paletteOpen: open })
    },
    setConsoleOpen(open) {
      set({ consoleOpen: open })
    },
    toggleLeft() {
      set((s) => ({ leftCollapsed: !s.leftCollapsed }))
    },
    toggleRight() {
      set((s) => ({ rightCollapsed: !s.rightCollapsed }))
    },
    setBusy(key, label) {
      set((s) => {
        const busy = { ...s.busy }
        if (label) busy[key] = label
        else delete busy[key]
        return { busy }
      })
    },
    setProgress(opId, progress) {
      set((s) => {
        const next = { ...s.progress }
        if (progress) next[opId] = progress
        else delete next[opId]
        return { progress: next }
      })
    },
    pushCredentialRequest(req) {
      set((s) => ({ credentialQueue: [...s.credentialQueue, req] }))
    },
    shiftCredentialRequest(id) {
      set((s) => ({ credentialQueue: s.credentialQueue.filter((r) => r.id !== id) }))
    }
  }
})

// ── Selector hooks ─────────────────────────────────────────────────────────

export function useActiveTab(): RepoTab | null {
  return useApp((s) => s.tabs.find((t) => t.path === s.activePath) ?? null)
}

export function useTab(path: string | null | undefined): RepoTab | null {
  return useApp((s) => (path ? (s.tabs.find((t) => t.path === path) ?? null) : null))
}

export function useSettings(): AppSettings {
  return useApp((s) => s.settings)
}

/** Non-reactive access for event handlers. */
export function getActiveTab(): RepoTab | null {
  const s = useApp.getState()
  return s.tabs.find((t) => t.path === s.activePath) ?? null
}

export function isBusy(key: string): boolean {
  return key in useApp.getState().busy
}
