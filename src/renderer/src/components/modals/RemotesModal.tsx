// Manage the remotes of a repository: add, edit URL, rename, remove, fetch.

import { useState } from 'react'
import { Network, Pencil, Plus, RefreshCw, TextCursorInput, Trash2 } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { Button, EmptyState, IconButton, Spinner } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { form, prompt } from '@renderer/components/common/dialogs'
import { useApp, useTab } from '@renderer/store/appStore'
import type { RemoteInfo } from '@shared/types'
import { urlHost, validateCloneUrl, validateRemoteName } from './cloneUrl'
import { closeIfTopmost } from './controls'
import { hostingProvider } from './credentials'

export function RemotesModal({ repo }: { repo: string }) {
  const tab = useTab(repo)
  const fetching = useApp((s) => `fetch:${repo}` in s.busy)
  const [working, setWorking] = useState<string | null>(null)
  const remotes = tab?.info?.remotes ?? []
  const names = remotes.map((r) => r.name)

  /** Run a remote action (which toasts and refreshes itself) with a per-row spinner. */
  const withRow = async (key: string, fn: () => Promise<boolean>): Promise<boolean> => {
    setWorking(key)
    try {
      return await fn()
    } finally {
      setWorking(null)
    }
  }

  const fetchRemote = async (name: string) => {
    const ok = await withRow(name, () => git.fetchRemote(repo, name))
    if (ok) useApp.getState().markFetched(repo)
  }

  const add = async () => {
    const res = await form({
      title: 'Add remote',
      message: 'HTTPS and SSH URLs work for public and private repositories.',
      fields: [
        {
          type: 'text',
          name: 'name',
          label: 'Name',
          defaultValue: names.includes('origin') ? (names.includes('upstream') ? '' : 'upstream') : 'origin',
          required: true,
          monospace: true,
          validate: (v) => validateRemoteName(v, names)
        },
        {
          type: 'text',
          name: 'url',
          label: 'URL',
          placeholder: 'git@github.com:org/repo.git',
          required: true,
          autoFocus: true,
          monospace: true,
          validate: (v) => validateCloneUrl(v)
        },
        { type: 'checkbox', name: 'fetch', label: 'Fetch after adding', defaultValue: true }
      ],
      confirmLabel: 'Add remote'
    })
    if (!res) return
    const name = String(res.name).trim()
    const url = String(res.url).trim()
    const ok = await withRow(name, () => git.addRemote(repo, name, url))
    if (ok && res.fetch) await fetchRemote(name)
  }

  const editUrl = async (r: RemoteInfo) => {
    const res = await form({
      title: `Edit URL of ${r.name}`,
      fields: [
        {
          type: 'text',
          name: 'url',
          label: 'URL',
          defaultValue: r.fetchUrl,
          required: true,
          autoFocus: true,
          monospace: true,
          validate: (v) => validateCloneUrl(v),
          hint: r.pushUrl && r.pushUrl !== r.fetchUrl ? 'This remote has a separate push URL; git set-url changes the fetch URL.' : undefined
        }
      ],
      confirmLabel: 'Save',
      width: 520
    })
    if (!res) return
    const url = String(res.url).trim()
    if (url === r.fetchUrl) return
    await withRow(r.name, () => git.setRemoteUrl(repo, r.name, url))
  }

  const rename = async (r: RemoteInfo) => {
    const next = await prompt({
      title: `Rename remote ${r.name}`,
      label: 'New name',
      defaultValue: r.name,
      monospace: true,
      confirmLabel: 'Rename',
      validate: (v) => (v.trim() === r.name ? null : validateRemoteName(v, names))
    })
    if (!next || next.trim() === r.name) return
    const name = next.trim()
    await withRow(r.name, () => git.renameRemote(repo, r.name, name))
  }

  // git.removeRemote asks for confirmation itself, so no row spinner behind the dialog;
  // the row disappears once the refresh lands.
  const remove = (r: RemoteInfo) => git.removeRemote(repo, r.name)

  return (
    <Modal
      title={
        <span className="md-title">
          <Network size={16} /> Remotes{tab ? <span className="md-title-dim"> · {tab.name}</span> : null}
        </span>
      }
      className="md-modal md-remotes"
      width={760}
      onClose={() => closeIfTopmost('md-remotes')}
      footer={
        <>
          <Button onClick={() => void git.fetchAll(repo)} disabled={!remotes.length || fetching} loading={fetching} icon={<RefreshCw size={14} />}>
            Fetch all
          </Button>
          <span className="md-footer-spacer" />
          <Button onClick={() => closeIfTopmost('md-remotes')}>Close</Button>
          <Button variant="primary" onClick={() => void add()} disabled={!tab} icon={<Plus size={14} />}>
            Add remote
          </Button>
        </>
      }
    >
      {!tab ? (
        <EmptyState title="Repository is not open" />
      ) : !tab.info ? (
        <div className="md-loading">
          <Spinner size="sm" /> Loading remotes…
        </div>
      ) : remotes.length === 0 ? (
        <EmptyState icon={<Network size={28} />} title="No remotes">
          Add a remote (for example <code>origin</code>) to push and pull. Any host works: GitHub, GitLab, Bitbucket, Azure DevOps or your own server.
        </EmptyState>
      ) : (
        <table className="md-table">
          <thead>
            <tr>
              <th style={{ width: '22%' }}>Name</th>
              <th>URL</th>
              <th className="md-table-actions-col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {remotes.map((r) => {
              const host = urlHost(r.fetchUrl)
              const provider = host ? hostingProvider(host) : null
              const busyRow = working === r.name
              return (
                <tr key={r.name}>
                  <td>
                    <div className="md-remote-name">
                      <span className="md-remote-label">{r.name}</span>
                      {provider && <span className="md-tag">{provider}</span>}
                    </div>
                  </td>
                  <td>
                    <button className="md-url" title={`${r.fetchUrl}\nClick to copy`} onClick={() => void git.copyText(r.fetchUrl, 'URL copied')}>
                      {r.fetchUrl || <em>(no URL)</em>}
                    </button>
                    {r.pushUrl && r.pushUrl !== r.fetchUrl && (
                      <div className="md-url-push">
                        <span className="md-tag md-tag-dim">push</span>
                        <button className="md-url" title={`${r.pushUrl}\nClick to copy`} onClick={() => void git.copyText(r.pushUrl, 'URL copied')}>
                          {r.pushUrl}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="md-table-actions">
                    {busyRow ? (
                      <Spinner size="sm" />
                    ) : (
                      <>
                        <IconButton label={`Fetch ${r.name}`} size="sm" disabled={fetching || !!working} onClick={() => void fetchRemote(r.name)}>
                          <RefreshCw size={13} />
                        </IconButton>
                        <IconButton label="Edit URL" size="sm" disabled={!!working} onClick={() => void editUrl(r)}>
                          <Pencil size={13} />
                        </IconButton>
                        <IconButton label="Rename" size="sm" disabled={!!working} onClick={() => void rename(r)}>
                          <TextCursorInput size={13} />
                        </IconButton>
                        <IconButton label="Remove" size="sm" className="md-danger-icon" disabled={!!working} onClick={() => void remove(r)}>
                          <Trash2 size={13} />
                        </IconButton>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
