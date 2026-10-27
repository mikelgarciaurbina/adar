// Context-menu builders for every kind of left-panel row. Kept free of JSX
// (icons via createElement) so the item logic can be unit-tested.

import { createElement, type ComponentType } from 'react'
import {
  Archive,
  ArchiveRestore,
  Box,
  BrushCleaning,
  Check,
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FastForward,
  FolderOpen,
  GitBranchPlus,
  GitMerge,
  GitPullRequest,
  GitPullRequestArrow,
  Link,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Tag,
  Trash2,
  Upload
} from 'lucide-react'
import * as git from '@renderer/actions/git'
import { openBranchCleanup, useSafeToDelete } from '@renderer/actions/cleanup'
import { checkoutPull, copyPullLink, openWebPage, startPullRequest } from '@renderer/actions/pulls'
import type { MenuItem } from '@renderer/components/common/ContextMenu'
import { branchPullItems } from '@renderer/components/pulls/menus'
import { pullNounFor, usePulls } from '@renderer/components/pulls/pullStore'
import { providerName, pullRef } from '@renderer/lib/pulls'
import { currentBranch, localForRemote } from '@renderer/lib/refs'
import { useApp } from '@renderer/store/appStore'
import type { PullRequest } from '@shared/hosting'
import type { Ref, RefsResult, RemoteInfo, Stash, Submodule } from '@shared/types'
import {
  editRemoteUrl,
  fetchRemote,
  openRemoteInBrowser,
  openSubmodule,
  removeRemote,
  renameRemote,
  setRefsHidden,
  toggleSolo,
  updateSubmodules
} from './ops'
import { remoteProvider, remoteWebUrl } from '@shared/remoteUrl'
import type { SectionId } from './tree'

export interface SidebarMenuCtx {
  repo: string
  refs: RefsResult
  remotes: readonly RemoteInfo[]
  hidden: ReadonlySet<string>
  soloRef: string | null
}

const icon = (C: ComponentType<{ size?: number }>) => createElement(C, { size: 14 })
const SEP: MenuItem = { type: 'separator' }

/** Name to use for "into <current>" labels: branch, "HEAD" when detached, null when unborn/unknown. */
export function currentLabel(refs: RefsResult): string | null {
  if (refs.head.unborn) return null
  const cur = currentBranch(refs)
  if (cur) return cur.name
  return refs.head.detached && refs.head.sha ? 'HEAD' : null
}

/** A local branch that is behind (and not ahead of) a live upstream can be fast-forwarded. */
export function canFastForward(b: Ref): boolean {
  return !!b.upstream && !b.upstreamGone && (b.behind ?? 0) > 0 && (b.ahead ?? 0) === 0
}

function visibilityItems(ctx: SidebarMenuCtx, ref: Ref): MenuItem[] {
  const hidden = ctx.hidden.has(ref.fullName)
  const solo = ctx.soloRef === ref.fullName
  return [
    {
      label: hidden ? 'Show in graph' : 'Hide in graph',
      icon: icon(hidden ? Eye : EyeOff),
      onClick: () => useApp.getState().setRefHidden(ctx.repo, ref.fullName, !hidden)
    },
    {
      label: solo ? 'Un-solo' : 'Solo',
      icon: icon(Crosshair),
      checked: solo,
      onClick: () => toggleSolo(ctx.repo, ref.fullName)
    }
  ]
}

function shaItem(sha: string): MenuItem {
  return { label: 'Copy commit SHA', icon: icon(Copy), onClick: () => git.copyText(sha, 'Copied commit SHA') }
}

function mergeRebaseItems(ctx: SidebarMenuCtx, name: string): MenuItem[] {
  const cur = currentLabel(ctx.refs)
  if (!cur || cur === name) return []
  return [
    { label: `Merge ${name} into ${cur}`, icon: icon(GitMerge), onClick: () => git.merge(ctx.repo, name) },
    { label: `Rebase ${cur} onto ${name}`, icon: icon(GitPullRequestArrow), onClick: () => git.rebase(ctx.repo, name) }
  ]
}

// ── Branches & tags ────────────────────────────────────────────────────────

export function localBranchMenu(ctx: SidebarMenuCtx, b: Ref): MenuItem[] {
  const { repo } = ctx
  const isCur = !!b.isHead
  const items: MenuItem[] = [
    { type: 'header', label: b.name },
    { label: 'Checkout', icon: icon(Check), disabled: isCur, onClick: () => void git.checkoutRef(repo, b) }
  ]
  if (isCur) items.push({ label: 'Pull', icon: icon(Download), onClick: () => git.pull(repo) })
  else if (canFastForward(b))
    items.push({ label: `Fast-forward to ${b.upstream}`, icon: icon(FastForward), onClick: () => git.fastForward(repo, b.name, b.upstream!) })
  items.push({ label: `Push ${b.name}`, icon: icon(Upload), onClick: () => git.push(repo, { branch: b.name }) })
  items.push(SEP, ...mergeRebaseItems(ctx, b.name))
  items.push(
    SEP,
    { label: 'Create branch here…', icon: icon(GitBranchPlus), onClick: () => git.createBranch(repo, b.name) },
    { label: 'Create tag here…', icon: icon(Tag), onClick: () => git.createTag(repo, b.sha) },
    { label: 'Rename…', icon: icon(Pencil), onClick: () => git.renameBranch(repo, b) },
    { label: 'Delete…', icon: icon(Trash2), danger: true, onClick: () => git.deleteBranch(repo, b) },
    // A branch already in the main branch: offer to clean up all of them at once.
    ...(useSafeToDelete.getState().safe[repo]?.includes(b.name)
      ? [{ label: 'Clean up merged branches…', icon: icon(BrushCleaning), onClick: () => openBranchCleanup(repo) }]
      : []),
    { label: b.upstream ? `Set upstream… (${b.upstream})` : 'Set upstream…', icon: icon(Link), onClick: () => git.setUpstreamDialog(repo, b) },
    SEP,
    { label: 'Copy branch name', icon: icon(Copy), onClick: () => git.copyText(b.name, 'Copied branch name') },
    shaItem(b.sha),
    ...branchPullItems(repo, [b], ctx.refs),
    SEP,
    ...visibilityItems(ctx, b)
  )
  return items
}

export function remoteBranchMenu(ctx: SidebarMenuCtx, r: Ref): MenuItem[] {
  const { repo } = ctx
  const local = localForRemote(ctx.refs, r)
  const items: MenuItem[] = [
    { type: 'header', label: r.name },
    {
      label: local ? `Checkout ${local.name}` : 'Checkout (create tracking branch)',
      icon: icon(Check),
      disabled: !!local?.isHead,
      onClick: () => void git.checkoutRemote(repo, r)
    }
  ]
  if (local && !local.isHead && canFastForward(local))
    items.push({ label: `Fast-forward ${local.name} to ${r.name}`, icon: icon(FastForward), onClick: () => git.fastForward(repo, local.name, r.name) })
  items.push(SEP, ...mergeRebaseItems(ctx, r.name))
  items.push(
    SEP,
    { label: 'Create branch here…', icon: icon(GitBranchPlus), onClick: () => git.createBranch(repo, r.name) },
    { label: 'Delete from remote…', icon: icon(Trash2), danger: true, onClick: () => git.deleteRemoteBranch(repo, r) },
    SEP,
    { label: 'Copy branch name', icon: icon(Copy), onClick: () => git.copyText(r.name, 'Copied branch name') },
    shaItem(r.sha),
    ...branchPullItems(repo, [r], ctx.refs),
    SEP,
    ...visibilityItems(ctx, r)
  )
  return items
}

export function tagMenu(ctx: SidebarMenuCtx, t: Ref): MenuItem[] {
  const { repo } = ctx
  const hasRemotes = ctx.remotes.length > 0
  return [
    { type: 'header', label: t.name },
    { label: 'Checkout (detached HEAD)', icon: icon(Check), onClick: () => void git.checkoutRef(repo, t) },
    { label: 'Create branch here…', icon: icon(GitBranchPlus), onClick: () => git.createBranch(repo, t.name) },
    SEP,
    ...mergeRebaseItems(ctx, t.name).slice(0, 1),
    SEP,
    { label: 'Push tag', icon: icon(Upload), disabled: !hasRemotes, onClick: () => git.pushTag(repo, t.name) },
    { label: 'Delete…', icon: icon(Trash2), danger: true, onClick: () => git.deleteTag(repo, t) },
    SEP,
    { label: 'Copy tag name', icon: icon(Copy), onClick: () => git.copyText(t.name, 'Copied tag name') },
    shaItem(t.sha),
    SEP,
    ...visibilityItems(ctx, t)
  ]
}

/** Detached HEAD / unborn branch pseudo-row. */
export function headMenu(ctx: SidebarMenuCtx, sha: string | null): MenuItem[] {
  if (!sha) return [{ label: 'Make a first commit to create this branch', disabled: true }]
  return [
    { type: 'header', label: `Detached HEAD · ${sha.slice(0, 7)}` },
    { label: 'Create branch here…', icon: icon(GitBranchPlus), onClick: () => git.createBranch(ctx.repo, sha) },
    { label: 'Create tag here…', icon: icon(Tag), onClick: () => git.createTag(ctx.repo, sha) },
    SEP,
    shaItem(sha)
  ]
}

// ── Remotes ────────────────────────────────────────────────────────────────

export function remoteMenu(
  ctx: SidebarMenuCtx,
  remote: { name: string; url: string | null; refs: Ref[] },
  state: { fetching: boolean }
): MenuItem[] {
  const { repo } = ctx
  const web = remote.url ? remoteWebUrl(remote.url) : null
  const provider = remote.url ? remoteProvider(remote.url) : null
  const names = remote.refs.map((r) => r.fullName)
  const allHidden = names.length > 0 && names.every((n) => ctx.hidden.has(n))
  const configured = ctx.remotes.some((r) => r.name === remote.name)
  return [
    { type: 'header', label: remote.name },
    { label: `Fetch ${remote.name}`, icon: icon(RefreshCw), disabled: state.fetching, onClick: () => fetchRemote(repo, remote.name) },
    SEP,
    { label: 'Edit URL…', icon: icon(Pencil), disabled: !configured, onClick: () => editRemoteUrl(repo, remote.name, remote.url) },
    { label: 'Rename…', icon: icon(Pencil), disabled: !configured, onClick: () => renameRemote(repo, remote.name) },
    { label: 'Remove…', icon: icon(Trash2), danger: true, disabled: !configured, onClick: () => removeRemote(repo, remote.name) },
    SEP,
    { label: 'Copy URL', icon: icon(Copy), disabled: !remote.url, onClick: () => git.copyText(remote.url ?? '', 'Copied remote URL') },
    { label: provider ? `Open on ${provider}` : 'Open in browser', icon: icon(ExternalLink), disabled: !web, onClick: () => openRemoteInBrowser(remote.url) },
    SEP,
    {
      label: allHidden ? 'Show all branches in graph' : 'Hide all branches in graph',
      icon: icon(allHidden ? Eye : EyeOff),
      disabled: names.length === 0,
      onClick: () => setRefsHidden(repo, names, !allHidden)
    },
    { label: 'Manage remotes…', icon: icon(Settings), onClick: () => useApp.getState().openModal({ kind: 'remotes', repo }) }
  ]
}

// ── Stashes & submodules ──────────────────────────────────────────────────

export function stashMenu(ctx: SidebarMenuCtx, s: Stash): MenuItem[] {
  const { repo } = ctx
  return [
    { type: 'header', label: s.ref },
    { label: 'Apply stash', icon: icon(ArchiveRestore), onClick: () => git.applyStash(repo, s.index) },
    { label: 'Pop stash', icon: icon(Archive), onClick: () => git.popStash(repo, s.index) },
    { label: 'Delete stash…', icon: icon(Trash2), danger: true, onClick: () => git.dropStash(repo, s.index) },
    SEP,
    { label: 'Copy stash message', icon: icon(Copy), onClick: () => git.copyText(s.message, 'Copied stash message') }
  ]
}

export function submoduleMenu(ctx: SidebarMenuCtx, sm: Submodule): MenuItem[] {
  const { repo } = ctx
  const initialized = sm.status !== 'uninitialized'
  return [
    { type: 'header', label: sm.path },
    { label: 'Open submodule', icon: icon(Box), disabled: !initialized, onClick: () => openSubmodule(repo, sm.path) },
    { label: initialized ? 'Update submodules' : 'Initialize & update submodules', icon: icon(RefreshCw), onClick: () => updateSubmodules(repo) },
    SEP,
    { label: 'Copy path', icon: icon(Copy), onClick: () => git.copyText(sm.path, 'Copied submodule path') },
    { label: 'Copy URL', icon: icon(Copy), disabled: !sm.url, onClick: () => git.copyText(sm.url, 'Copied submodule URL') },
    { label: 'Reveal in Finder', icon: icon(FolderOpen), disabled: !initialized, onClick: () => git.showInFolder(git.absPath(repo, sm.path)) },
    ...(sm.sha ? [shaItem(sm.sha)] : [])
  ]
}

// ── Sections & folders ────────────────────────────────────────────────────

export interface ContainerMenuState {
  /** Refs below the node (for bulk hide/show). */
  refs: Ref[]
  canExpandAll: boolean
  expandAll: () => void
  collapseAll: () => void
}

function bulkVisibility(ctx: SidebarMenuCtx, refs: Ref[], what: string): MenuItem[] {
  if (!refs.length) return []
  const names = refs.map((r) => r.fullName)
  const allHidden = names.every((n) => ctx.hidden.has(n))
  return [
    {
      label: allHidden ? `Show all ${what} in graph` : `Hide all ${what} in graph`,
      icon: icon(allHidden ? Eye : EyeOff),
      onClick: () => setRefsHidden(ctx.repo, names, !allHidden)
    }
  ]
}

export function sectionMenu(ctx: SidebarMenuCtx, id: SectionId, state: ContainerMenuState): MenuItem[] {
  const { repo } = ctx
  const headSha = ctx.refs.head.sha
  const expandItems: MenuItem[] = state.canExpandAll
    ? [
        { label: 'Expand all folders', onClick: state.expandAll },
        { label: 'Collapse all folders', onClick: state.collapseAll }
      ]
    : []
  switch (id) {
    case 'local':
      return [
        { label: 'Create branch…', icon: icon(Plus), disabled: !headSha, onClick: () => git.createBranch(repo) },
        { label: 'Clean up branches…', icon: icon(BrushCleaning), disabled: !headSha, onClick: () => openBranchCleanup(repo) },
        SEP,
        ...expandItems,
        SEP,
        ...bulkVisibility(ctx, state.refs, 'local branches')
      ]
    case 'remote':
      return [
        { label: 'Add remote…', icon: icon(Plus), onClick: () => useApp.getState().openModal({ kind: 'remotes', repo }) },
        { label: 'Fetch all', icon: icon(RefreshCw), disabled: ctx.remotes.length === 0, onClick: () => git.fetchAll(repo) },
        SEP,
        ...expandItems,
        SEP,
        ...bulkVisibility(ctx, state.refs, 'remote branches')
      ]
    case 'tags':
      return [
        {
          label: 'Create tag at HEAD…',
          icon: icon(Tag),
          disabled: !headSha,
          onClick: () => {
            if (headSha) void git.createTag(repo, headSha)
          }
        },
        SEP,
        ...bulkVisibility(ctx, state.refs, 'tags')
      ]
    case 'stashes':
      return [{ label: 'Stash changes…', icon: icon(Archive), onClick: () => git.stash(repo, { askMessage: true }) }]
    case 'submodules':
      return [{ label: 'Update submodules', icon: icon(RefreshCw), onClick: () => updateSubmodules(repo) }]
    case 'pulls':
      return [
        { label: `Create ${pullNounFor(repo)}…`, icon: icon(GitPullRequest), onClick: () => void startPullRequest(repo) },
        { label: 'Refresh', icon: icon(RefreshCw), onClick: () => void usePulls.getState().load(repo, { force: true }) }
      ]
  }
}

// ── Pull requests ──────────────────────────────────────────────────────────

export function pullMenu(ctx: SidebarMenuCtx, pr: PullRequest): MenuItem[] {
  const { repo } = ctx
  return [
    { type: 'header', label: `${pullRef(pr)} ${pr.title}` },
    { label: 'Check out', icon: icon(Check), onClick: () => void checkoutPull(repo, pr) },
    { label: `Open on ${providerName(pr)}`, icon: icon(ExternalLink), onClick: () => openWebPage(pr.url) },
    SEP,
    { label: 'Copy link', icon: icon(Copy), onClick: () => copyPullLink(pr) },
    { label: 'Copy branch name', icon: icon(Copy), onClick: () => git.copyText(pr.headRef, 'Copied branch name') }
  ]
}

export function folderMenu(ctx: SidebarMenuCtx, label: string, expanded: boolean, toggle: () => void, state: ContainerMenuState): MenuItem[] {
  return [
    { type: 'header', label },
    { label: expanded ? 'Collapse' : 'Expand', onClick: toggle },
    ...(state.canExpandAll ? [{ label: 'Expand all subfolders', onClick: state.expandAll }, { label: 'Collapse all subfolders', onClick: state.collapseAll }] : []),
    SEP,
    ...bulkVisibility(ctx, state.refs, 'branches')
  ]
}
