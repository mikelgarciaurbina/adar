// Right panel while a pull request is being reviewed: the review itself (the comments kept for it, the verdict,
// the summary, Submit), who reviewed it and how, and its checks.

import { useState } from 'react'
import { CircleCheck, CircleDashed, CircleX, Clock, ExternalLink, MessageSquareWarning, Trash2, UserCheck } from 'lucide-react'
import { openWebPage } from '@renderer/actions/pulls'
import { keyOf, removeDraft, submitReview } from '@renderer/actions/review'
import { Avatar } from '@renderer/components/common/Avatar'
import { Button, IconButton } from '@renderer/components/common/Button'
import { usePulls } from '@renderer/components/pulls/pullStore'
import { checksLabel, providerName, pullRef } from '@renderer/lib/pulls'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { ReviewEvent } from '@shared/review'
import { linesLabel } from './parts'
import { useDrafts, useReviewEntry } from './reviewStore'
import './review.css'

const VERDICTS: Array<{ event: ReviewEvent; label: string; hint: string }> = [
  { event: 'comment', label: 'Comment', hint: 'Feedback without a verdict' },
  { event: 'approve', label: 'Approve', hint: 'Ready to merge as far as you are concerned' },
  { event: 'request-changes', label: 'Request changes', hint: 'Must be addressed before merging' }
]

export function ReviewPanel({ tab, number }: { tab: RepoTab; number: number }) {
  const repo = tab.path
  const pr = usePulls((s) => s.repos[repo]?.data?.pulls.find((p) => p.number === number))
  const entry = useReviewEntry(repo, number)
  const pull = keyOf(repo, number)
  const drafts = useDrafts(pull)
  const [event, setEvent] = useState<ReviewEvent>('comment')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const own = !!pr?.viewerIsAuthor
  const open = pr?.state === 'open' || pr?.state === 'draft'
  const needsWords = event !== 'approve' && !body.trim() && !drafts.length
  const show = (path: string) => {
    const view = useApp.getState().tabs.find((t) => t.path === repo)?.center
    if (view?.kind === 'review') useApp.getState().setCenter(repo, { ...view, tab: 'files', path })
  }

  const submit = async () => {
    setBusy(true)
    const ok = await submitReview(repo, number, event, body)
    setBusy(false)
    if (ok) {
      setBody('')
      setEvent('comment')
    }
  }

  return (
    <div className="det-panel rv-panel">
      <div className="ui-panel-header det-header">
        <span className="det-header-label">Review</span>
        <span className="det-sha">{pr ? pullRef(pr) : `#${number}`}</span>
        <span className="det-spacer" />
        {pr && (
          <button type="button" className="ui-link pr-open-link" onClick={() => openWebPage(pr.url)}>
            Open on {providerName(pr)} <ExternalLink size={12} />
          </button>
        )}
      </div>
      <div className="rv-panel-body">
        {open && (
          <section className="rv-rs" id="rv-your-review">
            <h4>
              Your review <span>{drafts.length ? `${drafts.length} pending` : ''}</span>
            </h4>
            {drafts.length > 0 ? (
              <div className="rv-pends">
                {drafts.map((d, i) => (
                  <div key={i} className="rv-pend">
                    <button type="button" className="rv-pend-main" onClick={() => show(d.path)} title="Show it in the diff">
                      <small>
                        {d.path.split('/').pop()} · {linesLabel(d.side, d.line, d.startLine)}
                      </small>
                      <span>{/^```suggestion/.test(d.body) ? 'Suggested change' : d.body.split('\n')[0]}</span>
                    </button>
                    <IconButton label="Delete" size="sm" onClick={() => pull && removeDraft(pull, i)}>
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rv-hint">Click + next to a line to comment on it. Comments added to the review are sent together when you submit it.</p>
            )}
            <div className="rv-verdict" role="radiogroup" aria-label="Verdict">
              {VERDICTS.filter((v) => !entry.data || entry.data.features.events.includes(v.event)).map((v) => {
                const disabled = own && v.event !== 'comment'
                return (
                  <label key={v.event} className={`rv-vo${event === v.event ? ' rv-vo-on' : ''}${disabled ? ' rv-vo-off' : ''}`} title={disabled ? 'Not on your own pull request' : undefined}>
                    <input type="radio" name={`verdict-${number}`} checked={event === v.event} disabled={disabled} onChange={() => setEvent(v.event)} />
                    <span>
                      {v.label}
                      <small>{pr?.provider === 'azure' && v.event !== 'comment' ? `Votes “${v.event === 'approve' ? 'Approved' : 'Waiting for author'}”` : v.hint}</small>
                    </span>
                  </label>
                )
              })}
            </div>
            <textarea className="rv-textarea rv-summary" placeholder="Leave a summary (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
            <Button
              variant="primary"
              loading={busy}
              disabled={needsWords || !entry.range}
              title={needsWords ? 'Write a summary or add a comment first' : undefined}
              onClick={() => void submit()}
            >
              Submit review{drafts.length ? ` · ${drafts.length}` : ''}
            </Button>
          </section>
        )}
        {entry.data && entry.data.reviewers.length > 0 && (
          <section className="rv-rs">
            <h4>Reviewers</h4>
            {entry.data.reviewers.map((r) => (
              <div key={r.login} className="rv-person">
                <Avatar name={r.login} size={20} />
                <span>{r.login.toLowerCase() === entry.data!.viewer.toLowerCase() ? 'You' : r.login}</span>
                <span className="rv-state">
                  {r.verdict === 'approved' ? (
                    <>
                      <UserCheck size={13} className="rv-ok" /> Approved
                    </>
                  ) : r.verdict === 'changes-requested' ? (
                    <>
                      <MessageSquareWarning size={13} className="rv-bad" /> Changes requested
                    </>
                  ) : r.verdict === 'requested' ? (
                    <>
                      <Clock size={13} className="rv-wait" /> Waiting
                    </>
                  ) : (
                    <span className="rv-muted">Commented</span>
                  )}
                </span>
              </div>
            ))}
          </section>
        )}
        {pr && pr.checkRuns.length > 0 && (
          <section className="rv-rs">
            <h4>
              Checks <span>{checksLabel(pr)}</span>
            </h4>
            {pr.checkRuns.map((c, i) => (
              <div key={`${c.name}:${i}`} className="rv-person">
                {c.state === 'passed' ? (
                  <CircleCheck size={13} className="rv-ok" />
                ) : c.state === 'failed' ? (
                  <CircleX size={13} className="rv-bad" />
                ) : c.state === 'running' ? (
                  <Clock size={13} className="rv-wait" />
                ) : (
                  <CircleDashed size={13} className="rv-muted" />
                )}
                <span className="rv-check-name" title={c.name}>
                  {c.name}
                </span>
                {c.url && (
                  <button type="button" className="ui-link rv-state" onClick={() => openWebPage(c.url!)}>
                    Details
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
