// Commit composer pinned at the bottom of the staging area (GitKraken style):
// Summary + Description, amend toggle, primary commit button, "Stage all &
// commit", identity line and in-progress operation hints. The draft lives in
// tab.draft so it survives selection changes and tab switches.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, GitMerge, Info, TriangleAlert, UserPen } from 'lucide-react'
import { api } from '@renderer/api/client'
import * as actions from '@renderer/actions/git'
import { Button } from '@renderer/components/common/Button'
import { toast } from '@renderer/components/common/toast'
import { isMod, shortcutLabel } from '@renderer/lib/keys'
import { useApp, type CommitDraft, type RepoTab } from '@renderer/store/appStore'
import { useIdentity } from './identity'
import { prefillMergeMessage } from './mergeDraft'
import { joinMessage, splitMessage, summaryLength, SUMMARY_SOFT_LIMIT, type SplitMessage } from './message'

/** "A rebase is in progress…": the operation with its article. */
const OP_NAME: Record<string, string> = {
  rebase: 'A rebase',
  'rebase-interactive': 'An interactive rebase',
  'cherry-pick': 'A cherry-pick',
  revert: 'A revert',
  am: 'A patch application'
}

const DESC_MAX_HEIGHT = 220

export interface CommitComposerProps {
  tab: RepoTab
  staged: number
  unstaged: number
  conflicted: number
  /** Set when the repository cannot be read (tab.error): the draft stays editable but nothing can be committed. */
  unavailable?: string
}

function getTab(repo: string): RepoTab | undefined {
  return useApp.getState().tabs.find((t) => t.path === repo)
}

function getDraft(repo: string): CommitDraft {
  return getTab(repo)?.draft ?? { summary: '', description: '', amend: false }
}

export function CommitComposer({ tab, staged, unstaged, conflicted, unavailable }: CommitComposerProps) {
  const repo = tab.path
  const draft = tab.draft
  const busy = useApp((s) => !!s.busy[`commit:${repo}`] || !!s.busy[`continue:${repo}`])
  const identity = useIdentity(repo)
  const [working, setWorking] = useState(false)
  const summaryRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const prefilled = useRef<SplitMessage | null>(null)

  // Stale repository info must not drive the composer while the repository is unavailable.
  const opState = unavailable ? 'none' : (tab.info?.state ?? 'none')
  const inMerge = opState === 'merge'
  const mergeMode = inMerge && conflicted === 0
  // A merge cannot be amended (git refuses): ignore a leftover amend flag until it is over.
  const amend = draft.amend && !inMerge
  const unborn = tab.info?.head.unborn ?? tab.refs?.head.unborn ?? false
  const hasSummary = draft.summary.trim().length > 0
  const inFlight = busy || working

  const len = summaryLength(draft.summary)
  const remaining = SUMMARY_SOFT_LIMIT - len

  // Auto-grow the description.
  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, DESC_MAX_HEIGHT)}px`
  }, [draft.description])

  const update = (patch: Partial<CommitDraft>) => useApp.getState().updateDraft(repo, patch)

  // During a merge, prefill git's prepared message (MERGE_MSG) once, like GitKraken. It is
  // removed again if the merge ends without it (see mergeDraft.ts).
  useEffect(() => {
    if (opState === 'merge') void prefillMergeMessage(repo)
  }, [opState, repo])

  // ── Button state ─────────────────────────────────────────────────────────
  let primaryLabel: string
  if (mergeMode) primaryLabel = 'Commit merge'
  else if (amend) primaryLabel = staged > 0 ? `Amend previous commit with ${staged} file${staged === 1 ? '' : 's'}` : 'Amend previous commit'
  else primaryLabel = staged > 0 ? `Commit changes to ${staged} file${staged === 1 ? '' : 's'}` : 'Commit changes'

  const canCommit = !unavailable && !inFlight && conflicted === 0 && (mergeMode || ((staged > 0 || amend) && hasSummary))
  const showStageAll = !unavailable && !mergeMode && conflicted === 0 && staged === 0 && unstaged > 0
  const canStageAll = showStageAll && !inFlight && hasSummary
  // Nothing staged (and not amending): "Stage all & commit" is the only way to commit, so it
  // becomes the single primary button instead of sitting under a disabled one.
  const stageAllPrimary = showStageAll && !amend
  const stageAllLabel = amend ? 'Stage all & amend' : `Stage all & commit (${unstaged} file${unstaged === 1 ? '' : 's'})`

  let hint: { text: string; tone: 'muted' | 'warn' } | null = null
  if (unavailable) hint = { text: unavailable, tone: 'warn' }
  else if (conflicted > 0) hint = { text: `Resolve ${conflicted} conflicted file${conflicted === 1 ? '' : 's'} before committing`, tone: 'warn' }
  else if (mergeMode) hint = null
  else if (stageAllPrimary) hint = { text: hasSummary ? 'Nothing is staged: every change will be committed' : 'Enter a commit summary, or stage files', tone: 'muted' }
  else if (staged === 0 && !amend) hint = { text: 'No changes to commit', tone: 'muted' }
  else if (!hasSummary) hint = { text: 'Enter a commit summary', tone: 'muted' }

  const otherOp = !mergeMode && opState !== 'none' && opState !== 'merge' && opState !== 'bisect' ? OP_NAME[opState] : undefined

  // ── Actions ──────────────────────────────────────────────────────────────
  const finishMerge = async () => {
    const d = getDraft(repo)
    const message = joinMessage(d.summary, d.description)
    setWorking(true)
    try {
      // Resolves after the repository state has been refreshed.
      await actions.continueOperation(repo, message || undefined)
      const t = getTab(repo)
      if ((t?.info?.state ?? 'none') !== 'merge') {
        prefilled.current = null
        update({ summary: '', description: '', amend: false })
        // Like a regular commit: show the new merge commit when nothing else is left to stage.
        const head = t?.refs?.head.sha ?? t?.info?.head.sha
        const st = t?.status
        if (head && st && st.staged.length + st.unstaged.length + st.conflicted.length === 0) useApp.getState().select(repo, { kind: 'commit', sha: head })
      }
    } finally {
      setWorking(false)
    }
  }

  const doCommit = async (stageAllFirst: boolean) => {
    if (inFlight || unavailable) return
    if (mergeMode) {
      await finishMerge()
      return
    }
    const d = getDraft(repo)
    if (!d.summary.trim()) {
      summaryRef.current?.focus()
      toast.info('Enter a commit summary first')
      return
    }
    setWorking(true)
    try {
      if (stageAllFirst) {
        if (!(await actions.stageAll(repo))) return
        const st = getTab(repo)?.status
        if (!st || (st.staged.length === 0 && !d.amend)) return
      } else {
        const st = getTab(repo)?.status
        if (st && st.staged.length === 0 && !d.amend) {
          toast.info('Stage files to commit them')
          return
        }
      }
      const before = getTab(repo)?.status
      const sha = await actions.commit(repo, joinMessage(d.summary, d.description), { amend: d.amend })
      if (!sha) return
      prefilled.current = null
      update({ summary: '', description: '', amend: false })
      const changesRemain = !!before && (before.unstaged.length > 0 || before.conflicted.length > 0)
      if (!changesRemain) useApp.getState().select(repo, { kind: 'commit', sha })
    } finally {
      setWorking(false)
    }
  }

  const toggleAmend = async (on: boolean) => {
    if (on && (unavailable || inMerge)) return
    const d = getDraft(repo)
    if (!on) {
      const p = prefilled.current
      prefilled.current = null
      // Restore the empty draft if the user did not touch the prefilled message.
      if (p && d.summary === p.summary && d.description === p.description) update({ amend: false, summary: '', description: '' })
      else update({ amend: false })
      return
    }
    update({ amend: true })
    if (d.summary.trim() || d.description.trim()) return
    try {
      const parts = splitMessage(await api.getHeadMessage(repo))
      const cur = getDraft(repo)
      if (cur.amend && !cur.summary.trim() && !cur.description.trim()) {
        prefilled.current = parts
        update(parts)
      }
    } catch (err) {
      toast.error(err)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && isMod(e)) {
      e.preventDefault()
      if (e.shiftKey && showStageAll) void doCommit(true)
      else if (canCommit) void doCommit(false)
      else if (showStageAll && hasSummary) toast.info(`Nothing is staged. Press ${shortcutLabel('Mod+Shift+Enter')} to stage all changes and commit.`)
      else if (hint) toast.info(hint.text)
      return
    }
    if (e.key === 'Enter' && e.currentTarget === summaryRef.current && !e.shiftKey && !e.altKey) {
      // Enter in the summary moves to the description, like most commit UIs.
      e.preventDefault()
      descRef.current?.focus()
    }
  }

  const missingIdentity = identity && !identity.error && identity.identity && (!identity.identity.name.trim() || !identity.identity.email.trim())

  return (
    <div className="det-composer" aria-label="Commit">
      <div className="det-composer-head">
        <span className="det-composer-title">{mergeMode ? 'Merge commit' : amend ? 'Amend commit' : 'Commit'}</span>
        <span className="det-spacer" />
        <label
          className={`det-amend${unborn || inMerge || unavailable ? ' det-disabled' : ''}`}
          title={
            unborn
              ? 'There is no commit to amend yet'
              : inMerge
                ? 'A merge in progress cannot be amended: commit the merge (or abort it) first'
                : 'Replace the last commit with the staged changes and this message'
          }
        >
          <input
            type="checkbox"
            checked={amend}
            // Turning amend off stays possible while unavailable (it only edits the draft).
            disabled={unborn || inMerge || inFlight || (!!unavailable && !draft.amend)}
            onChange={(e) => void toggleAmend(e.target.checked)}
          />
          <span>Amend previous commit</span>
        </label>
      </div>

      {otherOp && (
        <div className="det-composer-note">
          <Info size={13} />
          <span>{otherOp} is in progress. When you are done, use Continue in the banner above.</span>
        </div>
      )}
      {mergeMode && (
        <div className="det-composer-note">
          <GitMerge size={13} />
          <span>All conflicts are resolved. Commit to conclude the merge (the message is optional).</span>
        </div>
      )}

      <div className="det-summary">
        <input
          ref={summaryRef}
          data-commit-summary=""
          className="ui-input det-summary-input"
          placeholder={mergeMode ? 'Merge commit summary (optional)' : 'Summary'}
          aria-label="Commit summary"
          value={draft.summary}
          spellCheck
          onChange={(e) => update({ summary: e.target.value })}
          onKeyDown={onKeyDown}
        />
        <span className={`det-summary-count${remaining < 0 ? ' det-warn' : ''}`} title={`${len} characters (keep summaries within ${SUMMARY_SOFT_LIMIT})`}>
          {remaining}
        </span>
      </div>
      <textarea
        ref={descRef}
        className="ui-input det-desc"
        placeholder="Description"
        aria-label="Commit description"
        rows={3}
        value={draft.description}
        spellCheck
        onChange={(e) => update({ description: e.target.value })}
        onKeyDown={onKeyDown}
      />

      {stageAllPrimary ? (
        <Button
          variant="primary"
          className="det-commit-btn"
          icon={<Check size={14} />}
          loading={inFlight}
          disabled={!canStageAll}
          title={`Stage all changes and commit (${shortcutLabel('Mod+Shift+Enter')})`}
          onClick={() => void doCommit(true)}
        >
          {stageAllLabel}
        </Button>
      ) : (
        <Button
          variant="primary"
          className="det-commit-btn"
          icon={mergeMode ? <GitMerge size={14} /> : <Check size={14} />}
          loading={inFlight}
          disabled={!canCommit}
          title={`${primaryLabel} (${shortcutLabel('Mod+Enter')})`}
          onClick={() => void doCommit(false)}
        >
          {primaryLabel}
        </Button>
      )}
      {showStageAll && !stageAllPrimary && (
        <Button className="det-commit-btn det-stage-commit-btn" disabled={!canStageAll} title={`Stage all changes and commit (${shortcutLabel('Mod+Shift+Enter')})`} onClick={() => void doCommit(true)}>
          {stageAllLabel}
        </Button>
      )}
      {hint && !inFlight && <div className={`det-composer-hint${hint.tone === 'warn' ? ' det-warn' : ''}`}>{hint.text}</div>}

      <div className="det-identity">
        {unavailable ? (
          <span className="det-identity-line det-muted">&nbsp;</span>
        ) : missingIdentity || identity?.error ? (
          <button type="button" className="det-identity-warn" onClick={() => useApp.getState().openModal({ kind: 'identity', repo })}>
            <TriangleAlert size={12} />
            <span>{identity?.error ? 'Could not read your Git identity' : 'Author name/email not set'} — set identity…</span>
          </button>
        ) : identity?.identity ? (
          <button
            type="button"
            className="det-identity-line"
            title={`Identity from ${identity.identity.scope} config — click to change`}
            onClick={() => useApp.getState().openModal({ kind: 'identity', repo })}
          >
            <UserPen size={12} />
            <span>Committing as</span>
            <strong>{identity.identity.name}</strong>
            <span className="det-identity-email">{identity.identity.email}</span>
          </button>
        ) : (
          <span className="det-identity-line det-muted">&nbsp;</span>
        )}
      </div>
    </div>
  )
}
