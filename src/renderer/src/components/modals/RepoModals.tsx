// Clone / Init / Open repository modals.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FolderGit2, FolderOpen, FolderPlus, Globe, HardDrive, KeyRound, Lock } from 'lucide-react'
import { newOpId } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { validateRefName } from '@renderer/components/common/dialogs'
import { readJson, writeJson } from '@renderer/components/palette/history'
import { distinctParents, tildify } from '@renderer/components/layout/chrome'
import { useApp } from '@renderer/store/appStore'
import {
  cloneUrlKind,
  cloneUrlWarning,
  expandHome,
  isAbsolutePath,
  joinPath,
  repoNameFromUrl,
  validateCloneUrl,
  validateFolderName
} from './cloneUrl'
import { closeIfTopmost, PathField, ProgressBar, TextField } from './controls'

const PARENT_KEY = 'adar.clone.parentDir'

function useDefaultParent(): [string, (v: string) => void] {
  const home = useApp((s) => s.appInfo?.homeDir)
  const [parent, setParent] = useState(() => {
    const saved = readJson<string>(PARENT_KEY, '')
    return typeof saved === 'string' && saved ? saved : home ? joinPath(home, 'Projects') : ''
  })
  // appInfo may arrive after the modal opened: fill the default once, never after
  // the user has typed (clearing the field must not refill it).
  const initialised = useRef(!!parent)
  useEffect(() => {
    if (initialised.current || !home) return
    initialised.current = true
    setParent((p) => p || joinPath(home, 'Projects'))
  }, [home])
  const set = (v: string) => {
    initialised.current = true
    setParent(v)
  }
  return [parent, set]
}

function parentError(parent: string): string | null {
  if (!parent.trim()) return 'Choose a parent folder'
  if (!isAbsolutePath(parent)) return 'Use an absolute path'
  return null
}

function useMounted() {
  const ref = useRef(true)
  useEffect(() => {
    ref.current = true
    return () => {
      ref.current = false
    }
  }, [])
  return ref
}

// ── Clone ─────────────────────────────────────────────────────────────────

const KIND_LABEL = { https: 'HTTPS', ssh: 'SSH', git: 'git://', file: 'file://', local: 'Local path' } as const

export function CloneModal({ initialUrl }: { initialUrl?: string }) {
  const home = useApp((s) => s.appInfo?.homeDir)
  const [opId, setOpId] = useState<string | null>(null)
  const progress = useApp((s) => (opId ? s.progress[opId] : undefined))
  const [url, setUrl] = useState(initialUrl ?? '')
  const [parent, setParent] = useDefaultParent()
  const [name, setName] = useState(() => repoNameFromUrl(initialUrl ?? ''))
  const [nameEdited, setNameEdited] = useState(false)
  const [touched, setTouched] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [failed, setFailed] = useState(false)
  const mounted = useMounted()

  const urlError = validateCloneUrl(url)
  const pError = parentError(parent)
  const nError = validateFolderName(name)
  const hasErrors = !!(urlError || pError || nError)
  const kind = url.trim() ? cloneUrlKind(url) : null
  const warning = !urlError ? cloneUrlWarning(url) : null
  const parentAbs = expandHome(parent, home)
  const target = joinPath(parentAbs, name.trim())

  const onUrlChange = (v: string) => {
    setUrl(v)
    setFailed(false)
    if (!nameEdited) setName(repoNameFromUrl(v))
  }

  const submit = async () => {
    setTouched(true)
    if (hasErrors || cloning) return
    setCloning(true)
    setFailed(false)
    writeJson(PARENT_KEY, parent.trim())
    const id = newOpId('clone')
    setOpId(id)
    const ok = await git.cloneRepo(url.trim(), parentAbs, name.trim(), id)
    if (!mounted.current) return
    setCloning(false)
    setOpId(null)
    if (ok) {
      if (useApp.getState().modal?.kind === 'clone') useApp.getState().closeModal()
    } else setFailed(true)
  }

  const showErr = (e: string | null) => (touched || (e && url.trim()) ? e : null)

  return (
    <Modal
      title={
        <span className="md-title">
          <Download size={16} /> Clone a repository
        </span>
      }
      className="md-modal md-clone"
      width={560}
      dismissable={!cloning}
      onClose={() => closeIfTopmost('md-clone')}
      footer={
        <>
          <Button onClick={() => closeIfTopmost('md-clone')}>{cloning ? 'Hide' : 'Cancel'}</Button>
          <Button variant="primary" onClick={() => void submit()} loading={cloning} disabled={touched && hasErrors}>
            {cloning ? 'Cloning…' : 'Clone'}
          </Button>
        </>
      }
    >
      <form
        className="ui-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextField
          label="Repository URL"
          value={url}
          onChange={onUrlChange}
          placeholder="https://github.com/org/repo.git  or  git@github.com:org/repo.git"
          monospace
          autoFocus
          disabled={cloning}
          error={touched ? urlError : url.trim() && urlError && url.trim().length > 6 ? urlError : null}
          hint={warning ?? undefined}
          trailing={
            kind && !urlError ? (
              <span className={`md-kind md-kind-${kind}`}>
                {kind === 'ssh' ? <KeyRound size={11} /> : kind === 'local' || kind === 'file' ? <HardDrive size={11} /> : kind === 'https' ? <Lock size={11} /> : <Globe size={11} />}
                {KIND_LABEL[kind]}
              </span>
            ) : null
          }
        />
        <PathField
          label="Where to clone to"
          value={parent}
          onChange={setParent}
          error={showErr(pError)}
          disabled={cloning}
          placeholder={home ? joinPath(home, 'Projects') : '/path/to/folder'}
          pickerTitle="Choose where to clone the repository"
        />
        <TextField
          label="Folder name"
          value={name}
          onChange={(v) => {
            setName(v)
            setNameEdited(v.trim() !== '' && v !== repoNameFromUrl(url))
          }}
          disabled={cloning}
          monospace
          error={touched ? nError : null}
          hint={name.trim() && !pError ? <span className="md-path-preview">{tildify(target, home)}</span> : undefined}
        />

        {cloning && (
          <div className="md-clone-progress" aria-live="polite">
            <div className="md-clone-progress-line">
              <span className="md-clone-progress-msg">{progress?.message || 'Connecting…'}</span>
              {typeof progress?.percent === 'number' && <span className="md-clone-progress-pct">{Math.round(progress.percent)}%</span>}
            </div>
            <ProgressBar percent={progress?.percent} />
          </div>
        )}
        {failed && !cloning && (
          <div className="md-alert md-alert-error">
            Clone failed — see the notification for details. Check the URL, your access rights and that the destination folder does not exist yet (or is
            empty).
          </div>
        )}

        <div className="md-note">
          <Lock size={14} />
          <span>
            Private repositories work too. Adar runs your system <code>git</code>, so your SSH keys, macOS Keychain and credential helpers are used. If git
            needs a username, password / personal access token or SSH passphrase, you will be asked.
          </span>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

// ── Init ──────────────────────────────────────────────────────────────────

export function InitModal() {
  const home = useApp((s) => s.appInfo?.homeDir)
  const [parent, setParent] = useDefaultParent()
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('main')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const mounted = useMounted()

  const pError = parentError(parent)
  const nError = validateFolderName(name)
  const bError = validateRefName(branch)
  const hasErrors = !!(pError || nError || bError)
  const parentAbs = expandHome(parent, home)
  const target = joinPath(parentAbs, name.trim())

  const submit = async () => {
    setTouched(true)
    if (hasErrors || busy) return
    setBusy(true)
    writeJson(PARENT_KEY, parent.trim())
    const ok = await git.initRepoAt(target, branch.trim())
    if (!mounted.current) return
    setBusy(false)
    if (ok && useApp.getState().modal?.kind === 'init') useApp.getState().closeModal()
  }

  return (
    <Modal
      title={
        <span className="md-title">
          <FolderPlus size={16} /> Start a local repository
        </span>
      }
      className="md-modal md-init"
      width={520}
      onClose={() => closeIfTopmost('md-init')}
      footer={
        <>
          <Button onClick={() => closeIfTopmost('md-init')}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={touched && hasErrors}>
            Create repository
          </Button>
        </>
      }
    >
      <form
        className="ui-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextField label="Name" value={name} onChange={setName} placeholder="my-project" autoFocus monospace disabled={busy} error={touched ? nError : null} />
        <PathField
          label="Initialize in"
          value={parent}
          onChange={setParent}
          error={touched ? pError : null}
          disabled={busy}
          pickerTitle="Choose the parent folder"
          hint={name.trim() && !pError ? <span className="md-path-preview">{tildify(target, home)}</span> : 'The new folder is created inside this one.'}
        />
        <TextField
          label="Initial branch"
          value={branch}
          onChange={setBranch}
          monospace
          disabled={busy}
          error={touched || branch.trim() ? bError : null}
          hint="Usually main or master."
        />
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

// ── Open ──────────────────────────────────────────────────────────────────

export function OpenModal() {
  const home = useApp((s) => s.appInfo?.homeDir)
  const recent = useApp((s) => s.recent)
  const openPaths = useApp((s) => s.tabs.map((t) => t.path).join('\n'))
  const quick = useMemo(() => {
    const open = new Set(openPaths.split('\n'))
    return recent.filter((r) => !open.has(r.path)).slice(0, 6)
  }, [recent, openPaths])
  const hints = useMemo(() => distinctParents(quick), [quick])
  const [path, setPath] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const mounted = useMounted()

  const error = !path.trim() ? 'Enter the path of a repository' : !isAbsolutePath(path) ? 'Use an absolute path' : null

  const openAt = async (p: string) => {
    if (busy) return
    setBusy(true)
    const ok = await git.openRepoAt(expandHome(p, home))
    if (!mounted.current) return
    setBusy(false)
    if (ok && useApp.getState().modal?.kind === 'open') useApp.getState().closeModal()
  }

  const submit = () => {
    setTouched(true)
    if (error) return
    void openAt(path.trim())
  }

  return (
    <Modal
      title={
        <span className="md-title">
          <FolderOpen size={16} /> Open a repository
        </span>
      }
      className="md-modal md-open"
      width={540}
      onClose={() => closeIfTopmost('md-open')}
      footer={
        <>
          <Button onClick={() => closeIfTopmost('md-open')}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={touched && !!error}>
            Open
          </Button>
        </>
      }
    >
      <form
        className="ui-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <PathField
          label="Repository folder"
          value={path}
          onChange={setPath}
          error={touched ? error : null}
          disabled={busy}
          autoFocus
          placeholder="/path/to/repository"
          pickerTitle="Open a Git repository"
          hint="Any folder inside a Git working tree works."
        />
        {quick.length > 0 && (
          <div className="md-quick">
            <div className="md-quick-title">Recent</div>
            {quick.map((r) => (
              <button key={r.path} type="button" className="md-quick-item" disabled={busy} onClick={() => void openAt(r.path)} title={r.path}>
                <FolderGit2 size={14} />
                <span className="md-quick-name">{r.name}</span>
                {hints.has(r.path) && <span className="md-quick-hint">{hints.get(r.path)}</span>}
                <span className="md-quick-path">
                  <bdi>{tildify(r.path, home)}</bdi>
                </span>
              </button>
            ))}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
