// One file of a pull request (or of an agent's work) in the review view: the unified diff with syntax and word
// highlighting, the comment threads under the lines they are on, the comments kept for the review (notes for the
// agent), and the box for a new comment (the + in the gutter; Shift-click a second + for several lines).

import { Fragment, useCallback, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Code } from '@renderer/components/diff/DiffRenderer'
import { buildDiffModel } from '@renderer/components/diff/diffModel'
import { useSyntax } from '@renderer/components/diff/useSyntax'
import { wordDiff, type Range, type WordDiff } from '@renderer/components/diff/wordDiff'
import { pluralize } from '@renderer/lib/format'
import type { DraftComment, DiffSide, ReviewFeatures } from '@shared/review'
import type { DiffLine, FileDiff } from '@shared/types'
import { lineSlot, type FileThreads } from './model'
import { Composer, DraftCard, Thread } from './parts'
import { useReview, type ReviewId } from './reviewStore'

/** Lines shown before "Show N more lines". */
const FIRST_LINES = 2500

interface Props {
  repo: string
  number: ReviewId
  /** The pull request's key (drafts). */
  pull: string
  diff: FileDiff
  path: string
  threads: FileThreads
  drafts: Array<{ draft: DraftComment; index: number }>
  /** The diff starts at the pull request's base: comments may go on the old side too. */
  againstBase: boolean
  canComment: boolean
  features: ReviewFeatures
}

export function ReviewDiff({ repo, number, pull, diff, path, threads, drafts, againstBase, canComment, features }: Props) {
  const model = useMemo(() => buildDiffModel(diff, { hunkHeaders: true }), [diff])
  const blocks = useMemo(() => model.hunks.flatMap((h) => [h.oldText, h.newText]), [model])
  const lookup = useSyntax(path, blocks)
  const composer = useReview((s) => s.composer)
  const [all, setAll] = useState(false)
  const words = useMemo(() => new Map<string, WordDiff | null>(), [diff])

  const wordsFor = useCallback(
    (h: number, i: number, line: DiffLine): Range[] | null => {
      if (line.type === 'context') return null
      const p = model.hunks[h].pair[i]
      if (p < 0) return null
      const key = `${h}:${Math.min(i, p)}`
      let wd = words.get(key)
      if (wd === undefined) {
        const other = diff.hunks[h].lines[p]
        wd = line.type === 'del' ? wordDiff(line.content, other.content) : wordDiff(other.content, line.content)
        words.set(key, wd)
      }
      return wd ? (line.type === 'del' ? wd.a : wd.b) : null
    },
    [model, diff, words]
  )

  const draftsAt = useMemo(() => {
    const m = new Map<string, Array<{ draft: DraftComment; index: number }>>()
    for (const d of drafts) {
      const slot = lineSlot(d.draft.side, d.draft.line)
      m.set(slot, [...(m.get(slot) ?? []), d])
    }
    return m
  }, [drafts])

  /** The text of new-side lines from..to of this file (for a suggested change). */
  const textOf = (side: DiffSide, from: number, to: number) => {
    const out: string[] = []
    for (const h of diff.hunks) for (const l of h.lines) {
      const n = side === 'LEFT' ? (l.type !== 'add' ? l.oldLine : null) : l.type !== 'del' ? l.newLine : null
      if (n !== null && n >= from && n <= to) out.push(l.content)
    }
    return out
  }

  const start = (side: DiffSide, line: number, extend: boolean) => {
    const c = useReview.getState().composer
    if (extend && features.multiLine && c && c.path === path && c.side === side && c.key === pull) {
      const lo = Math.min(c.startLine ?? c.line, c.line, line)
      const hi = Math.max(c.startLine ?? c.line, c.line, line)
      useReview.getState().setComposer({ ...c, line: hi, startLine: lo < hi ? lo : undefined })
      return
    }
    useReview.getState().setComposer({ key: pull, path, side, line, body: '' })
  }

  const open = composer && composer.key === pull && composer.path === path ? composer : null
  const inRange = (side: DiffSide, n: number | null) => !!open && n !== null && open.side === side && n >= (open.startLine ?? open.line) && n <= open.line

  if (diff.binary) return <div className="rv-note-block">Binary file: no lines to show.</div>
  if (diff.tooLarge) return <div className="rv-note-block">This diff is too large to show here.</div>
  if (!diff.hunks.length) return <div className="rv-note-block">{diff.oldPath ? `Renamed from ${diff.oldPath}, no other changes.` : 'No changes to the content.'}</div>

  let shown = 0
  let hidden = 0
  return (
    <div className="rv-diff">
      {diff.hunks.map((hunk, h) => (
        <Fragment key={h}>
          <div className="rv-hunk">{hunk.header}</div>
          {hunk.lines.map((line, i) => {
            if (!all && shown >= FIRST_LINES) {
              hidden++
              return null
            }
            shown++
            const side: DiffSide = line.type === 'del' ? 'LEFT' : 'RIGHT'
            const n = line.type === 'del' ? line.oldLine : line.newLine
            const slot = n !== null ? lineSlot(side, n) : null
            const commentable = canComment && n !== null && (side === 'RIGHT' || againstBase)
            const tokens = line.type === 'del' ? lookup(2 * h, model.hunks[h].oldPos[i]) : lookup(2 * h + 1, model.hunks[h].newPos[i])
            const here = slot ? threads.byLine.get(slot) : undefined
            const mine = slot ? draftsAt.get(slot) : undefined
            return (
              <Fragment key={i}>
                <div className={`rv-l rv-l-${line.type}${inRange(side, n) ? ' rv-l-sel' : ''}`}>
                  <span className="rv-ln">{line.oldLine ?? ''}</span>
                  <span className="rv-ln">{line.newLine ?? ''}</span>
                  <span className="rv-gut">
                    {commentable && (
                      <button
                        type="button"
                        className="rv-add"
                        title={`${number === 'work' ? 'Leave a note on this line' : 'Comment on this line'}${features.multiLine ? ' (Shift-click: down to here)' : ''}`}
                        aria-label={`${number === 'work' ? 'Leave a note on' : 'Comment on'} line ${n}`}
                        onClick={(e) => start(side, n!, e.shiftKey)}
                      >
                        <Plus size={12} strokeWidth={2.5} />
                      </button>
                    )}
                  </span>
                  <span className="rv-sign">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span>
                  <Code text={line.content} tokens={tokens} ranges={wordsFor(h, i, line)} type={line.type} noNewline={!!line.noNewline} />
                </div>
                {here?.map((t) => (
                  <Thread key={t.id} repo={repo} number={number} thread={t} canAct={canComment} />
                ))}
                {mine?.map((d) => (
                  <DraftCard key={`d${d.index}`} pull={pull} draft={d.draft} index={d.index} />
                ))}
                {open && slot === lineSlot(open.side, open.line) && (
                  <Composer repo={repo} number={number} pull={pull} lines={textOf(open.side, open.startLine ?? open.line, open.line)} againstHead={canComment} features={features} />
                )}
              </Fragment>
            )
          })}
        </Fragment>
      ))}
      {hidden > 0 && (
        <button type="button" className="rv-more-lines" onClick={() => setAll(true)}>
          Show {pluralize(hidden, 'more line')}
        </button>
      )}
    </div>
  )
}
