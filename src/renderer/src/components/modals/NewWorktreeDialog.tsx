// "New worktree": another folder of the repository with its own branch checked out. An existing branch
// (local, or a remote one Adar makes a tracking branch for) or a new one from any branch; the folder is
// proposed next to the main one, named after the branch; opening it joins the current tab's group.

import { useId, useMemo, useState } from 'react'
import { FolderGit2, FolderOpen } from 'lucide-react'
import { api } from '@renderer/api/client'
import { createWorktree, mainWorktreeOf, worktreeFolder } from '@renderer/actions/worktrees'
import { Button } from '@renderer/components/common/Button'
import { validateRefName } from '@renderer/components/common/dialogs'
import { Modal } from '@renderer/components/common/Modal'
import { remoteBranchName } from '@renderer/lib/refs'
import { folderName, parentFolder } from '@renderer/lib/tabGroups'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import { closeIfTopmost, Segmented, Select } from './controls'

type Mode = 'existing' | 'new'

export function NewWorktreeDialog({ repo, branch: initial }: { repo: string; branch?: string }) {
  const tab = useApp((s) => s.tabs.find((t) => t.path === repo))
  const refs = tab?.refs ?? null
  const main = mainWorktreeOf(repo)
  const head = refs?.branches.find((b) => b.isHead)?.name ?? ''

  // Branches free to check out: local ones nobody has checked out, and remote ones without a local branch.
  const choices = useMemo(() => {
    const locals = (refs?.branches ?? []).filter((b) => !b.isHead && !b.worktree).map((b) => ({ value: b.name, label: b.name, branch: b.name, from: undefined as string | undefined }))
    const taken = new Set((refs?.branches ?? []).map((b) => b.name))
    const remotes = (refs?.remotes ?? [])
      .filter((r) => !r.isSymbolic && !taken.has(remoteBranchName(r)) && !(refs?.branches ?? []).some((b) => b.upstream === r.name))
      .map((r) => ({ value: r.name, label: r.name, branch: remoteBranchName(r), from: r.name }))
    return [...locals, ...remotes]
  }, [refs])
  const bases = useMemo(() => [...(refs?.branches ?? []).map((b) => b.name), ...(refs?.remotes ?? []).filter((r) => !r.isSymbolic).map((r) => r.name)], [refs])

  // Defaults follow the branches until the user picks (the dialog can open before they have loaded).
  const [modeChoice, setMode] = useState<Mode | null>(null)
  const mode: Mode = modeChoice ?? (choices.length ? 'existing' : 'new')
  const [pickedChoice, setPicked] = useState<string | null>(null)
  const picked = pickedChoice ?? (initial && choices.some((c) => c.value === initial) ? initial : (choices[0]?.value ?? ''))
  const [name, setName] = useState('')
  const [fromChoice, setFrom] = useState<string | null>(null)
  const from = fromChoice ?? (head || bases[0] || '')
  const choice = choices.find((c) => c.value === picked)
  const branch = mode === 'existing' ? (choice?.branch ?? '') : name.trim()
  const proposed = branch ? worktreeFolder(main, branch) : ''
  const [folder, setFolder] = useState<string | null>(null)
  const path = folder ?? proposed
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { branch: useId(), name: useId(), from: useId(), folder: useId() }
  const close = () => closeIfTopmost('md-worktree')

  const nameError = mode === 'new' && name.trim() ? (validateRefName(name) ?? (refs?.branches.some((b) => b.name === name.trim()) ? 'A branch with this name already exists' : null)) : null
  const ready = !!branch && !!path.trim() && !nameError && (mode === 'new' ? !!from : !!choice)

  const choose = async () => {
    try {
      const dir = await api.pickDirectory({ title: 'Where to put the worktree', defaultPath: parentFolder(path) || undefined })
      if (dir) setFolder(`${dir.replace(/[\\/]+$/, '')}/${folderName(path) || folderName(proposed)}`)
    } catch (err) {
      setError(describeError(err))
    }
  }

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await createWorktree(repo, {
        branch,
        from: mode === 'new' ? from : choice?.from,
        track: mode === 'existing' && !!choice?.from,
        path: path.trim(),
        open
      })
      useApp.getState().closeModal()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={
        <span className="md-title">
          <FolderGit2 size={16} /> New worktree
        </span>
      }
      className="md-modal md-worktree"
      width={560}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()}>
            Create worktree
          </Button>
        </>
      }
    >
      <div className="md-worktree-body">
        <p className="md-cleanup-lead">
          Another folder of <strong>{tab?.name ?? folderName(main)}</strong> with its own branch checked out, so your work here stays as it is. It shares commits,
          branches and remotes with this one.
        </p>
        <div className="ui-field">
          <span className="ui-label">Branch</span>
          <Segmented<Mode>
            value={mode}
            ariaLabel="Branch"
            options={[
              { value: 'existing', label: 'Existing branch' },
              { value: 'new', label: 'New branch' }
            ]}
            onChange={(m) => {
              setMode(m)
              setFolder(null)
            }}
          />
        </div>
        {mode === 'existing' ? (
          <div className="ui-field">
            <Select
              id={ids.branch}
              aria-label="Existing branch"
              value={picked}
              onChange={(e) => {
                setPicked(e.target.value)
                setFolder(null)
              }}
            >
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            <small className="ui-hint">
              {choices.length ? 'Local and remote branches. One checked out here or in another worktree is not offered.' : 'Every branch is checked out somewhere: make a new one.'}
            </small>
          </div>
        ) : (
          <div className="md-worktree-two">
            <div className="ui-field">
              <input
                id={ids.name}
                aria-label="New branch name"
                className={`ui-input ui-mono${nameError ? ' ui-invalid' : ''}`}
                placeholder="feature/my-change"
                value={name}
                spellCheck={false}
                autoComplete="off"
                autoFocus
                onChange={(e) => {
                  setName(e.target.value)
                  setFolder(null)
                }}
              />
              {nameError && <small className="ui-error">{nameError}</small>}
            </div>
            <div className="ui-field">
              <Select id={ids.from} aria-label="Start from" value={from} onChange={(e) => setFrom(e.target.value)}>
                {bases.map((b) => (
                  <option key={b} value={b}>
                    from {b}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
        <div className="ui-field">
          <label className="ui-label" htmlFor={ids.folder}>
            Folder
          </label>
          <div className="md-path">
            <input
              id={ids.folder}
              className="ui-input ui-mono"
              value={path}
              placeholder="Choose a branch first"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setFolder(e.target.value)}
            />
            <Button type="button" icon={<FolderOpen size={14} />} onClick={() => void choose()}>
              Choose…
            </Button>
          </div>
          <small className="ui-hint">Next to the repository, named after the branch. It must not exist yet.</small>
        </div>
        <label className="md-worktree-check">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          Open it in a new tab, in the same tab group
        </label>
        {error && (
          <div className="md-cleanup-warn" role="alert">
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
