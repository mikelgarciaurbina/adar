// Right panel while reviewing an agent's work: the notes for the agent (kept on this computer until copied), a
// summary, and finishing the review — the notes copied as one message to paste into the agent's chat, and this
// version kept as the one reviewed, so the next review shows only what changed after it. Then its pull request.

import { useState } from 'react'
import { CheckCheck, ClipboardCopy, GitPullRequest, Trash2 } from 'lucide-react'
import { selectPull, startPullRequest } from '@renderer/actions/pulls'
import { keyOf, removeDraft } from '@renderer/actions/review'
import { finishWorkReview } from '@renderer/actions/workReview'
import { Button, IconButton } from '@renderer/components/common/Button'
import { repoHosting, usePullIndex } from '@renderer/components/pulls/pullStore'
import { pluralize } from '@renderer/lib/format'
import { pullNoun, pullRef } from '@renderer/lib/pulls'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { ago, linesLabel } from './parts'
import { useDrafts, useReview, useReviewEntry } from './reviewStore'
import './review.css'

export function WorkReviewPanel({ tab }: { tab: RepoTab }) {
  const repo = tab.path
  const entry = useReviewEntry(repo, 'work')
  const key = keyOf(repo, 'work')
  const notes = useDrafts(key)
  const mark = useReview((s) => (key ? s.reviewed[key] : undefined))
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const work = entry.work
  const copy = notes.length > 0 || !!summary.trim()
  const show = (path: string) => {
    const view = useApp.getState().tabs.find((t) => t.path === repo)?.center
    if (view?.kind === 'work-review') useApp.getState().setCenter(repo, { ...view, tab: 'files', path })
  }
  const finish = async () => {
    setBusy(true)
    const ok = await finishWorkReview(repo, summary)
    setBusy(false)
    if (ok) setSummary('')
  }

  return (
    <div className="det-panel rv-panel">
      <div className="ui-panel-header det-header">
        <span className="det-header-label">Review</span>
        <span className="det-sha">{work ? (work.branch ?? 'Detached HEAD') : tab.name}</span>
      </div>
      <div className="rv-panel-body">
        <section className="rv-rs" id="rv-your-review">
          <h4>
            Notes for the agent <span>{notes.length || ''}</span>
          </h4>
          {notes.length > 0 ? (
            <div className="rv-pends">
              {notes.map((d, i) => (
                <div key={i} className="rv-pend">
                  <button type="button" className="rv-pend-main" onClick={() => show(d.path)} title="Show it in the diff">
                    <small>
                      {d.path.split('/').pop()} · {linesLabel(d.side, d.line, d.startLine)}
                    </small>
                    <span>{/^```suggestion/.test(d.body) ? 'Suggested change' : d.body.split('\n')[0]}</span>
                  </button>
                  <IconButton label="Delete" size="sm" onClick={() => key && removeDraft(key, i)}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              ))}
            </div>
          ) : (
            <p className="rv-hint">Click + next to a line to leave a note for the agent. Notes stay on this computer until you copy them.</p>
          )}
          <textarea className="rv-textarea rv-summary" placeholder="Anything else to tell the agent (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <Button variant="primary" icon={copy ? <ClipboardCopy size={14} /> : <CheckCheck size={14} />} loading={busy} disabled={!work} onClick={() => void finish()}>
            {copy ? `Copy for the agent${notes.length ? ` · ${notes.length}` : ''}` : 'Mark as reviewed'}
          </Button>
          <p className="rv-hint">
            {copy ? 'Paste it into the agent’s chat: Adar does not talk to agents. ' : ''}
            This version then counts as reviewed, and next time you see only what changed after it.
          </p>
          {mark && (
            <p className="rv-hint">
              Last reviewed {ago(mark.at)}
              {work && mark.head === work.head ? ', nothing changed since' : ''}.
            </p>
          )}
        </section>
        {work && <PullSection tab={tab} branch={work.branch} commits={entry.commits?.length ?? 0} uncommitted={work.uncommitted} />}
      </div>
    </div>
  )
}

/** The pull request of the work's branch, or how to make one once it is committed. */
function PullSection({ tab, branch, commits, uncommitted }: { tab: RepoTab; branch: string | null; commits: number; uncommitted: number }) {
  const { index } = usePullIndex(tab)
  const hosting = repoHosting(tab)
  if (!hosting || !branch || !commits) return null
  const pr = index.byLocal.get(branch)
  const open = pr && (pr.state === 'open' || pr.state === 'draft') ? pr : null
  const noun = pullNoun(hosting.provider)
  return (
    <section className="rv-rs">
      <h4>{noun.charAt(0).toUpperCase() + noun.slice(1)}</h4>
      {open ? (
        <>
          <p className="rv-hint">
            {branch} has {pullRef(open)}: {open.title}
          </p>
          <Button icon={<GitPullRequest size={14} />} onClick={() => selectPull(tab.path, open.number)}>
            Show {pullRef(open)}
          </Button>
        </>
      ) : (
        <>
          <p className="rv-hint">
            {uncommitted
              ? `${pluralize(uncommitted, 'file')} not committed yet would not be in it.`
              : `When the work is ready: Adar pushes ${branch} and opens the ${noun}.`}
          </p>
          <Button icon={<GitPullRequest size={14} />} onClick={() => void startPullRequest(tab.path, { head: branch })}>
            Create {noun}
          </Button>
        </>
      )}
    </section>
  )
}
