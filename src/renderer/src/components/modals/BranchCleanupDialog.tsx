// "Clean up branches": fetches the remote with prune, then lists the local branches whose work is in the
// base branch (ticked), those whose branch on the remote was deleted (ticked only when nothing would be
// lost) and, folded away, the remote branches already in the base branch. Deleting is cleanUpBranches.

import { useEffect, useMemo, useState } from 'react'
import { BrushCleaning, Check, ChevronDown, ChevronRight, GitPullRequest, Sparkle, TriangleAlert } from 'lucide-react'
import { cleanUpBranches, loadCleanupPlan } from '@renderer/actions/cleanup'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { defaultSelection, type CleanupItem, type CleanupPlan } from '@renderer/lib/cleanup'
import { pluralize, relativeTime } from '@renderer/lib/format'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import { closeIfTopmost } from './controls'

type Loaded = { plan: CleanupPlan; fetchError: string | null }

export function BranchCleanupDialog({ repo }: { repo: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const close = () => closeIfTopmost('md-cleanup')

  const load = (fetch: boolean) => {
    setLoaded(null)
    setError(null)
    loadCleanupPlan(repo, { fetch })
      .then((l) => {
        setLoaded(l)
        setChosen(defaultSelection(l.plan))
      })
      .catch((err) => setError(describeError(err)))
  }
  useEffect(() => {
    load(true)
    // Load once when the dialog opens; "Fetch again" reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo])

  const plan = loaded?.plan ?? null
  const all = useMemo(() => (plan ? [...plan.inBase, ...plan.gone, ...plan.remote] : []), [plan])
  const picked = all.filter((i) => chosen.has(i.key))
  const localCount = picked.filter((i) => i.scope === 'local').length
  const remoteCount = picked.length - localCount
  const losing = picked.filter((i) => i.loses > 0)
  const nothing = !!plan && all.length === 0

  const toggle = (keys: string[], on: boolean) =>
    setChosen((s) => {
      const next = new Set(s)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })

  const submit = async () => {
    if (!plan || !picked.length) return
    setBusy(true)
    useApp.getState().closeModal()
    try {
      await cleanUpBranches(repo, plan, picked)
    } finally {
      setBusy(false)
    }
  }

  const footer = nothing ? (
    <Button onClick={close}>Close</Button>
  ) : (
    <>
      <span className="md-footer-start md-cleanup-undo">
        {remoteCount ? `${localCount} here · ${remoteCount} on ${plan?.remoteName}` : 'Undo brings the local branches back.'}
      </span>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button variant="danger" loading={busy} disabled={!picked.length} onClick={() => void submit()}>
        {picked.length ? `Delete ${pluralize(picked.length, 'branch', 'branches')}` : 'Delete branches'}
      </Button>
    </>
  )

  return (
    <Modal
      title={
        <span className="md-title">
          <BrushCleaning size={16} /> Clean up branches
        </span>
      }
      className="md-modal md-cleanup"
      width={nothing ? 460 : 640}
      onClose={close}
      footer={footer}
    >
      <div className="md-cleanup-body">
        {!nothing && (
          <p className="md-cleanup-lead">
            Local branches whose work is already in <strong>{plan?.base ?? 'the main branch'}</strong>, and branches whose copy on {plan?.remoteName ?? 'the remote'} was
            deleted.
          </p>
        )}
        {error ? (
          <div className="md-cleanup-warn" role="alert">
            <TriangleAlert size={15} />
            <span>{error}</span>
          </div>
        ) : !loaded ? (
          <>
            <span className="md-cleanup-checked">
              <span className="ui-spinner ui-spinner-sm" /> Fetching to see which branches are gone…
            </span>
            <div className="md-cleanup-group md-cleanup-skeleton" aria-hidden="true">
              <i style={{ width: '46%' }} />
              <i style={{ width: '72%' }} />
              <i style={{ width: '58%' }} />
            </div>
          </>
        ) : (
          <>
            <span className="md-cleanup-checked">
              {loaded.fetchError ? (
                <>
                  <TriangleAlert size={13} className="md-cleanup-bad" /> Could not fetch: {loaded.fetchError}. This is what Adar knew.
                </>
              ) : (
                <>
                  <Check size={13} className="md-cleanup-ok" /> {plan?.remoteName ? `Checked against ${plan.remoteName} just now` : 'This repository has no remote'}
                </>
              )}
              {plan?.remoteName && (
                <>
                  {' · '}
                  <button type="button" className="ui-link" onClick={() => load(true)}>
                    Fetch again
                  </button>
                </>
              )}
            </span>
            {nothing ? (
              <div className="md-cleanup-empty">
                <Sparkle size={26} />
                <strong>Nothing to clean up</strong>
                <span>Every local branch has work that is not in {plan?.base} yet{plan?.remoteName ? `, and is still on ${plan.remoteName}` : ''}.</span>
              </div>
            ) : (
              <>
                <Group
                  title={`Already in ${plan!.base}`}
                  why="Nothing is lost"
                  items={plan!.inBase}
                  chosen={chosen}
                  onToggle={toggle}
                  base={plan!.base}
                />
                <Group title={`Gone from ${plan!.remoteName ?? 'the remote'}`} why="Their commits are in no other branch" items={plan!.gone} chosen={chosen} onToggle={toggle} base={plan!.base} />
                {plan!.remote.length > 0 && (
                  <Group
                    title={`On ${plan!.remoteName}`}
                    why={`${pluralize(plan!.remote.length, 'branch', 'branches')} already in ${plan!.base}`}
                    items={plan!.remote}
                    chosen={chosen}
                    onToggle={toggle}
                    base={plan!.base}
                    folded={!remoteOpen}
                    onFold={() => setRemoteOpen((o) => !o)}
                  />
                )}
                {losing.length > 0 && (
                  <div className="md-cleanup-warn" role="alert">
                    <TriangleAlert size={15} />
                    <span>
                      {losing.length === 1 ? (
                        <>
                          <strong>{losing[0].label}</strong> has {pluralize(losing[0].loses, 'commit')} that {losing[0].loses === 1 ? 'is' : 'are'} in no other branch.
                        </>
                      ) : (
                        <>
                          {losing.length} branches have {pluralize(losing.reduce((n, i) => n + i.loses, 0), 'commit')} that are in no other branch.
                        </>
                      )}{' '}
                      After deleting, only Undo brings {losing.length === 1 && losing[0].loses === 1 ? 'it' : 'them'} back.
                    </span>
                  </div>
                )}
                {remoteCount > 0 && (
                  <div className="md-cleanup-warn" role="alert">
                    <TriangleAlert size={15} />
                    <span>
                      Branches on {plan!.remoteName} are deleted for everyone who works on it, and Undo does not bring them back. Their commits stay in {plan!.base}.
                    </span>
                  </div>
                )}
                <span className="md-cleanup-kept">
                  Always kept: <Names names={plan!.kept} />
                  {plan!.inWorktrees.length > 0 ? ', ' : ' and '}
                  branches with work of their own that are still on {plan!.remoteName ?? 'a remote'}
                  {plan!.inWorktrees.length > 0 && (
                    <>
                      , and branches checked out in a worktree (<Names names={plan!.inWorktrees} />)
                    </>
                  )}
                  .
                </span>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function Group(props: {
  title: string
  why: string
  items: CleanupItem[]
  chosen: Set<string>
  base: string
  onToggle(keys: string[], on: boolean): void
  folded?: boolean
  onFold?(): void
}) {
  const { items, chosen, onToggle } = props
  if (!items.length) return null
  const on = items.filter((i) => chosen.has(i.key)).length
  // Ticking the group ticks what Adar would pick; unticking it clears all.
  const groupKeys = items.filter((i) => i.ticked).map((i) => i.key)
  const all = on > 0 && on === items.length
  return (
    <div className="md-cleanup-group">
      <div className="md-cleanup-gh">
        {props.onFold && (
          <button type="button" className="md-cleanup-fold" aria-expanded={!props.folded} aria-label={props.folded ? 'Show' : 'Hide'} onClick={props.onFold}>
            {props.folded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
        <input
          type="checkbox"
          aria-label={props.title}
          checked={all}
          ref={(el) => {
            if (el) el.indeterminate = on > 0 && !all
          }}
          onChange={(e) => onToggle(e.target.checked ? (groupKeys.length ? groupKeys : items.map((i) => i.key)) : items.map((i) => i.key), e.target.checked)}
        />
        <span className="md-cleanup-gt">{props.title}</span>
        {!props.onFold && <span className="md-cleanup-n">{items.length}</span>}
        <span className="md-cleanup-why">
          {props.onFold ? (
            <button type="button" className="ui-link" onClick={props.onFold}>
              {props.folded ? `${props.why} · Show` : 'Hide'}
            </button>
          ) : (
            props.why
          )}
        </span>
      </div>
      {!props.folded &&
        items.map((i) => (
          <label key={i.key} className="md-cleanup-row">
            <input type="checkbox" checked={chosen.has(i.key)} onChange={(e) => onToggle([i.key], e.target.checked)} />
            <span className="md-cleanup-name">{i.label}</span>
            <Reason item={i} base={props.base} />
            <span className="md-cleanup-sub">
              {i.subject}
              {i.date ? ` · ${relativeTime(i.date)}` : ''}
              {i.reason.kind === 'pull' && ' · squash or rebase merged, so git alone would call it unmerged'}
              {i.isHead && <span className="md-cleanup-ok"> · Adar switches to {props.base} first</span>}
              {i.loses > 0 && <span className="md-cleanup-bad"> · {pluralize(i.loses, 'commit')} not in {props.base}</span>}
            </span>
          </label>
        ))}
    </div>
  )
}

function Reason({ item, base }: { item: CleanupItem; base: string }) {
  if (item.isHead) return <span className="md-cleanup-tag md-cleanup-tag-head">checked out</span>
  switch (item.reason.kind) {
    case 'pull':
      return (
        <span className="md-cleanup-tag md-cleanup-tag-pull">
          <GitPullRequest size={11} /> {item.reason.ref} merged
        </span>
      )
    case 'gone':
      return <span className="md-cleanup-tag md-cleanup-tag-gone">{item.reason.upstream} deleted</span>
    default:
      return <span className="md-cleanup-tag md-cleanup-tag-merged">{item.scope === 'remote' ? `in ${base}` : `merged into ${base}`}</span>
  }
}

function Names({ names }: { names: string[] }) {
  return (
    <>
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 && ', '}
          <code>{n}</code>
        </span>
      ))}
    </>
  )
}
