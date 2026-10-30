// "Branches never cleaned up": the repository's list for Clean up branches. The default branch, what its
// service protects (asked only while pull requests are on), and the names and patterns kept here, which
// the × stops keeping (with Undo). Opened from the cleanup dialog's Edit…, the Local section's menu and
// the command palette.

import { useEffect, useState, type FormEvent } from 'react'
import { Info, Pin, Shield, X } from 'lucide-react'
import { keptIn, loadProtectedBranches, setKept, useKeepRules, useProtectedBranches, type ProtectedBranches } from '@renderer/actions/cleanup'
import { openConnect } from '@renderer/actions/pulls'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { repoHosting, usePulls } from '@renderer/components/pulls/pullStore'
import { LONG_LIVED, cleanupBase, keptMatches } from '@renderer/lib/cleanup'
import { pullNoun } from '@renderer/lib/pulls'
import { defaultRemote, mainBranch } from '@renderer/lib/refs'
import { useApp } from '@renderer/store/appStore'
import { isKeepPattern } from '@shared/hosting'

type Row = { name: string; kind: 'base' | 'protected' | 'mine' }

export function KeptBranchesDialog({ repo, onClose }: { repo: string; onClose(): void }) {
  const tab = useApp((s) => s.tabs.find((t) => t.path === repo))
  const pulls = usePulls((s) => s.repos[repo]?.data ?? null)
  const shielded = useProtectedBranches((s) => s.repos[repo])
  const rules = useKeepRules(repo)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadProtectedBranches(repo)
  }, [repo])

  const refs = tab?.refs ?? null
  const base = cleanupBase(refs, pulls, mainBranch(refs))
  const remote = defaultRemote(refs, tab?.info?.remotes.map((r) => r.name) ?? [])
  const service = shielded?.service ?? 'the service'
  const rows: Row[] = [
    { name: base, kind: 'base' },
    ...rules.protected.filter((p) => p !== base).map((name) => ({ name, kind: 'protected' as const })),
    ...rules.mine.filter((p) => p !== base && !rules.protected.includes(p)).map((name) => ({ name, kind: 'mine' as const }))
  ]
  const locals = refs?.branches.map((b) => b.name) ?? []
  const remotes = remote ? (refs?.remotes.filter((r) => r.remote === remote && !r.isSymbolic).map((r) => r.name.slice(remote.length + 1)) ?? []) : []

  const name = value.trim()
  const error = !name
    ? null
    : !isKeepPattern(name)
      ? 'Use a branch name, or a pattern such as env/*'
      : name === base
        ? `${base} is the default branch: it is always kept`
        : LONG_LIVED.includes(name)
          ? `${name} is kept in every repository already`
          : rules.protected.includes(name)
            ? `${name} is protected on ${service} already`
            : rules.mine.includes(name)
              ? `${name} is kept already`
              : null

  const add = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name || error || busy) return
    setBusy(true)
    try {
      if (await setKept(repo, name, true, { quiet: true })) setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={
        <span className="md-title">
          <Pin size={16} /> Branches never cleaned up
        </span>
      }
      className="md-modal md-kept"
      width={560}
      onClose={onClose}
      footer={
        <>
          <span className="md-footer-start md-cleanup-undo">Saved in {keptIn(repo)}, so its worktrees share it.</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="md-cleanup-body">
        <p className="md-cleanup-lead">
          Clean up branches never offers these in <strong>{keptIn(repo)}</strong>
          {remote ? `, here or on ${remote}` : ''}. You can still delete them by hand.
        </p>
        <div className="md-cleanup-group md-kept-list">
          {rows.map((r) => {
            const matches = r.name.includes('*') ? keptMatches(r.name, locals, remote, remotes) : null
            return (
              <div key={`${r.kind}:${r.name}`} className="md-kept-row">
                <span className="md-cleanup-name">{r.name}</span>
                <span className={`md-cleanup-tag md-kept-tag-${r.kind}`}>
                  {r.kind === 'base' ? 'default branch' : r.kind === 'protected' ? `protected on ${service}` : 'kept by you'}
                </span>
                {r.kind === 'mine' ? (
                  <button type="button" className="ui-icon-btn md-kept-rm" aria-label={`Stop keeping ${r.name}`} title="Stop keeping it" onClick={() => void setKept(repo, r.name, false)}>
                    <X size={14} />
                  </button>
                ) : (
                  <span />
                )}
                {matches && <Matches names={matches} />}
              </div>
            )
          })}
          <ServiceNote repo={repo} shielded={shielded} />
        </div>
        <form className="ui-field" onSubmit={(e) => void add(e)}>
          <label className="ui-label" htmlFor="md-kept-add">
            Keep another branch
          </label>
          <div className="md-kept-add">
            <input
              id="md-kept-add"
              className={`ui-input ui-mono${error ? ' ui-invalid' : ''}`}
              placeholder="qa, or env/*"
              value={value}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              onChange={(e) => setValue(e.target.value)}
            />
            <Button type="submit" disabled={!name || !!error} loading={busy}>
              Keep
            </Button>
          </div>
          {error ? (
            <small className="ui-error">{error}</small>
          ) : (
            <small className="ui-hint">
              A name or a pattern: <code>*</code> stands for any text, so <code>env/*</code> keeps <code>env/eu</code> and <code>env/us</code>.
            </small>
          )}
        </form>
        <span className="md-kept-also">
          <Info size={13} />
          <span>
            Kept in every repository too: <Names names={LONG_LIVED.filter((n) => n !== base)} />.
          </span>
        </span>
      </div>
    </Modal>
  )
}

/** What the service said, when it is not a plain list: pull requests off, it would not say, or it could not be asked. */
function ServiceNote({ repo, shielded }: { repo: string; shielded: ProtectedBranches | null | undefined }) {
  if (!shielded || shielded.state === 'known') return null
  const { service } = shielded
  if (shielded.state === 'off') {
    const hosting = repoHosting(useApp.getState().tabs.find((t) => t.path === repo))
    return (
      <div className="md-kept-note">
        <Shield size={13} />
        <span>
          Turn on {pullNoun(hosting?.provider, true)} to also keep the branches protected on {service}.{' '}
          <button type="button" className="ui-link" onClick={() => openConnect(hosting)}>
            Turn on…
          </button>
        </span>
      </div>
    )
  }
  if (shielded.state === 'hidden') {
    const why = service === 'Bitbucket' ? 'it tells only repository admins' : service === 'GitLab' ? 'it does not show them to your role in this project' : 'it does not show them to this sign-in'
    return (
      <div className="md-kept-note">
        <Info size={13} />
        <span>
          {service} did not say which branches are protected: {why}. Keep the ones you need here.
        </span>
      </div>
    )
  }
  return (
    <div className="md-kept-note">
      <Info size={13} />
      <span>
        Could not ask {service} which branches are protected: {shielded.error}
      </span>
    </div>
  )
}

const SHOWN = 4

function Matches({ names }: { names: string[] }) {
  if (!names.length) return <span className="md-kept-sub">Matches no branch yet</span>
  const shown = names.slice(0, SHOWN)
  const more = names.length - shown.length
  return (
    <span className="md-kept-sub">
      Matches{' '}
      {shown.map((n, i) => (
        <span key={n}>
          {i > 0 && (i === shown.length - 1 && !more ? ' and ' : ', ')}
          <code>{n}</code>
        </span>
      ))}
      {more > 0 && ` and ${more} more`}
    </span>
  )
}

export function Names({ names }: { names: readonly string[] }) {
  return (
    <>
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 && (i === names.length - 1 ? ' and ' : ', ')}
          <code>{n}</code>
        </span>
      ))}
    </>
  )
}
