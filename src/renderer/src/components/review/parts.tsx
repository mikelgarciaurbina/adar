// Pieces of the review view: a comment's text (Markdown with code blocks and suggested changes), a comment thread
// with its replies and Resolve, the box for a new line comment, and a comment kept for the next review.

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, CircleCheck, FileDiff as FileDiffIcon, Pencil, Trash2, Undo2 } from 'lucide-react'
import { addDraft, commentNow, editDraft, removeDraft, replyTo, resolveThread } from '@renderer/actions/review'
import { Avatar } from '@renderer/components/common/Avatar'
import { Button, IconButton } from '@renderer/components/common/Button'
import { ReleaseNotes } from '@renderer/components/update/ReleaseNotes'
import { relativeTime } from '@renderer/lib/format'
import { suggestionBlock, type DraftComment, type ReviewComment, type ReviewFeatures, type ReviewThread } from '@shared/review'
import { useReview } from './reviewStore'

export const ago = (iso: string) => (iso ? relativeTime(Math.floor(Date.parse(iso) / 1000)) : '')

/** Markdown of a comment: fenced code blocks (```suggestion, GitLab's ```suggestion:-1+0, as a suggested change) and the rest as text. */
export function CommentBody({ body }: { body: string }) {
  const parts = body.split(/^```/m)
  if (parts.length < 3) return <div className="rv-md selectable">{body.trim() ? <ReleaseNotes markdown={body} /> : <span className="rv-muted">No description.</span>}</div>
  return (
    <div className="rv-md selectable">
      {parts.map((p, i) => {
        if (i % 2 === 0) return p.trim() ? <ReleaseNotes key={i} markdown={p} /> : null
        const nl = p.indexOf('\n')
        const lang = (nl < 0 ? p : p.slice(0, nl)).trim()
        const code = (nl < 0 ? '' : p.slice(nl + 1)).replace(/\n$/, '')
        return /^suggestion(?::-\d+\+\d+)?$/.test(lang) ? (
          <div key={i} className="rv-suggestion">
            <div className="rv-suggestion-head">
              <FileDiffIcon size={12} /> Suggested change
            </div>
            <pre>
              {code.split('\n').map((l, k) => (
                <Fragment key={k}>
                  <span className="rv-suggestion-add">+ {l}</span>
                  {'\n'}
                </Fragment>
              ))}
            </pre>
          </div>
        ) : (
          <pre key={i} className="rv-pre">
            {code}
          </pre>
        )
      })}
    </div>
  )
}

function Comment({ c }: { c: ReviewComment }) {
  return (
    <div className="rv-cm">
      <Avatar name={c.author} size={22} />
      <div className="rv-ct">
        <div className="rv-who">
          <b>{c.viewerDidAuthor ? 'You' : c.author}</b>
          <span>{ago(c.createdAt)}</span>
        </div>
        <CommentBody body={c.body} />
      </div>
    </div>
  )
}

/** Cmd/Ctrl+Enter runs `primary`; Escape runs `cancel`. */
function textKeys(primary: () => void, cancel: () => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      primary()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
  }
}

export function Thread({ repo, number, thread, canAct }: { repo: string; number: number; thread: ReviewThread; canAct: boolean }) {
  const [open, setOpen] = useState(!thread.resolved)
  const [replying, setReplying] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const first = thread.comments[0]
  if (!open) {
    return (
      <button type="button" className="rv-thread rv-thread-folded" onClick={() => setOpen(true)}>
        <ChevronRight size={13} />
        <CircleCheck size={13} className="rv-ok" />
        <span>
          {thread.resolved ? 'Resolved' : 'Comments'} · {first.author}: {first.body.split('\n')[0].slice(0, 80)}
        </span>
        <span className="rv-muted">{thread.comments.length > 1 ? `${thread.comments.length} comments` : ''}</span>
      </button>
    )
  }
  const send = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    const ok = await replyTo(repo, number, thread.id, thread.comments.at(-1)!.id, body)
    setBusy(false)
    if (ok) {
      setBody('')
      setReplying(false)
    }
  }
  return (
    <div className={`rv-thread${thread.resolved ? ' rv-thread-resolved' : ''}`}>
      {thread.resolved && (
        <button type="button" className="rv-thread-fold" onClick={() => setOpen(false)}>
          <ChevronDown size={13} /> Resolved
        </button>
      )}
      {thread.comments.map((c) => (
        <Comment key={c.id} c={c} />
      ))}
      {canAct && (
        <div className="rv-tf">
          {replying ? (
            <div className="rv-reply-box">
              <textarea
                autoFocus
                className="rv-textarea"
                placeholder="Reply…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={textKeys(() => void send(), () => setReplying(false))}
              />
              <div className="rv-row">
                <span className="rv-spacer" />
                <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" loading={busy} disabled={!body.trim()} onClick={() => void send()}>
                  Reply
                </Button>
              </div>
            </div>
          ) : (
            <>
              {thread.canReply && (
                <button type="button" className="rv-reply" onClick={() => setReplying(true)}>
                  Reply…
                </button>
              )}
              {thread.canResolve && (
                <Button size="sm" icon={thread.resolved ? <Undo2 size={13} /> : <CircleCheck size={13} />} onClick={() => void resolveThread(repo, number, thread.id, !thread.resolved)}>
                  {thread.resolved ? 'Unresolve' : 'Resolve conversation'}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Where a new comment goes, as the composer shows it: "line 12" / "lines 10–12" (old side: "old line 4"). */
export const linesLabel = (side: 'LEFT' | 'RIGHT', line: number, startLine?: number) =>
  `${side === 'LEFT' ? 'old ' : ''}${startLine && startLine < line ? `lines ${startLine}–${line}` : `line ${line}`}`

export function Composer({
  repo,
  number,
  pull,
  lines,
  againstHead,
  features
}: {
  repo: string
  number: number
  pull: string
  /** The text of the lines commented on (for a suggested change). */
  lines: string[]
  /** Comments can be posted at once (the diff ends at the pull request's head). */
  againstHead: boolean
  features: ReviewFeatures
}) {
  const c = useReview((s) => s.composer)
  const ref = useRef<HTMLTextAreaElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    ref.current?.focus()
  }, [c?.line, c?.startLine])
  if (!c) return null
  const set = (body: string) => useReview.getState().setComposer({ ...c, body })
  const close = () => useReview.getState().setComposer(null)
  const draft = (): DraftComment => ({ path: c.path, side: c.side, line: c.line, ...(c.startLine && c.startLine < c.line ? { startLine: c.startLine } : {}), body: c.body })
  const add = () => {
    if (!c.body.trim()) return
    addDraft(pull, draft())
    close()
  }
  const now = async () => {
    if (!c.body.trim() || busy) return
    setBusy(true)
    const ok = await commentNow(repo, number, draft())
    setBusy(false)
    if (ok) close()
  }
  const suggest = () => {
    if (!features.suggestions) return
    const block = suggestionBlock(features.suggestions, lines)
    set(c.body ? `${c.body}\n${block}` : block)
  }
  return (
    <div className="rv-compose">
      <div className="rv-compose-label">
        Comment on <code>{linesLabel(c.side, c.line, c.startLine)}</code>
        {features.multiLine && <span className="rv-muted">· Shift-click another line’s + for several</span>}
      </div>
      <textarea
        ref={ref}
        className="rv-textarea"
        placeholder="Leave a comment"
        value={c.body}
        onChange={(e) => set(e.target.value)}
        onKeyDown={textKeys(add, close)}
      />
      <div className="rv-row">
        {c.side === 'RIGHT' && lines.length > 0 && features.suggestions && (
          <IconButton label="Suggest a change" size="sm" onClick={suggest}>
            <FileDiffIcon size={14} />
          </IconButton>
        )}
        <span className="rv-spacer" />
        <Button size="sm" variant="ghost" onClick={close}>
          Cancel
        </Button>
        {againstHead && (
          <Button size="sm" loading={busy} disabled={!c.body.trim()} onClick={() => void now()}>
            Comment now
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={!c.body.trim()} title="Kept with your review until you submit it (⌘↩)" onClick={add}>
          Add to review
        </Button>
      </div>
    </div>
  )
}

/** A comment kept for the next review, in the diff. */
export function DraftCard({ pull, draft, index }: { pull: string; draft: DraftComment; index: number }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(draft.body)
  return (
    <div className="rv-thread rv-thread-draft">
      <div className="rv-cm">
        <Avatar name="You" size={22} />
        <div className="rv-ct">
          <div className="rv-who">
            <b>You</b>
            <span className="rv-pending">Pending</span>
            <span className="rv-spacer" />
            {!editing && (
              <>
                <IconButton label="Edit" size="sm" onClick={() => setEditing(true)}>
                  <Pencil size={13} />
                </IconButton>
                <IconButton label="Delete" size="sm" onClick={() => removeDraft(pull, index)}>
                  <Trash2 size={13} />
                </IconButton>
              </>
            )}
          </div>
          {editing ? (
            <>
              <textarea
                autoFocus
                className="rv-textarea"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={textKeys(
                  () => {
                    if (body.trim()) editDraft(pull, index, body)
                    setEditing(false)
                  },
                  () => setEditing(false)
                )}
              />
              <div className="rv-row">
                <span className="rv-spacer" />
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!body.trim()}
                  onClick={() => {
                    editDraft(pull, index, body)
                    setEditing(false)
                  }}
                >
                  Save
                </Button>
              </div>
            </>
          ) : (
            <CommentBody body={draft.body} />
          )}
        </div>
      </div>
    </div>
  )
}
