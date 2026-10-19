// Context menus of the commit graph (commit rows, multi-selection, ref pills,
// stash rows, the WIP row and the column header). Every mutating entry goes
// through the user-level actions in actions/git.tsx.

import {
  Archive,
  ArchiveRestore,
  Check,
  Cherry,
  CircleDot,
  Cloud,
  Copy,
  Crosshair,
  Download,
  EyeOff,
  Focus,
  GitBranch,
  GitCompare,
  GitMerge,
  GitPullRequestArrow,
  Link2,
  ListOrdered,
  Monitor,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Trash,
  Undo2,
  Upload
} from 'lucide-react'
import * as git from '@renderer/actions/git'
import type { MenuItem } from '@renderer/components/common/ContextMenu'
import { currentBranch } from '@renderer/lib/refs'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { Commit, Ref, Stash } from '@shared/types'
import { isAncestor, oldestFirst, type Pill } from './model'

const I = 14
const store = () => useApp.getState()
const tabOf = (repo: string): RepoTab | undefined => store().tabs.find((t) => t.path === repo)
const short = (sha: string) => sha.slice(0, 7)

function hasRemotes(tab: RepoTab | undefined): boolean {
  return !!tab?.info?.remotes.length
}

function pillIcon(p: Pill) {
  switch (p.kind) {
    case 'remote':
      return <Cloud size={I} />
    case 'tag':
      return <Tag size={I} />
    case 'detached':
      return <CircleDot size={I} />
    default:
      return p.isHead ? <Check size={I} /> : <Monitor size={I} />
  }
}

function fullMessage(c: Commit): string {
  return c.body.trim() ? `${c.subject}\n\n${c.body.trim()}` : c.subject
}

// ── Ref pills ──────────────────────────────────────────────────────────────

export function refMenu(repo: string, pill: Pill): MenuItem[] {
  const tab = tabOf(repo)
  const refs = tab?.refs ?? null
  const ref = pill.ref
  if (pill.kind === 'detached') {
    return [
      { type: 'header', label: `HEAD (detached at ${short(ref.sha)})` },
      { label: 'Create branch here…', icon: <GitBranch size={I} />, onClick: () => git.createBranch(repo, ref.sha) },
      { label: 'Copy commit SHA', icon: <Copy size={I} />, onClick: () => git.copyText(ref.sha, 'Copied commit SHA') }
    ]
  }
  const cur = currentBranch(refs)
  const name = ref.name
  const isLocal = pill.kind === 'branch'
  const isCurrent = isLocal && !!ref.isHead
  const items: MenuItem[] = []

  if (!isCurrent) items.push({ label: `Checkout ${name}`, icon: <Crosshair size={I} />, onClick: () => void git.checkoutRef(repo, ref) })
  if (cur && !isCurrent && cur.name !== name) {
    items.push(
      { label: `Merge ${name} into ${cur.name}`, icon: <GitMerge size={I} />, onClick: () => git.merge(repo, name) },
      { label: `Rebase ${cur.name} onto ${name}`, icon: <GitPullRequestArrow size={I} />, onClick: () => git.rebase(repo, name) }
    )
  }
  if (isLocal && ref.upstream && !ref.upstreamGone && (ref.behind ?? 0) > 0 && !ref.ahead) {
    const upstream = ref.upstream
    items.push({ label: `Fast-forward ${name} to ${upstream}`, icon: <Download size={I} />, onClick: () => git.fastForward(repo, name, upstream) })
  }
  if (isCurrent) {
    items.push(
      { type: 'separator' },
      { label: 'Pull', icon: <Download size={I} />, onClick: () => git.pull(repo) },
      { label: 'Push', icon: <Upload size={I} />, onClick: () => git.push(repo) }
    )
  } else if (isLocal && hasRemotes(tab)) {
    items.push({ type: 'separator' }, { label: `Push ${name}`, icon: <Upload size={I} />, onClick: () => git.push(repo, { branch: name }) })
  }

  items.push({ type: 'separator' })
  if (isLocal) {
    items.push(
      { label: `Set upstream for ${name}…`, icon: <Link2 size={I} />, onClick: () => git.setUpstreamDialog(repo, ref) },
      { label: `Rename ${name}…`, icon: <Pencil size={I} />, onClick: () => git.renameBranch(repo, ref) },
      { label: `Delete ${name}…`, icon: <Trash size={I} />, danger: true, disabled: isCurrent, onClick: () => git.deleteBranch(repo, ref) }
    )
  }
  const remoteRefs: Ref[] = pill.kind === 'remote' ? [ref] : pill.remotes
  for (const r of remoteRefs) {
    items.push({ label: `Delete ${r.name} from remote…`, icon: <Trash size={I} />, danger: true, onClick: () => git.deleteRemoteBranch(repo, r) })
  }
  if (pill.kind === 'tag') {
    if (hasRemotes(tab)) items.push({ label: `Push tag ${name}`, icon: <Upload size={I} />, onClick: () => git.pushTag(repo, name) })
    items.push({ label: `Delete tag ${name}…`, icon: <Trash size={I} />, danger: true, onClick: () => git.deleteTag(repo, ref) })
  }

  items.push(
    { type: 'separator' },
    { label: 'Create branch here…', icon: <GitBranch size={I} />, onClick: () => git.createBranch(repo, ref.sha) },
    { label: `Copy ${pill.kind === 'tag' ? 'tag' : 'branch'} name`, icon: <Copy size={I} />, onClick: () => git.copyText(name, `Copied ${name}`) },
    { type: 'separator' }
  )
  const all = [ref, ...pill.remotes]
  items.push({
    label: `Hide ${name} from graph`,
    icon: <EyeOff size={I} />,
    onClick: () => store().setRefsHidden(repo, all.map((r) => r.fullName), true)
  })
  const solo = tab?.soloRef ?? null
  if (solo === ref.fullName) items.push({ label: 'Un-solo', icon: <Focus size={I} />, checked: true, onClick: () => store().setSoloRef(repo, null) })
  else items.push({ label: `Solo ${name}`, icon: <Focus size={I} />, onClick: () => store().setSoloRef(repo, ref.fullName) })
  return items
}

// ── Commits ────────────────────────────────────────────────────────────────

export function commitMenu(repo: string, commit: Commit, pills: readonly Pill[] | undefined): MenuItem[] {
  const tab = tabOf(repo)
  const head = tab?.refs?.head ?? tab?.info?.head ?? null
  const headSha = head?.sha ?? null
  const isHead = headSha === commit.sha
  const isMerge = commit.parents.length > 1
  const curLabel = currentBranch(tab?.refs ?? null)?.name ?? 'HEAD'
  const items: MenuItem[] = []

  if (pills?.length) {
    for (const p of pills.slice(0, 8)) items.push({ label: p.label, icon: pillIcon(p), submenu: refMenu(repo, p) })
    items.push({ type: 'separator' })
  }

  if (!(isHead && head?.detached)) {
    items.push({ label: 'Checkout this commit (detached HEAD)', icon: <Crosshair size={I} />, onClick: () => void git.checkout(repo, commit.sha) })
  }
  items.push(
    { label: 'Create branch here…', icon: <GitBranch size={I} />, onClick: () => git.createBranch(repo, commit.sha) },
    { label: 'Create tag here…', icon: <Tag size={I} />, onClick: () => git.createTag(repo, commit.sha) },
    { type: 'separator' }
  )
  if (!isHead && headSha) {
    items.push({
      label: isMerge ? 'Cherry-pick merge commit (mainline 1)' : 'Cherry-pick commit',
      icon: <Cherry size={I} />,
      onClick: () => git.cherryPick(repo, [commit.sha])
    })
  }
  items.push({ label: 'Revert commit', icon: <Undo2 size={I} />, onClick: () => git.revert(repo, commit.sha, isMerge) })

  if (headSha) {
    items.push(
      { type: 'separator' },
      {
        label: `Reset ${curLabel} to this commit`,
        icon: <RotateCcw size={I} />,
        submenu: [
          { label: 'Soft — keep all changes staged', onClick: () => git.reset(repo, commit.sha, 'soft') },
          { label: 'Mixed — keep changes unstaged', onClick: () => git.reset(repo, commit.sha, 'mixed') },
          { label: 'Hard — discard all changes', danger: true, onClick: () => git.reset(repo, commit.sha, 'hard') }
        ]
      }
    )
    const inHistory = !!tab && isAncestor(tab.commits, commit.sha, headSha)
    // "From here" edits the commits after this one; a root commit has no parent to
    // use as the base, so it gets its own entry that includes it (git rebase -i --root).
    if (!isHead && inHistory) {
      items.push({
        label: `Interactive rebase ${curLabel} from here…`,
        icon: <ListOrdered size={I} />,
        onClick: () => git.startInteractiveRebase(repo, commit.sha)
      })
    }
    if (commit.parents.length === 0 && inHistory) {
      items.push({
        label: `Interactive rebase ${curLabel} from root…`,
        icon: <ListOrdered size={I} />,
        onClick: () => git.startInteractiveRebase(repo, 'ROOT')
      })
    }
  }

  items.push(
    { type: 'separator' },
    { label: 'Copy commit SHA', icon: <Copy size={I} />, onClick: () => git.copyText(commit.sha, 'Copied commit SHA') },
    { label: 'Copy commit message', icon: <Copy size={I} />, onClick: () => git.copyText(fullMessage(commit), 'Copied commit message') }
  )
  return items
}

export function multiCommitMenu(repo: string, shas: readonly string[]): MenuItem[] {
  const tab = tabOf(repo)
  if (!tab) return []
  const selected = oldestFirst(tab.commits, shas)
  const n = selected.length
  const anyMerge = selected.some((c) => c.parents.length > 1)
  const items: MenuItem[] = [
    { type: 'header', label: `${n} commits selected` },
    {
      label: anyMerge ? `Cherry-pick ${n} commits (merges use mainline 1)` : `Cherry-pick ${n} commits`,
      icon: <Cherry size={I} />,
      disabled: n === 0,
      onClick: () => git.cherryPick(repo, selected.map((c) => c.sha))
    }
  ]
  if (n === 2) {
    items.push({
      label: `Compare ${short(selected[0].sha)} ↔ ${short(selected[1].sha)}`,
      icon: <GitCompare size={I} />,
      onClick: () => {
        if (store().rightCollapsed) store().toggleRight()
      }
    })
  }
  items.push(
    { type: 'separator' },
    {
      label: 'Copy commit SHAs',
      icon: <Copy size={I} />,
      onClick: () => git.copyText(selected.map((c) => c.sha).join('\n'), `Copied ${n} SHAs`)
    }
  )
  return items
}

// ── Stash & WIP ────────────────────────────────────────────────────────────

export function stashMenu(repo: string, stash: Stash): MenuItem[] {
  return [
    { type: 'header', label: stash.ref },
    { label: 'Apply stash', icon: <ArchiveRestore size={I} />, onClick: () => git.applyStash(repo, stash.index) },
    { label: 'Pop stash', icon: <Archive size={I} />, onClick: () => git.popStash(repo, stash.index) },
    { type: 'separator' },
    { label: 'Create branch here…', icon: <GitBranch size={I} />, onClick: () => git.createBranch(repo, stash.baseSha) },
    { label: 'Copy stash message', icon: <Copy size={I} />, onClick: () => git.copyText(stash.message, 'Copied stash message') },
    { type: 'separator' },
    { label: 'Delete stash…', icon: <Trash size={I} />, danger: true, onClick: () => git.dropStash(repo, stash.index) }
  ]
}

export function wipMenu(repo: string): MenuItem[] {
  const tab = tabOf(repo)
  const st = tab?.status
  const hasUnstaged = !!st?.unstaged.length
  const hasStaged = !!st?.staged.length
  return [
    { label: 'Stage all changes', icon: <Plus size={I} />, disabled: !hasUnstaged, onClick: () => git.stageAll(repo) },
    { label: 'Unstage all changes', icon: <Undo2 size={I} />, disabled: !hasStaged, onClick: () => git.unstageAll(repo) },
    { type: 'separator' },
    { label: 'Stash all changes', icon: <Archive size={I} />, onClick: () => git.stash(repo) },
    { label: 'Stash with message…', icon: <Archive size={I} />, onClick: () => git.stash(repo, { askMessage: true }) },
    { type: 'separator' },
    { label: 'Discard all unstaged changes…', icon: <Trash size={I} />, danger: true, disabled: !hasUnstaged, onClick: () => git.discardAll(repo) }
  ]
}

// ── Header ─────────────────────────────────────────────────────────────────

export function headerMenu(repo: string, onResetWidths: () => void): MenuItem[] {
  const s = store()
  const { graphColumns: cols, graphShowRemotes, graphShowTags, graphShowStashes } = s.settings
  const toggleCol = (k: keyof typeof cols) => void s.updateSettings({ graphColumns: { ...cols, [k]: !cols[k] } })
  return [
    { type: 'header', label: 'Columns' },
    { label: 'Author', checked: cols.author, onClick: () => toggleCol('author') },
    { label: 'Date', checked: cols.date, onClick: () => toggleCol('date') },
    { label: 'SHA', checked: cols.sha, onClick: () => toggleCol('sha') },
    { type: 'separator' },
    { type: 'header', label: 'Show in graph' },
    {
      label: 'Remote branches',
      checked: graphShowRemotes,
      onClick: async () => {
        await s.updateSettings({ graphShowRemotes: !graphShowRemotes })
        void store().refresh(repo, ['log'])
      }
    },
    { label: 'Tags', checked: graphShowTags, onClick: () => void s.updateSettings({ graphShowTags: !graphShowTags }) },
    { label: 'Stashes', checked: graphShowStashes, onClick: () => void s.updateSettings({ graphShowStashes: !graphShowStashes }) },
    { type: 'separator' },
    { label: 'Reset column widths', onClick: onResetWidths }
  ]
}
