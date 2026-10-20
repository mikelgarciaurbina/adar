// User-level git actions with UX: confirmations, toasts, busy indicators,
// conflict handling, refresh and undo/redo. Every UI entry point (toolbar,
// context menus, drag & drop, command palette, shortcuts) should call these
// instead of `api` directly so behaviour is consistent.

import { api, newOpId } from '@renderer/api/client'
import { choose, confirm, form, prompt, validateRefName } from '@renderer/components/common/dialogs'
import { showContextMenu, type MenuItem } from '@renderer/components/common/ContextMenu'
import { toast } from '@renderer/components/common/toast'
import type { DraggedRef } from '@renderer/lib/dnd'
import { refDropActions } from '@renderer/lib/refDrop'
import { currentBranch, defaultRemote, localForRemote, remoteBranchName } from '@renderer/lib/refs'
import { StaleHistoryError, useApp, type RefreshScope, type RepoTab } from '@renderer/store/appStore'
import { describeError, AdarError } from '@shared/errors'
import type { DiffTarget, OperationResult, PullMode, Ref, ResetMode } from '@shared/types'

// ── Helpers ────────────────────────────────────────────────────────────────

const store = () => useApp.getState()
const tabOf = (repo: string): RepoTab | undefined => store().tabs.find((t) => t.path === repo)
const ALL: RefreshScope[] = ['info', 'refs', 'log', 'status']

export function refresh(repo: string, scopes: RefreshScope[] = ALL): Promise<void> {
  return store().refresh(repo, scopes)
}

interface RunOpts<T> {
  /** Busy key suffix, e.g. 'push' → busy['push:/repo']. */
  busy?: string
  busyLabel?: string
  /** Toast on success. */
  success?: string | ((value: T) => string | null)
  /** Show a loading toast while running. */
  loadingToast?: string
  refresh?: RefreshScope[] | false
}

/** Run an async git operation with busy state, toasts and refresh. Returns undefined on failure (already toasted). */
async function run<T>(repo: string, opts: RunOpts<T>, fn: () => Promise<T>): Promise<T | undefined> {
  const busyKey = opts.busy ? `${opts.busy}:${repo}` : null
  if (busyKey) store().setBusy(busyKey, opts.busyLabel ?? opts.busy!)
  const loadingId = opts.loadingToast ? toast.loading(opts.loadingToast) : null
  let value: T | undefined
  try {
    value = await fn()
    const msg = typeof opts.success === 'function' ? opts.success(value) : opts.success
    if (loadingId !== null) {
      if (msg) toast.update(loadingId, { kind: 'success', message: msg })
      else toast.dismiss(loadingId)
    } else if (msg) toast.success(msg)
  } catch (err) {
    if (loadingId !== null) toast.dismiss(loadingId)
    if (!(err instanceof AdarError && err.code === 'CANCELLED')) toast.error(err)
    value = undefined
  } finally {
    if (busyKey) store().setBusy(busyKey, null)
  }
  // Awaited so callers observe fresh state once the action resolves.
  if (opts.refresh !== false) await refresh(repo, opts.refresh ?? ALL).catch(() => undefined)
  return value
}

function headSha(repo: string): string | null {
  return tabOf(repo)?.refs?.head.sha ?? tabOf(repo)?.info?.head.sha ?? null
}

function headLabel(repo: string): string | null {
  const head = tabOf(repo)?.refs?.head ?? tabOf(repo)?.info?.head
  if (!head) return null
  return head.branch ?? head.sha
}

function isDirty(repo: string): boolean {
  const st = tabOf(repo)?.status
  return !!st && (st.staged.length > 0 || st.unstaged.some((f) => f.status !== 'untracked') || st.conflicted.length > 0)
}

const OPERATION_LABEL: Record<string, string> = {
  merge: 'Merge',
  rebase: 'Rebase',
  'rebase-interactive': 'Rebase',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
  am: 'Patch application',
  bisect: 'Bisect'
}

/** Toast + navigation for operations that may stop on conflicts. */
export function handleOperationResult(repo: string, res: OperationResult | undefined, successMsg: string): boolean {
  if (!res) return false
  if (res.ok) {
    // Some successes come with a caveat worth showing (e.g. a stash applied without restoring its index).
    const note = /staging was kept|applied as unstaged/i.test(res.message) ? summarizeOutput(res.message) : ''
    if (note) toast.info(`${successMsg ? successMsg + '. ' : ''}${note}`)
    else if (successMsg) toast.success(successMsg)
    return true
  }
  if (res.conflicts.length) {
    const label = OPERATION_LABEL[res.state] ?? 'Operation'
    toast.warning(`${label} stopped with ${res.conflicts.length} conflicted file${res.conflicts.length === 1 ? '' : 's'}`, {
      actions: [{ label: 'Resolve conflicts', onClick: () => openConflict(repo, res.conflicts[0]) }]
    })
    store().select(repo, { kind: 'wip' })
    return false
  }
  if (res.state === 'rebase-interactive' || res.state === 'rebase') {
    toast.info(res.message || 'Rebase paused. Make your changes, then Continue.')
    store().select(repo, { kind: 'wip' })
    return false
  }
  const summary = summarizeOutput(res.message)
  toast.error(summary || 'Operation failed', { detail: res.message.trim() !== summary ? res.message.trim() : undefined })
  return false
}

/** First meaningful line of git output (no hints, status chatter or error:/fatal: prefixes). */
function summarizeOutput(text: string): string {
  const lines = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(hint:|on branch |your branch |\(use "git|nothing to commit|changes not staged|untracked files:)/i.test(l))
  const important = lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines[0] ?? ''
  return important.replace(/^(fatal|error|warning):\s*/i, '').replace(/:$/, '')
}

function isOverwriteError(err: unknown): boolean {
  const text = `${(err as AdarError)?.stderr ?? ''} ${(err as Error)?.message ?? ''}`
  return /would be overwritten|commit your changes or stash them|Please move or remove them/i.test(text)
}

// ── Repository lifecycle ──────────────────────────────────────────────────

export async function openRepoDialog(): Promise<void> {
  const dir = await api.pickDirectory({ title: 'Open a Git repository' })
  if (!dir) return
  await openRepoAt(dir)
}

export async function openRepoAt(dir: string): Promise<boolean> {
  try {
    await store().openRepo(dir)
    return true
  } catch (err) {
    if (err instanceof AdarError && err.code === 'UNTRUSTED_REPO') return trustAndOpen(dir, err)
    if (err instanceof AdarError && err.code === 'NOT_A_REPO') {
      const ok = await confirm({
        title: 'Not a Git repository',
        message: `${dir} is not a Git repository. Initialize one here?`,
        confirmLabel: 'Initialize'
      })
      if (ok) return initRepoAt(dir)
    } else if (err instanceof AdarError && err.code === 'NOT_FOUND') {
      const recent = store().recent.some((r) => r.path === dir)
      toast.error(`Folder not found: ${dir}`, {
        actions: recent
          ? [
              {
                label: 'Remove from recent',
                onClick: () => void api.removeRecentRepo(dir).then(() => store().refreshRecent())
              }
            ]
          : undefined
      })
    } else toast.error(err)
    return false
  }
}

/** A repository whose local config makes git run commands: show what it runs and let the user decide. */
async function trustAndOpen(dir: string, err: AdarError): Promise<boolean> {
  const entries = err.details ?? []
  const ok = await confirm({
    title: 'Trust this repository?',
    message: (
      <>
        <p style={{ margin: '0 0 8px' }}>
          Its configuration tells git to run these commands automatically. Only continue if you trust where this repository came from.
        </p>
        <pre className="selectable" style={{ margin: 0, maxHeight: 180, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {entries.join('\n') || err.message}
        </pre>
      </>
    ),
    confirmLabel: 'Trust and open',
    danger: true
  })
  if (!ok) return false
  try {
    await api.trustRepo(dir)
    await store().openRepo(dir)
    return true
  } catch (e) {
    toast.error(e)
    return false
  }
}

export async function initRepoAt(dir: string, initialBranch = 'main'): Promise<boolean> {
  try {
    const info = await api.initRepo(dir, { initialBranch })
    await store().openRepo(info.path)
    toast.success(`Initialized repository in ${info.name}`)
    return true
  } catch (err) {
    toast.error(err)
    return false
  }
}

/** Clone and open. Pass `opId` to follow progress events (store.progress[opId]). */
export async function cloneRepo(url: string, parentDir: string, dirName?: string, opId: string = newOpId('clone')): Promise<boolean> {
  const id = toast.loading(`Cloning ${url}…`)
  store().setBusy(`clone:${opId}`, 'Cloning…')
  try {
    const info = await api.cloneRepo(url, parentDir, { dirName: dirName || undefined, opId })
    toast.update(id, { kind: 'success', message: `Cloned ${info.name}` })
    await store().openRepo(info.path)
    return true
  } catch (err) {
    toast.dismiss(id)
    toast.error(err)
    return false
  } finally {
    store().setBusy(`clone:${opId}`, null)
    store().setProgress(opId, null)
  }
}

// ── Navigation helpers ────────────────────────────────────────────────────

export function openDiff(repo: string, target: DiffTarget, siblings?: DiffTarget[]): void {
  store().setCenter(repo, { kind: 'diff', target, siblings })
}

export function openConflict(repo: string, path: string): void {
  store().setCenter(repo, { kind: 'conflict', path })
}

export function openFileHistory(repo: string, path: string): void {
  store().setCenter(repo, { kind: 'history', path })
}

export function openBlame(repo: string, path: string, rev?: string): void {
  store().setCenter(repo, { kind: 'blame', path, rev })
}

export function showGraph(repo: string): void {
  store().setCenter(repo, { kind: 'graph' })
}

export async function copyText(text: string, what = 'Copied to clipboard'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(what)
    return
  } catch {
    // navigator.clipboard rejects when the document is not focused (e.g. right after a menu click).
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (ok) toast.success(what)
  else toast.error('Could not access the clipboard')
}

// ── Checkout & branches ───────────────────────────────────────────────────

/** Checkout a local branch, tag or sha (handles a dirty working tree). */
export async function checkout(repo: string, ref: string, opts: { silent?: boolean } = {}): Promise<boolean> {
  const previous = headLabel(repo)
  const doCheckout = async (force?: boolean) => {
    await api.checkout(repo, ref, { force })
  }
  store().setBusy(`checkout:${repo}`, `Checking out ${ref}…`)
  try {
    try {
      await doCheckout()
    } catch (err) {
      if (!isOverwriteError(err)) throw err
      const choice = await choose<'stash' | 'force'>({
        title: `Checkout ${ref}`,
        message: 'Your local changes would be overwritten by this checkout.',
        options: [
          { value: 'stash', label: 'Stash changes and checkout', description: 'Your changes are saved in a stash you can pop later.' },
          { value: 'force', label: 'Discard changes and checkout', description: 'Local modifications are lost.', danger: true }
        ]
      })
      if (!choice) return false
      if (choice === 'stash') {
        await api.stashSave(repo, { includeUntracked: true, message: `Auto-stash before checkout of ${ref}` })
        await doCheckout()
        toast.info('Changes were stashed', { actions: [{ label: 'Pop stash', onClick: () => void popStash(repo, 0) }] })
      } else await doCheckout(true)
    }
    if (!opts.silent) toast.success(`Checked out ${ref}`)
    if (previous && previous !== ref) {
      store().pushHistory(repo, {
        label: `Checkout ${ref}`,
        undo: async () => {
          await api.checkout(repo, previous)
          await refresh(repo)
        },
        redo: async () => {
          await api.checkout(repo, ref)
          await refresh(repo)
        }
      })
    }
    return true
  } catch (err) {
    toast.error(err)
    return false
  } finally {
    store().setBusy(`checkout:${repo}`, null)
    void refresh(repo)
  }
}

/** Checkout a remote branch: uses the existing tracking branch or creates one. */
export async function checkoutRemote(repo: string, remoteRef: Ref): Promise<boolean> {
  const local = localForRemote(tabOf(repo)?.refs ?? null, remoteRef)
  if (local) {
    const ok = await checkout(repo, local.name)
    if (ok && local.behind && local.behind > 0 && !local.ahead) {
      toast.info(`${local.name} is ${local.behind} commit(s) behind ${remoteRef.name}`, {
        actions: [{ label: 'Fast-forward', onClick: () => void fastForward(repo, local.name, remoteRef.name) }]
      })
    }
    return ok
  }
  // The backend creates a local tracking branch named like the remote branch.
  const localName = remoteBranchName(remoteRef)
  const ok = await checkout(repo, remoteRef.name, { silent: true })
  if (ok) toast.success(`Created ${localName} tracking ${remoteRef.name}`)
  return ok
}

/** Double-click / checkout on any ref. */
export async function checkoutRef(repo: string, ref: Pick<Ref, 'name' | 'type'> & Partial<Ref>): Promise<boolean> {
  if (ref.type === 'remote') return checkoutRemote(repo, ref as Ref)
  return checkout(repo, ref.name)
}

export async function createBranch(repo: string, startPoint?: string, opts: { checkout?: boolean } = {}): Promise<void> {
  const where = startPoint ? (startPoint.length === 40 ? startPoint.slice(0, 7) : startPoint) : headLabel(repo) ?? 'HEAD'
  const name = await prompt({
    title: 'Create branch',
    message: `New branch at ${where}`,
    label: 'Branch name',
    placeholder: 'feature/my-change',
    confirmLabel: opts.checkout === false ? 'Create' : 'Create and checkout',
    monospace: true,
    validate: (v) => validateRefName(v) ?? (tabOf(repo)?.refs?.branches.some((b) => b.name === v.trim()) ? 'A branch with this name already exists' : null)
  })
  if (!name) return
  const branch = name.trim()
  const checkoutNew = opts.checkout !== false
  const previous = headLabel(repo)
  const ok = await run(repo, { success: `Created branch ${branch}` }, () =>
    api.createBranch(repo, branch, startPoint, { checkout: checkoutNew }).then(() => true)
  )
  const createdTip = ok ? tabOf(repo)?.refs?.branches.find((b) => b.name === branch)?.sha : undefined
  if (ok) {
    store().pushHistory(repo, {
      label: `Create branch ${branch}`,
      undo: async () => {
        // Force-delete only while the branch still points where it was created; otherwise let git refuse
        // to delete unmerged work.
        const refs = await api.getRefs(repo)
        const tip = refs.branches.find((b) => b.name === branch)?.sha
        const createdAt = createdTip ?? tip
        if (checkoutNew && previous) await api.checkout(repo, previous)
        await api.deleteBranch(repo, branch, { force: !!tip && tip === createdAt })
        await refresh(repo)
      },
      redo: async () => {
        await api.createBranch(repo, branch, startPoint, { checkout: checkoutNew })
        await refresh(repo)
      }
    })
  }
}

export async function deleteBranch(repo: string, branch: Ref): Promise<void> {
  if (branch.isHead) {
    toast.error('Cannot delete the checked-out branch. Checkout another branch first.')
    return
  }
  const ok = await confirm({
    title: `Delete branch ${branch.name}?`,
    message: branch.upstream ? `The remote branch ${branch.upstream} is not deleted.` : undefined,
    confirmLabel: 'Delete',
    danger: true
  })
  if (!ok) return
  const sha = branch.sha
  const upstream = branch.upstream
  const doDelete = async (force: boolean) => {
    await api.deleteBranch(repo, branch.name, { force })
  }
  try {
    try {
      await doDelete(false)
    } catch (err) {
      if (!/not fully merged/i.test(`${(err as AdarError).stderr ?? ''} ${(err as Error).message}`)) throw err
      const force = await confirm({
        title: `${branch.name} is not fully merged`,
        message: 'Deleting it may lose commits that are not on any other branch. Delete anyway?',
        confirmLabel: 'Force delete',
        danger: true
      })
      if (!force) return
      await doDelete(true)
    }
    toast.success(`Deleted branch ${branch.name}`)
    store().pushHistory(repo, {
      label: `Delete branch ${branch.name}`,
      undo: async () => {
        await api.createBranch(repo, branch.name, sha, { checkout: false })
        if (upstream) await api.setUpstream(repo, branch.name, upstream).catch(() => undefined)
        await refresh(repo)
      },
      redo: async () => {
        await api.deleteBranch(repo, branch.name, { force: true })
        await refresh(repo)
      }
    })
  } catch (err) {
    toast.error(err)
  } finally {
    void refresh(repo)
  }
}

export async function deleteRemoteBranch(repo: string, remoteRef: Ref): Promise<void> {
  const remote = remoteRef.remote ?? remoteRef.name.split('/')[0]
  const branch = remoteBranchName(remoteRef)
  const ok = await confirm({
    title: `Delete ${remoteRef.name} from ${remote}?`,
    message: 'This deletes the branch on the remote server for everyone.',
    confirmLabel: 'Delete remote branch',
    danger: true
  })
  if (!ok) return
  await run(repo, { busy: 'push', busyLabel: 'Deleting remote branch…', success: `Deleted ${remoteRef.name}` }, () =>
    api.deleteRemoteBranch(repo, remote, branch)
  )
}

export async function renameBranch(repo: string, branch: Ref): Promise<void> {
  const name = await prompt({
    title: `Rename ${branch.name}`,
    label: 'New name',
    defaultValue: branch.name,
    monospace: true,
    confirmLabel: 'Rename',
    validate: (v) => validateRefName(v) ?? (v.trim() !== branch.name && tabOf(repo)?.refs?.branches.some((b) => b.name === v.trim()) ? 'Name already in use' : null)
  })
  if (!name || name.trim() === branch.name) return
  const next = name.trim()
  const ok = await run(repo, { success: `Renamed to ${next}` }, () => api.renameBranch(repo, branch.name, next).then(() => true))
  if (ok)
    store().pushHistory(repo, {
      label: `Rename ${branch.name}`,
      undo: async () => {
        await api.renameBranch(repo, next, branch.name)
        await refresh(repo)
      },
      redo: async () => {
        await api.renameBranch(repo, branch.name, next)
        await refresh(repo)
      }
    })
}

export async function setUpstreamDialog(repo: string, branch: Ref): Promise<void> {
  const remotes = tabOf(repo)?.refs?.remotes.filter((r) => !r.isSymbolic) ?? []
  const options = [{ value: '', label: '— none (unset upstream) —' }, ...remotes.map((r) => ({ value: r.name, label: r.name }))]
  const res = await form({
    title: `Set upstream for ${branch.name}`,
    fields: [{ type: 'select', name: 'upstream', label: 'Upstream branch', options, defaultValue: branch.upstream ?? '' }],
    confirmLabel: 'Save'
  })
  if (!res) return
  const up = String(res.upstream) || null
  await run(repo, { success: up ? `${branch.name} now tracks ${up}` : `Upstream unset`, refresh: ['refs'] }, () =>
    api.setUpstream(repo, branch.name, up)
  )
}

export async function fastForward(repo: string, branch: string, to: string): Promise<void> {
  const cur = currentBranch(tabOf(repo)?.refs ?? null)
  if (cur?.name === branch) {
    const res = await run(repo, { busy: 'merge', busyLabel: 'Fast-forwarding…' }, () => api.merge(repo, to, { ffOnly: true }))
    handleOperationResult(repo, res, `Fast-forwarded ${branch} to ${to}`)
  } else {
    await run(repo, { success: `Fast-forwarded ${branch} to ${to}` }, () => api.fastForwardBranch(repo, branch, to))
  }
}

/** Merge `source` into `into` (default: current branch). Checks out `into` first when needed. */
export async function merge(repo: string, source: string, into?: string): Promise<void> {
  const cur = currentBranch(tabOf(repo)?.refs ?? null)
  if (into && cur?.name !== into) {
    const ok = await confirm({
      title: `Merge ${source} into ${into}`,
      message: `${into} will be checked out first.`,
      confirmLabel: 'Checkout and merge'
    })
    if (!ok || !(await checkout(repo, into, { silent: true }))) return
  }
  const target = into ?? cur?.name ?? 'HEAD'
  const res = await run(repo, { busy: 'merge', busyLabel: `Merging ${source}…` }, () => api.merge(repo, source))
  handleOperationResult(repo, res, `Merged ${source} into ${target}`)
}

/** Rebase `branch` (default: current) onto `onto`. */
export async function rebase(repo: string, onto: string, branch?: string): Promise<void> {
  const cur = currentBranch(tabOf(repo)?.refs ?? null)
  if (branch && cur?.name !== branch) {
    const ok = await confirm({
      title: `Rebase ${branch} onto ${onto}`,
      message: `${branch} will be checked out first.`,
      confirmLabel: 'Checkout and rebase'
    })
    if (!ok || !(await checkout(repo, branch, { silent: true }))) return
  }
  const name = branch ?? cur?.name ?? 'HEAD'
  const res = await run(repo, { busy: 'rebase', busyLabel: `Rebasing onto ${onto}…` }, () => api.rebase(repo, onto))
  handleOperationResult(repo, res, `Rebased ${name} onto ${onto}`)
}

export function startInteractiveRebase(repo: string, base: string): void {
  if (isDirty(repo)) {
    toast.warning('Commit or stash your changes before an interactive rebase.')
    return
  }
  store().setCenter(repo, { kind: 'rebase', base })
}

export async function cherryPick(repo: string, shas: string[]): Promise<void> {
  if (!shas.length) return
  const res = await run(repo, { busy: 'cherry-pick', busyLabel: 'Cherry-picking…' }, () => api.cherryPick(repo, shas))
  handleOperationResult(repo, res, shas.length === 1 ? `Cherry-picked ${shas[0].slice(0, 7)}` : `Cherry-picked ${shas.length} commits`)
}

export async function revert(repo: string, sha: string, isMerge = false): Promise<void> {
  let mainline: number | undefined
  if (isMerge) {
    const pick = await choose<number>({
      title: 'Revert merge commit',
      message: 'Which parent should be considered the mainline?',
      options: [
        { value: 1, label: 'Parent 1 (the branch merged into)', description: 'Usual choice' },
        { value: 2, label: 'Parent 2 (the merged branch)' }
      ]
    })
    if (!pick) return
    mainline = pick
  }
  const res = await run(repo, { busy: 'revert', busyLabel: 'Reverting…' }, () => api.revert(repo, sha, { mainline }))
  handleOperationResult(repo, res, `Reverted ${sha.slice(0, 7)}`)
}

export async function reset(repo: string, target: string, mode?: ResetMode): Promise<void> {
  const label = headLabel(repo) ?? 'HEAD'
  let chosen = mode
  if (!chosen) {
    chosen =
      (await choose<ResetMode>({
        title: `Reset ${label} to ${target.slice(0, 7)}`,
        options: [
          { value: 'soft', label: 'Soft', description: 'Keep all changes staged.' },
          { value: 'mixed', label: 'Mixed', description: 'Keep changes in the working directory, unstaged.' },
          { value: 'hard', label: 'Hard', description: 'Discard all changes. Uncommitted work is lost.', danger: true }
        ]
      })) ?? undefined
    if (!chosen) return
  }
  if (chosen === 'hard' && store().settings.confirmDangerous && isDirty(repo)) {
    const ok = await confirm({
      title: 'Hard reset with uncommitted changes',
      message: 'All uncommitted changes will be permanently discarded.',
      confirmLabel: 'Reset hard',
      danger: true
    })
    if (!ok) return
  }
  const before = headSha(repo)
  const m = chosen
  const ok = await run(repo, { success: `Reset ${label} to ${target.slice(0, 7)} (${m})` }, () => api.reset(repo, target, m).then(() => true))
  if (ok && before)
    store().pushHistory(repo, {
      label: `Reset (${m})`,
      // Undo with the same mode: mixed restores the index too (soft would leave a staged revert behind).
      undo: async () => {
        if (m === 'hard') await guardHardReset(repo, 'Undoing this hard reset')
        await api.reset(repo, before, m)
        await refresh(repo)
      },
      redo: async () => {
        if (m === 'hard') await guardHardReset(repo, 'Redoing this hard reset')
        await api.reset(repo, target, m)
        await refresh(repo)
      }
    })
}

// ── Drag & drop of refs ───────────────────────────────────────────────────

/** Show the GitKraken-style action menu when a ref is dropped on another ref. */
export function handleRefDrop(repo: string, source: DraggedRef, target: DraggedRef, at: { clientX: number; clientY: number }): void {
  if (source.fullName === target.fullName) return
  const refs = tabOf(repo)?.refs ?? null
  const cur = currentBranch(refs)?.name ?? null
  // Use the full ref name when a branch, remote branch and/or tag share the short name.
  const all = refs ? [...refs.branches, ...refs.remotes, ...refs.tags] : []
  const rev = (r: { name: string; fullName?: string }) =>
    r.fullName && all.filter((x) => x.name === r.name).length > 1 ? r.fullName : r.name
  const remote = target.type === 'remote' ? refs?.remotes.find((r) => r.fullName === target.fullName)?.remote : undefined
  const actions = refDropActions(source, { ...target, remote }, cur, rev)
  if (!actions.length) return
  const items: MenuItem[] = [{ type: 'header', label: `${source.name} → ${target.name}` }]
  for (const a of actions) {
    switch (a.kind) {
      case 'separator':
        items.push({ type: 'separator' })
        break
      case 'fast-forward':
        items.push({ label: a.label, onClick: () => fastForward(repo, a.branch, a.to) })
        break
      case 'merge':
        items.push({ label: a.label, onClick: () => merge(repo, a.source, a.into) })
        break
      case 'rebase':
        items.push({ label: a.label, onClick: () => rebase(repo, a.onto, a.branch) })
        break
      case 'reset':
        items.push({ label: a.label, onClick: () => reset(repo, a.sha) })
        break
      case 'push':
        items.push({ label: a.label, onClick: () => push(repo, { branch: a.branch, remote: a.remote, remoteBranch: a.remoteBranch }) })
        break
    }
  }
  showContextMenu(at, items)
}

// ── Tags ──────────────────────────────────────────────────────────────────

export async function createTag(repo: string, sha: string): Promise<void> {
  const res = await form({
    title: `Create tag at ${sha.slice(0, 7)}`,
    fields: [
      {
        type: 'text',
        name: 'name',
        label: 'Tag name',
        placeholder: 'v1.0.0',
        required: true,
        autoFocus: true,
        monospace: true,
        validate: (v) => validateRefName(v) ?? (tabOf(repo)?.refs?.tags.some((t) => t.name === v.trim()) ? 'Tag already exists' : null)
      },
      { type: 'textarea', name: 'message', label: 'Message (optional — creates an annotated tag)', rows: 3 },
      { type: 'checkbox', name: 'push', label: 'Push tag to remote', defaultValue: false }
    ],
    confirmLabel: 'Create tag'
  })
  if (!res) return
  const name = String(res.name).trim()
  const message = String(res.message || '').trim() || undefined
  const ok = await run(repo, { success: `Created tag ${name}` }, () => api.createTag(repo, name, sha, { message }).then(() => true))
  if (!ok) return
  store().pushHistory(repo, {
    label: `Create tag ${name}`,
    undo: async () => {
      await api.deleteTag(repo, name)
      await refresh(repo)
    },
    redo: async () => {
      await api.createTag(repo, name, sha, { message })
      await refresh(repo)
    }
  })
  if (res.push) await pushTag(repo, name)
}

export async function deleteTag(repo: string, tag: Ref): Promise<void> {
  const remotes = tabOf(repo)?.info?.remotes ?? []
  const res = await form({
    title: `Delete tag ${tag.name}?`,
    fields: remotes.length ? [{ type: 'checkbox', name: 'remote', label: `Also delete from ${remotes[0].name}`, defaultValue: false }] : [],
    confirmLabel: 'Delete',
    danger: true
  })
  if (!res) return
  await run(repo, { success: `Deleted tag ${tag.name}` }, async () => {
    await api.deleteTag(repo, tag.name)
    if (res.remote && remotes[0]) await api.deleteRemoteTag(repo, remotes[0].name, tag.name)
  })
}

export async function pushTag(repo: string, name: string): Promise<void> {
  const remote = defaultRemote(tabOf(repo)?.refs ?? null, (tabOf(repo)?.info?.remotes ?? []).map((r) => r.name))
  if (!remote) {
    toast.error('This repository has no remotes')
    return
  }
  await run(repo, { busy: 'push', busyLabel: `Pushing tag ${name}…`, success: `Pushed tag ${name} to ${remote}` }, () =>
    api.pushTag(repo, remote, name)
  )
}

// ── Stash ─────────────────────────────────────────────────────────────────

export async function stash(repo: string, opts: { message?: string; askMessage?: boolean; paths?: string[] } = {}): Promise<boolean> {
  let message = opts.message
  if (opts.askMessage) {
    const m = await prompt({ title: 'Stash changes', label: 'Message (optional)', placeholder: 'WIP', confirmLabel: 'Stash' })
    if (m === null) return false
    message = m || undefined
  }
  const ok = await run(repo, { busy: 'stash', busyLabel: 'Stashing…', success: 'Changes stashed' }, () =>
    api.stashSave(repo, { message, includeUntracked: true, paths: opts.paths }).then(() => true)
  )
  // Remember which stash entry this created, so undo pops that one even if others were added since.
  let stashSha = ok ? tabOf(repo)?.refs?.stashes[0]?.sha : undefined
  if (ok)
    store().pushHistory(repo, {
      label: 'Stash',
      undo: async () => {
        const stashes = (await api.getRefs(repo)).stashes
        const entry = stashSha ? stashes.find((s) => s.sha === stashSha) : stashes[0]
        if (!entry) throw new StaleHistoryError('Stash')
        await api.stashApply(repo, entry.index, { pop: true, restoreIndex: true })
        await refresh(repo)
      },
      redo: async () => {
        await api.stashSave(repo, { message, includeUntracked: true, paths: opts.paths })
        stashSha = (await api.getRefs(repo)).stashes[0]?.sha
        await refresh(repo)
      }
    })
  return !!ok
}

export async function popStash(repo: string, index = 0): Promise<void> {
  if (!tabOf(repo)?.refs?.stashes.length) {
    toast.info('No stashes to pop')
    return
  }
  const res = await run(repo, { busy: 'stash', busyLabel: 'Popping stash…' }, () => api.stashApply(repo, index, { pop: true, restoreIndex: true }))
  handleOperationResult(repo, res, `Popped stash@{${index}}`)
}

export async function applyStash(repo: string, index: number): Promise<void> {
  const res = await run(repo, { busy: 'stash', busyLabel: 'Applying stash…' }, () => api.stashApply(repo, index, { restoreIndex: true }))
  handleOperationResult(repo, res, `Applied stash@{${index}}`)
}

export async function dropStash(repo: string, index: number): Promise<void> {
  const ok = await confirm({
    title: `Delete stash@{${index}}?`,
    message: 'The stashed changes will be lost.',
    confirmLabel: 'Delete stash',
    danger: true
  })
  if (!ok) return
  await run(repo, { success: `Deleted stash@{${index}}` }, () => api.stashDrop(repo, index))
}

// ── Remotes ───────────────────────────────────────────────────────────────

export async function fetchAll(repo: string, opts: { quiet?: boolean; prune?: boolean } = {}): Promise<void> {
  if (store().busy[`fetch:${repo}`]) return
  const opId = newOpId('fetch')
  const res = await run(
    repo,
    { busy: 'fetch', busyLabel: 'Fetching…', success: opts.quiet ? undefined : 'Fetched all remotes', refresh: ['refs', 'log', 'status'] },
    () => api.fetch(repo, { all: true, prune: opts.prune ?? true, opId }).then(() => true)
  )
  store().setProgress(opId, null)
  if (res) store().markFetched(repo)
}

/** Background fetch that never toasts errors (used by the auto-fetch timer). */
export async function silentFetch(repo: string): Promise<void> {
  if (store().busy[`fetch:${repo}`] || !(tabOf(repo)?.info?.remotes.length)) return
  store().setBusy(`fetch:${repo}`, 'Fetching…')
  try {
    await api.fetch(repo, { all: true, prune: true })
    store().markFetched(repo)
  } catch {
    /* offline / auth — ignore for background fetches */
  } finally {
    store().setBusy(`fetch:${repo}`, null)
    void refresh(repo, ['refs', 'log'])
  }
}

export async function pull(repo: string, mode?: PullMode): Promise<void> {
  const tab = tabOf(repo)
  const cur = currentBranch(tab?.refs ?? null)
  if (!cur) {
    toast.error('Cannot pull: HEAD is detached')
    return
  }
  if (!cur.upstream) {
    toast.warning(`${cur.name} has no upstream branch`, {
      actions: [{ label: 'Set upstream…', onClick: () => void setUpstreamDialog(repo, cur) }]
    })
    return
  }
  const m = mode ?? store().settings.defaultPullMode
  const opId = newOpId('pull')
  const res = await run(repo, { busy: 'pull', busyLabel: 'Pulling…' }, () => api.pull(repo, { mode: m, opId }))
  store().setProgress(opId, null)
  if (!res) return
  if (res.ok) {
    toast.success(/up to date/i.test(res.message) ? `${cur.name} is already up to date` : `Pulled ${cur.upstream} into ${cur.name}`)
    return
  }
  if (m === 'ff-only' && !res.conflicts.length && /not possible to fast-forward|diverg/i.test(res.message)) {
    const next = await choose<PullMode>({
      title: 'Branches have diverged',
      message: `${cur.name} and ${cur.upstream} have diverged and cannot be fast-forwarded.`,
      options: [
        { value: 'rebase', label: 'Pull (rebase)', description: 'Replay your local commits on top of the remote ones.' },
        { value: 'merge', label: 'Pull (merge)', description: 'Create a merge commit.' }
      ]
    })
    if (next) await pull(repo, next)
    return
  }
  handleOperationResult(repo, res, '')
}

export async function push(
  repo: string,
  opts: { branch?: string; remote?: string; remoteBranch?: string; force?: 'with-lease' | 'force' } = {}
): Promise<void> {
  const tab = tabOf(repo)
  const refs = tab?.refs ?? null
  const remoteNames = (tab?.info?.remotes ?? []).map((r) => r.name)
  if (!remoteNames.length) {
    toast.warning('This repository has no remotes', {
      actions: [{ label: 'Add remote…', onClick: () => store().openModal({ kind: 'remotes', repo }) }]
    })
    return
  }
  const branchName = opts.branch ?? currentBranch(refs)?.name
  if (!branchName) {
    toast.error('Cannot push: HEAD is detached')
    return
  }
  const branch = refs?.branches.find((b) => b.name === branchName)
  let remote = opts.remote
  let remoteBranch = opts.remoteBranch
  let setUpstream = false

  if (!remote && !branch?.upstream) {
    const res = await form({
      title: `Push ${branchName}`,
      message: `${branchName} has no upstream. Choose where to push it:`,
      fields: [
        { type: 'select', name: 'remote', label: 'Remote', options: remoteNames.map((n) => ({ value: n, label: n })), defaultValue: defaultRemote(refs, remoteNames) ?? remoteNames[0] },
        { type: 'text', name: 'remoteBranch', label: 'Remote branch', defaultValue: branchName, required: true, monospace: true, validate: (v) => validateRefName(v) }
      ],
      confirmLabel: 'Push'
    })
    if (!res) return
    remote = String(res.remote)
    remoteBranch = String(res.remoteBranch).trim()
    setUpstream = true
  }

  if (opts.force) {
    const dest = remote ? `${remote}/${remoteBranch ?? branchName}` : branch?.upstream ?? `the remote ${branchName}`
    const ok = await confirm({
      title: `Force push ${branchName}?`,
      message: `${dest} will be overwritten with your local ${branchName}. Commits on the remote that you don't have locally will be removed for everyone.`,
      confirmLabel: 'Force push',
      danger: true
    })
    if (!ok) return
  }

  const doPush = (force?: 'with-lease' | 'force') => {
    const opId = newOpId('push')
    return api
      .push(repo, { branch: branchName, remote, remoteBranch, setUpstream, force: force ?? opts.force ?? false, opId })
      .finally(() => store().setProgress(opId, null))
  }

  store().setBusy(`push:${repo}`, 'Pushing…')
  try {
    await doPush()
    toast.success(`Pushed ${branchName}${remote ? ` to ${remote}` : branch?.upstream ? ` to ${branch.upstream}` : ''}`)
  } catch (err) {
    const text = `${(err as AdarError).stderr ?? ''} ${describeError(err)}`
    if (/rejected|non-fast-forward|fetch first|stale info/i.test(text) && !opts.force) {
      const choice = await choose<'pull' | 'force'>({
        title: 'Push rejected',
        message: `The remote has commits that ${branchName} does not have.`,
        options: [
          { value: 'pull', label: 'Pull first', description: 'Integrate remote changes, then push again.' },
          { value: 'force', label: 'Force push (with lease)', description: 'Overwrite the remote branch. Safe only if no one else pushed.', danger: true }
        ]
      })
      if (choice === 'pull') await pull(repo)
      else if (choice === 'force') {
        try {
          await doPush('with-lease')
          toast.success(`Force pushed ${branchName}`)
        } catch (err2) {
          // The lease refuses when the remote has commits this branch never contained (someone else
          // pushed, possibly fetched in the background). Overwriting them needs an explicit decision.
          if (/force push refused|stale info|remote ref updated since checkout/i.test(`${describeError(err2)} ${(err2 as AdarError).stderr ?? ''}`)) {
            const overwrite = await confirm({
              title: 'Someone else pushed to this branch',
              message: `The remote has commits that your local ${branchName} never contained. Overwriting removes them from the remote for everyone. Pull and review them first unless you are sure.`,
              confirmLabel: 'Overwrite remote commits',
              danger: true
            })
            if (overwrite) {
              try {
                await doPush('force')
                toast.success(`Force pushed ${branchName}`)
              } catch (err3) {
                toast.error(err3)
              }
            }
          } else toast.error(err2)
        }
      }
    } else toast.error(err)
  } finally {
    store().setBusy(`push:${repo}`, null)
    void refresh(repo, ['refs', 'log', 'info'])
  }
}

export async function fetchRemote(repo: string, remote: string): Promise<boolean> {
  if (store().busy[`fetch:${repo}`]) return false
  const opId = newOpId('fetch')
  const ok = await run(
    repo,
    { busy: 'fetch', busyLabel: `Fetching ${remote}…`, success: `Fetched ${remote}`, refresh: ['refs', 'log', 'status'] },
    () => api.fetch(repo, { remote, prune: true, opId }).then(() => true)
  )
  store().setProgress(opId, null)
  if (ok) store().markFetched(repo)
  return !!ok
}

export async function addRemote(repo: string, name: string, url: string): Promise<boolean> {
  return !!(await run(repo, { success: `Added remote ${name}`, refresh: ['info', 'refs'] }, () => api.addRemote(repo, name, url).then(() => true)))
}

export async function renameRemote(repo: string, oldName: string, newName: string): Promise<boolean> {
  const ok = !!(await run(repo, { success: `Renamed ${oldName} to ${newName}`, refresh: ['info', 'refs', 'log'] }, () =>
    api.renameRemote(repo, oldName, newName).then(() => true)
  ))
  if (ok) {
    // Keep graph filters pointing at the renamed refs.
    const tab = tabOf(repo)
    const from = `refs/remotes/${oldName}/`
    const to = `refs/remotes/${newName}/`
    if (tab && (tab.hiddenRefs.some((r) => r.startsWith(from)) || tab.soloRef?.startsWith(from))) {
      useApp.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === repo
            ? {
                ...t,
                hiddenRefs: t.hiddenRefs.map((r) => (r.startsWith(from) ? to + r.slice(from.length) : r)),
                soloRef: t.soloRef?.startsWith(from) ? to + t.soloRef.slice(from.length) : t.soloRef
              }
            : t
        )
      }))
    }
  }
  return ok
}

export async function removeRemote(repo: string, name: string): Promise<boolean> {
  const ok = await confirm({
    title: `Remove remote ${name}?`,
    message: 'Its remote-tracking branches are removed locally. Nothing is deleted on the server.',
    confirmLabel: 'Remove remote',
    danger: true
  })
  if (!ok) return false
  return !!(await run(repo, { success: `Removed remote ${name}`, refresh: ['info', 'refs', 'log'] }, () => api.removeRemote(repo, name).then(() => true)))
}

export async function setRemoteUrl(repo: string, name: string, url: string): Promise<boolean> {
  return !!(await run(repo, { success: `Updated URL of ${name}`, refresh: ['info'] }, () => api.setRemoteUrl(repo, name, url).then(() => true)))
}

export async function updateSubmodules(repo: string): Promise<boolean> {
  return !!(await run(
    repo,
    { busy: 'submodules', busyLabel: 'Updating submodules…', loadingToast: 'Updating submodules…', success: 'Submodules updated' },
    () => api.updateSubmodules(repo, { init: true, recursive: true }).then(() => true)
  ))
}

// ── Working tree ──────────────────────────────────────────────────────────

// Staging actions resolve to true on success, after the status refresh completed.
export async function stageFiles(repo: string, paths: string[]): Promise<boolean> {
  return !!(await run(repo, { refresh: ['status'] }, () => api.stageFiles(repo, paths).then(() => true)))
}
export async function unstageFiles(repo: string, paths: string[]): Promise<boolean> {
  return !!(await run(repo, { refresh: ['status'] }, () => api.unstageFiles(repo, paths).then(() => true)))
}
export async function stageAll(repo: string): Promise<boolean> {
  return !!(await run(repo, { refresh: ['status'] }, () => api.stageAll(repo).then(() => true)))
}
export async function unstageAll(repo: string): Promise<boolean> {
  return !!(await run(repo, { refresh: ['status'] }, () => api.unstageAll(repo).then(() => true)))
}
export async function markResolved(repo: string, paths: string[]): Promise<boolean> {
  if (!paths.length) return false
  return !!(await run(
    repo,
    { refresh: ['status', 'info'], success: paths.length === 1 ? `Marked ${paths[0]} as resolved` : `Marked ${paths.length} files as resolved` },
    () => api.markResolved(repo, paths).then(() => true)
  ))
}

export async function discardFiles(repo: string, paths: string[]): Promise<boolean> {
  if (!paths.length) return false
  const wanted = new Set(paths)
  const deletes = (tabOf(repo)?.status?.unstaged ?? []).some((f) => wanted.has(f.path) && (f.status === 'untracked' || f.status === 'added'))
  const ok = await confirm({
    title: paths.length === 1 ? `Discard changes to ${paths[0]}?` : `Discard changes to ${paths.length} files?`,
    message: deletes ? 'This cannot be undone. New (untracked) files will be deleted.' : 'This cannot be undone.',
    confirmLabel: 'Discard',
    danger: true
  })
  if (!ok) return false
  return !!(await run(repo, { refresh: ['status'], success: 'Changes discarded' }, () => api.discardFiles(repo, paths).then(() => true)))
}

export async function discardAll(repo: string): Promise<void> {
  const ok = await confirm({
    title: 'Discard all unstaged changes?',
    message: 'All unstaged modifications are reverted and untracked files are deleted. This cannot be undone.',
    confirmLabel: 'Discard all',
    danger: true
  })
  if (!ok) return
  await run(repo, { refresh: ['status'], success: 'All changes discarded' }, () => api.discardAll(repo))
}

export async function ignorePath(repo: string, pattern: string): Promise<void> {
  await run(repo, { refresh: ['status'], success: `Added ${pattern} to .gitignore` }, () => api.addToGitignore(repo, pattern))
}

/** Create a commit (or amend). Returns the new sha, or null on failure. */
export async function commit(repo: string, message: string, opts: { amend?: boolean; noVerify?: boolean } = {}): Promise<string | null> {
  const msg = message.trim()
  if (!msg) {
    toast.error('Commit message is required')
    return null
  }
  const before = headSha(repo)
  const tab = tabOf(repo)
  const hadParent = !!tab?.commits.find((c) => c.sha === before)?.parents.length
  const sha = await run(
    repo,
    { busy: 'commit', busyLabel: 'Committing…', success: (s: string) => `${opts.amend ? 'Amended' : 'Committed'} ${s.slice(0, 7)}` },
    () => api.commit(repo, { message: msg, amend: opts.amend, noVerify: opts.noVerify })
  )
  if (!sha) return null
  if (before && (opts.amend || hadParent)) {
    store().pushHistory(repo, {
      label: `${opts.amend ? 'Amend' : 'Commit'} "${msg.split('\n')[0].slice(0, 40)}${msg.split('\n')[0].length > 40 ? '…' : ''}"`,
      undo: async () => {
        // Soft reset keeps the committed changes staged.
        await api.reset(repo, opts.amend ? before : `${sha}~1`, 'soft')
        useApp.getState().updateDraft(repo, { summary: msg.split('\n')[0], description: msg.split('\n').slice(2).join('\n') })
        await refresh(repo)
      },
      redo: async () => {
        await api.commit(repo, { message: msg, amend: opts.amend, noVerify: opts.noVerify })
        await refresh(repo)
      }
    })
  }
  return sha
}

// ── In-progress operations ────────────────────────────────────────────────

export async function continueOperation(repo: string, message?: string): Promise<void> {
  const state = tabOf(repo)?.info?.state ?? 'none'
  if (state === 'none') {
    toast.info('There is no merge, rebase or cherry-pick in progress')
    return
  }
  const label = OPERATION_LABEL[state] ?? 'Operation'
  const res = await run(repo, { busy: 'continue', busyLabel: 'Continuing…' }, () => api.continueOperation(repo, { message }))
  if (handleOperationResult(repo, res, `${label} completed`)) showGraph(repo)
}

export async function abortOperation(repo: string): Promise<void> {
  const state = tabOf(repo)?.info?.state ?? 'none'
  const label = OPERATION_LABEL[state] ?? 'operation'
  const ok = await confirm({
    title: `Abort ${label.toLowerCase()}?`,
    message: 'The repository returns to the state before the operation started.',
    confirmLabel: `Abort ${label.toLowerCase()}`,
    danger: true
  })
  if (!ok) return
  const done = await run(repo, { busy: 'abort', busyLabel: `Aborting ${label.toLowerCase()}…`, success: `${label} aborted` }, () =>
    api.abortOperation(repo).then(() => true)
  )
  if (done) showGraph(repo)
}

export async function skipOperation(repo: string): Promise<void> {
  const tab = tabOf(repo)
  const state = tab?.info?.state ?? 'none'
  const st = tab?.status
  if ((state === 'rebase' || state === 'rebase-interactive') && st) {
    // git rebase --skip hard-resets the working tree: confirm before throwing away work done during the pause.
    const conflicts = st.conflicted.length > 0
    const dirty = conflicts || st.staged.length > 0 || st.unstaged.some((f) => f.status !== 'untracked')
    if (dirty) {
      const ok = await confirm({
        title: conflicts ? 'Skip this commit?' : 'Discard your changes and continue?',
        message: conflicts
          ? 'Skipping drops this commit and discards your conflict resolutions and all other uncommitted changes to tracked files. This cannot be undone.'
          : 'The commit stays, but all staged and unstaged changes to tracked files are discarded. This cannot be undone.',
        confirmLabel: 'Skip and discard',
        danger: true
      })
      if (!ok) return
    }
  }
  const res = await run(repo, { busy: 'skip', busyLabel: 'Skipping…' }, () => api.skipOperation(repo))
  handleOperationResult(repo, res, 'Skipped commit')
}

// ── Undo / redo ───────────────────────────────────────────────────────────

export async function undo(repo: string): Promise<void> {
  const tab = tabOf(repo)
  const entry = tab?.undoStack[tab.undoStack.length - 1]
  if (!entry) {
    toast.info('Nothing to undo')
    return
  }
  try {
    if (await store().undo(repo)) toast.success(`Undid: ${entry.label}`)
  } catch (err) {
    handleHistoryError(repo, err)
  } finally {
    void refresh(repo)
  }
}

export async function redo(repo: string): Promise<void> {
  const tab = tabOf(repo)
  const entry = tab?.redoStack[tab.redoStack.length - 1]
  if (!entry) {
    toast.info('Nothing to redo')
    return
  }
  try {
    if (await store().redo(repo)) toast.success(`Redid: ${entry.label}`)
  } catch (err) {
    handleHistoryError(repo, err)
  } finally {
    void refresh(repo)
  }
}

function handleHistoryError(repo: string, err: unknown): void {
  if (err instanceof StaleHistoryError) {
    // Running an old inverse on a changed repository could destroy newer work: drop the history instead.
    store().clearHistory(repo)
    toast.warning(`${err.message}, so it can no longer be undone safely. Undo history cleared.`)
    return
  }
  if (err instanceof AdarError && err.code === 'CANCELLED') return
  toast.error(err)
}

/** Before an undo/redo that hard-resets: refuse to silently discard uncommitted work. */
async function guardHardReset(repo: string, what: string): Promise<void> {
  const st = await api.getStatus(repo)
  const dirty = st.staged.length > 0 || st.conflicted.length > 0 || st.unstaged.some((f) => f.status !== 'untracked')
  if (!dirty) return
  const ok = await confirm({
    title: `${what} discards uncommitted changes`,
    message: 'You have uncommitted changes. They will be permanently discarded. Commit or stash them first to keep them.',
    confirmLabel: `${what} anyway`,
    danger: true
  })
  if (!ok) throw new AdarError({ code: 'CANCELLED', message: 'Cancelled' })
}

// ── System ────────────────────────────────────────────────────────────────

export async function openInTerminal(path: string): Promise<void> {
  try {
    await api.openInTerminal(path)
  } catch (err) {
    toast.error(err)
  }
}

export async function showInFolder(path: string): Promise<void> {
  try {
    await api.showInFolder(path)
  } catch (err) {
    toast.error(err)
  }
}

export async function openInEditor(path: string): Promise<void> {
  try {
    await api.openInEditor(path)
  } catch (err) {
    toast.error(err)
  }
}

/** Join repo root and a repo-relative path. */
export function absPath(repo: string, rel: string): string {
  return `${repo.replace(/\/$/, '')}/${rel}`
}
