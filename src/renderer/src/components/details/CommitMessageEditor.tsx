// Inline editor for an existing commit's message (GitKraken's "Edit commit message").
// Its text lives in useMessageEdit, so hiding the panel or switching tabs does not lose it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { rewordCommit } from '@renderer/actions/git'
import { Button } from '@renderer/components/common/Button'
import { summarizeList } from '@renderer/lib/format'
import { isMod, shortcutLabel } from '@renderer/lib/keys'
import { useMessageEdit, type OpenMessageEdit } from '@renderer/lib/messageEdit'
import { useApp } from '@renderer/store/appStore'
import type { RewordInfo } from '@shared/types'
import { cleanMessage, composeEditedMessage, summaryLength, SUMMARY_SOFT_LIMIT } from './message'

export interface CommitMessageEditorProps {
  repo: string
  edit: OpenMessageEdit
  onDone: (newSha: string | null) => void
}

/** What changing this commit means for the branches and tags that already have it. */
export function rewordWarnings(info: RewordInfo): { text: string; full?: string }[] {
  const out: { text: string; full?: string }[] = []
  if (info.upstream) {
    out.push({ text: `Already pushed to ${info.upstream}. Updating it rewrites history and will need a force push.` })
  }
  const others = [...info.localBranches, ...info.remoteBranches]
  if (others.length) {
    out.push({
      text: `${summarizeList(others)} ${others.length === 1 ? 'also has it and keeps' : 'also have it and keep'} the original commit.`,
      full: others.join('\n')
    })
  }
  if (info.tags.length) {
    out.push({
      text: `${info.tags.length === 1 ? 'Tag' : 'Tags'} ${summarizeList(info.tags)} will keep pointing at the original commit.`,
      full: info.tags.join('\n')
    })
  }
  return out
}

export function CommitMessageEditor({ repo, edit, onDone }: CommitMessageEditorProps) {
  const { sha, info, summary, description } = edit
  const patch = useMessageEdit((s) => s.patchOpen)
  const busy = useApp((s) => !!s.busy[`reword:${repo}`])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const summaryRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    summaryRef.current?.focus()
    summaryRef.current?.select()
  }, [])
  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 220)}px`
  }, [description])

  const next = composeEditedMessage(info.message, summary, description)
  const locked = busy || saving
  // Whitespace git would clean up anyway is not a change (it must not offer a pointless rewrite).
  const changed = cleanMessage(next) !== cleanMessage(info.message)
  const canSave = !locked && changed && summary.trim().length > 0
  const remaining = SUMMARY_SOFT_LIMIT - summaryLength(summary)
  const warnings = rewordWarnings(info)

  const save = async () => {
    // A ref, not just state: a double click or Mod+Enter plus a click can arrive before React re-renders.
    if (!canSave || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const newSha = await rewordCommit(repo, sha, next)
      if (newSha) onDone(newSha)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return // Enter/Escape confirm or cancel an input-method composition
    if (e.key === 'Enter' && isMod(e)) {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape' && !locked) {
      e.preventDefault()
      e.stopPropagation()
      onDone(null)
    }
  }

  return (
    <div className="det-msg-editor" onKeyDown={onKey}>
      <div className="det-msg-editor-row">
        <input
          ref={summaryRef}
          className="ui-input det-msg-editor-summary"
          value={summary}
          placeholder="Summary"
          aria-label="Commit summary"
          spellCheck
          disabled={locked}
          onChange={(e) => patch(repo, { summary: e.target.value })}
        />
        <span className={`det-msg-editor-count${remaining < 0 ? ' det-msg-editor-count-over' : ''}`}>{remaining}</span>
      </div>
      <textarea
        ref={descRef}
        className="ui-input det-msg-editor-desc"
        value={description}
        placeholder="Description"
        aria-label="Commit description"
        rows={3}
        spellCheck
        disabled={locked}
        onChange={(e) => patch(repo, { description: e.target.value })}
      />
      {warnings.map((w) => (
        <div key={w.text} className="det-msg-editor-warn" title={w.full}>
          <AlertTriangle size={13} />
          <span>{w.text}</span>
        </div>
      ))}
      <div className="det-msg-editor-actions">
        <Button size="sm" onClick={() => onDone(null)} disabled={locked}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void save()}
          disabled={!canSave}
          loading={locked}
          title={`Update message (${shortcutLabel('Mod+Enter')})`}
        >
          Update message
        </Button>
      </div>
    </div>
  )
}
