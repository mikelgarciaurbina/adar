// "Create pull request": from a local branch into a branch of the hosting remote, with the
// title and description written from the branch's commits, pushing the branch first when
// the remote does not have all of it yet.

import { useEffect, useId, useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, GitPullRequest, Upload } from 'lucide-react'
import { api } from '@renderer/api/client'
import { createPullRequest } from '@renderer/actions/pulls'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { closeIfTopmost, Select } from '@renderer/components/modals/controls'
import { pluralize } from '@renderer/lib/format'
import { pushPlan, suggestBody, suggestTitle } from '@renderer/lib/pulls'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import { MAX_TITLE } from '@shared/hosting'
import type { Commit } from '@shared/types'
import { usePulls } from './pullStore'
import './pulls.css'

export function CreatePullDialog({ repo, head: initialHead, base: initialBase }: { repo: string; head?: string; base?: string }) {
  const tab = useApp((s) => s.tabs.find((t) => t.path === repo))
  const data = usePulls((s) => s.repos[repo]?.data ?? null)
  const refs = tab?.refs ?? null
  const remote = data?.remote ?? 'origin'
  const locals = refs?.branches ?? []
  const bases = useMemo(() => {
    const names = (refs?.remotes ?? []).filter((r) => !r.isSymbolic && r.name.startsWith(remote + '/')).map((r) => r.name.slice(remote.length + 1))
    const def = data?.defaultBranch
    return def && names.includes(def) ? [def, ...names.filter((n) => n !== def)] : names
  }, [refs, remote, data?.defaultBranch])

  const [head, setHead] = useState(initialHead ?? locals.find((b) => b.isHead)?.name ?? '')
  const [base, setBase] = useState(initialBase && bases.includes(initialBase) ? initialBase : (bases[0] ?? ''))
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [edited, setEdited] = useState({ title: false, body: false })
  const [draft, setDraft] = useState(false)
  const [commits, setCommits] = useState<Commit[] | null>(null)
  const [showCommits, setShowCommits] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { head: useId(), base: useId(), title: useId(), body: useId() }
  const close = () => closeIfTopmost('pr-create')

  const branch = locals.find((b) => b.name === head)
  const plan = branch ? pushPlan(branch, remote) : null

  // The branch's commits that the base does not have: they write the title and the description.
  useEffect(() => {
    if (!head || !base) return
    let alive = true
    setCommits(null)
    api
      .getLog(repo, { revisions: [head, `^${remote}/${base}`], maxCount: 100 })
      .then((page) => {
        if (!alive) return
        setCommits(page.commits)
        const subjects = page.commits.map((c) => c.subject)
        setTitle((t) => (edited.title ? t : suggestTitle(head, subjects)))
        setBody((b) => (edited.body ? b : suggestBody(subjects)))
      })
      .catch(() => alive && setCommits([]))
    return () => {
      alive = false
    }
    // Edits are read when the commits arrive; typing must not reload them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, head, base, remote])

  const problem = !data
    ? 'The pull requests of this repository could not be read.'
    : !head
      ? 'Choose the branch to create the pull request from.'
      : !base
        ? `${remote} has no branches to merge into.`
        : plan?.kind === 'other-remote'
          ? `${head} tracks ${plan.upstream}. Pull requests from other remotes are not supported yet.`
          : plan?.kind === 'behind'
            ? `${remote}/${plan.head} has ${pluralize(plan.behind, 'commit')} that ${head} does not have. Pull first.`
            : (plan?.head ?? head) === base
              ? 'Choose two different branches.'
              : commits && commits.length === 0
                ? `${head} has no commits that ${base} does not have.`
                : null

  const submit = async () => {
    if (!data || problem || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createPullRequest(repo, data, { head, base, title: title.trim(), body, draft })
      useApp.getState().closeModal()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const pushes = plan?.kind === 'publish' || plan?.kind === 'push'
  return (
    <Modal
      title={
        <span className="md-title">
          <GitPullRequest size={16} /> Create pull request
        </span>
      }
      className="md-modal pr-create"
      width={600}
      onClose={close}
      footer={
        <>
          <span className="pr-footer-where md-footer-start" title={data?.webUrl}>
            {remote} · {data ? `${data.host}/${data.owner}/${data.name}` : ''}
          </span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon={<GitPullRequest size={14} />} loading={busy} disabled={!!problem || !title.trim()} onClick={() => void submit()}>
            {pushes ? 'Push and create' : 'Create pull request'}
          </Button>
        </>
      }
    >
      <div className="pr-create-body">
        <div className="pr-fromto">
          <div className="ui-field">
            <label className="ui-label" htmlFor={ids.head}>
              From
            </label>
            <Select id={ids.head} value={head} onChange={(e) => setHead(e.target.value)}>
              {locals.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <ArrowRight size={16} className="pr-arrow pr-fromto-arrow" aria-label="into" />
          <div className="ui-field">
            <label className="ui-label" htmlFor={ids.base}>
              Into
            </label>
            <Select id={ids.base} value={base} onChange={(e) => setBase(e.target.value)}>
              {bases.map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === data?.defaultBranch ? ' (default)' : ''}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {problem ? (
          <div className="pr-error" role="alert">
            {problem}
          </div>
        ) : (
          pushes && (
            <div className="pr-notice">
              <Upload size={15} />
              <span>
                {plan.kind === 'publish' ? (
                  <>
                    <strong>{head}</strong> is not on {remote} yet. Adar pushes it first.
                  </>
                ) : (
                  <>
                    {pluralize(plan.ahead, 'commit')} on <strong>{head}</strong> {plan.ahead === 1 ? 'is' : 'are'} not on {remote} yet. Adar pushes {plan.ahead === 1 ? 'it' : 'them'} first.
                  </>
                )}
              </span>
            </div>
          )
        )}

        <div className="ui-field">
          <label className="ui-label" htmlFor={ids.title}>
            Title
          </label>
          <input
            id={ids.title}
            className="ui-input"
            value={title}
            maxLength={MAX_TITLE}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value)
              setEdited((x) => ({ ...x, title: true }))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </div>
        <div className="ui-field">
          <label className="ui-label" htmlFor={ids.body}>
            Description <span className="pr-label-note">written from the branch's commits</span>
          </label>
          <textarea
            id={ids.body}
            className="ui-input pr-textarea"
            rows={6}
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              setEdited((x) => ({ ...x, body: true }))
            }}
          />
        </div>

        {commits && commits.length > 0 && (
          <div className="pr-commits">
            <button type="button" className="pr-commits-toggle" aria-expanded={showCommits} onClick={() => setShowCommits((v) => !v)}>
              {showCommits ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {pluralize(commits.length, 'commit')}
              {commits.length >= 100 ? ' or more' : ''}
            </button>
            {showCommits && (
              <ul className="pr-commit-list">
                {commits.map((c) => (
                  <li key={c.sha}>
                    <span className="pr-sha">{c.shortSha}</span>
                    <span className="pr-commit-subject">{c.subject}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <label className="pr-check">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          Create as a draft <span className="pr-muted">· not ready for review yet</span>
        </label>

        {error && (
          <div className="pr-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
